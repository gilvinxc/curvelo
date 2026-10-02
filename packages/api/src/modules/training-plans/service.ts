import type {
  ApplyTrainingPlanInput,
  AssignmentDTO,
  CreateTrainingPlanInput,
  TrainingPlanDTO,
  TrainingPlanDayDTO,
  UpdateTrainingPlanInput,
} from "@curvelo/shared";
import { db } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { conflict, notFound } from "../../lib/errors.js";
import { activeMembership, requireManager } from "../../lib/permissions.js";
import { createAssignment } from "../assignments/service.js";

const DAY_INCLUDE = {
  workout: { select: { id: true, title: true, teamId: true } },
  group: { select: { id: true, name: true, teamId: true } },
  assignedTo: { select: { id: true, displayName: true } },
} as const;

const PLAN_INCLUDE = {
  createdBy: { select: { displayName: true } },
  days: { include: DAY_INCLUDE, orderBy: { dayOfWeek: "asc" as const } },
} as const;

type PlanWithDays = {
  id: string;
  teamId: string;
  name: string;
  description: string | null;
  createdAt: Date;
  createdBy: { displayName: string };
  days: Array<{
    id: string;
    dayOfWeek: number;
    notes: string | null;
    workout: { id: string; title: string; teamId: string };
    group: { id: string; name: string; teamId: string } | null;
    assignedTo: { id: string; displayName: string } | null;
  }>;
};

function toDayDTO(d: PlanWithDays["days"][number]): TrainingPlanDayDTO {
  return {
    id: d.id,
    dayOfWeek: d.dayOfWeek,
    workoutId: d.workout.id,
    workoutTitle: d.workout.title,
    groupId: d.group?.id ?? null,
    groupName: d.group?.name ?? null,
    assignedToUserId: d.assignedTo?.id ?? null,
    assignedToName: d.assignedTo?.displayName ?? null,
    notes: d.notes,
  };
}

function toDTO(plan: PlanWithDays): TrainingPlanDTO {
  return {
    id: plan.id,
    teamId: plan.teamId,
    name: plan.name,
    description: plan.description,
    createdByName: plan.createdBy.displayName,
    days: plan.days.map(toDayDTO),
    createdAt: plan.createdAt.toISOString(),
  };
}

async function getPlanOrThrow(planId: string, teamId: string) {
  const plan = await db.trainingPlan.findUnique({
    where: { id: planId },
    include: PLAN_INCLUDE,
  });
  if (!plan || plan.teamId !== teamId) throw notFound("Training plan not found");
  return plan;
}

async function validateDays(teamId: string, days: CreateTrainingPlanInput["days"]) {
  for (const d of days) {
    const workout = await db.workout.findUnique({ where: { id: d.workoutId } });
    if (!workout || workout.teamId !== teamId) {
      throw notFound("Workout not found");
    }
    if (d.groupId) {
      const group = await db.teamGroup.findUnique({ where: { id: d.groupId } });
      if (!group || group.teamId !== teamId) throw notFound("Group not found");
    }
    if (d.assignedToUserId) {
      const m = await db.teamMembership.findUnique({
        where: { teamId_userId: { teamId, userId: d.assignedToUserId } },
      });
      if (!m || m.status !== "ACTIVE") {
        throw conflict("INVALID_ASSIGNEE", "That athlete is not on this team");
      }
    }
  }
}

export async function listTrainingPlans(
  actorId: string,
  teamId: string,
): Promise<TrainingPlanDTO[]> {
  await activeMembership(actorId, teamId);
  const plans = await db.trainingPlan.findMany({
    where: { teamId },
    include: PLAN_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return plans.map(toDTO);
}

export async function createTrainingPlan(
  actorId: string,
  teamId: string,
  input: CreateTrainingPlanInput,
  ipAddress?: string,
): Promise<TrainingPlanDTO> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);
  await validateDays(teamId, input.days);

  const plan = await db.trainingPlan.create({
    data: {
      teamId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      createdById: actorId,
      days: {
        create: input.days.map((d) => ({
          dayOfWeek: d.dayOfWeek,
          workoutId: d.workoutId,
          groupId: d.groupId ?? null,
          assignedToUserId: d.assignedToUserId ?? null,
          notes: d.notes?.trim() || null,
        })),
      },
    },
    include: PLAN_INCLUDE,
  });

  await audit({
    actorId,
    action: "TRAINING_PLAN_CREATED",
    entityType: "TrainingPlan",
    entityId: plan.id,
    metadata: { teamId, name: plan.name, dayCount: input.days.length },
    ipAddress,
  });
  return toDTO(plan);
}

export async function updateTrainingPlan(
  actorId: string,
  teamId: string,
  planId: string,
  input: UpdateTrainingPlanInput,
  ipAddress?: string,
): Promise<TrainingPlanDTO> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);
  await getPlanOrThrow(planId, teamId);
  if (input.days) await validateDays(teamId, input.days);

  const plan = await db.trainingPlan.update({
    where: { id: planId },
    data: {
      name: input.name?.trim(),
      description:
        input.description === undefined ? undefined : input.description?.trim() || null,
      ...(input.days
        ? {
            days: {
              deleteMany: {},
              create: input.days.map((d) => ({
                dayOfWeek: d.dayOfWeek,
                workoutId: d.workoutId,
                groupId: d.groupId ?? null,
                assignedToUserId: d.assignedToUserId ?? null,
                notes: d.notes?.trim() || null,
              })),
            },
          }
        : {}),
    },
    include: PLAN_INCLUDE,
  });

  await audit({
    actorId,
    action: "TRAINING_PLAN_UPDATED",
    entityType: "TrainingPlan",
    entityId: plan.id,
    metadata: { teamId, fields: Object.keys(input) },
    ipAddress,
  });
  return toDTO(plan);
}

export async function deleteTrainingPlan(
  actorId: string,
  teamId: string,
  planId: string,
  ipAddress?: string,
): Promise<void> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);
  const plan = await getPlanOrThrow(planId, teamId);
  await db.trainingPlan.delete({ where: { id: planId } });
  await audit({
    actorId,
    action: "TRAINING_PLAN_DELETED",
    entityType: "TrainingPlan",
    entityId: planId,
    metadata: { teamId, name: plan.name },
    ipAddress,
  });
}

/**
 * Apply a week template: creates one assignment per plan day, starting from
 * the given Monday (dayOfWeek 0 = Monday).
 */
export async function applyTrainingPlan(
  actorId: string,
  teamId: string,
  planId: string,
  input: ApplyTrainingPlanInput,
  ipAddress?: string,
): Promise<{ assignments: AssignmentDTO[]; postId: string | null }> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);
  const plan = await getPlanOrThrow(planId, teamId);

  // weekStart must be a Monday.
  const start = new Date(input.weekStart + "T00:00:00Z");
  if (start.getUTCDay() !== 1) {
    throw conflict("NOT_MONDAY", "Pick the Monday of the target week");
  }

  const assignments: AssignmentDTO[] = [];
  for (const day of plan.days) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + day.dayOfWeek);
    const assignment = await createAssignment(
      actorId,
      teamId,
      {
        workoutId: day.workout.id,
        groupId: day.group?.id,
        assignedToUserId: day.assignedTo?.id,
        scheduledDate: date.toISOString().slice(0, 10),
        notes: day.notes ?? undefined,
      },
      ipAddress,
    );
    assignments.push(assignment);
  }

  let postId: string | null = null;
  if (input.announce && assignments.length > 0) {
    const { createPost } = await import("../feed/service.js");
    const weekLabel = input.weekStart;
    const lines = plan.days
      .slice()
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
      .map((d) => {
        const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        const target = d.group
          ? ` (${d.group.name})`
          : d.assignedTo
            ? ` — ${d.assignedTo.displayName}`
            : "";
        return `• ${dayNames[d.dayOfWeek]}: ${d.workout.title}${target}`;
      });
    const body = `📋 Week of ${weekLabel} — ${plan.name}\n${lines.join("\n")}`;
    const post = await createPost(actorId, teamId, { body }, ipAddress);
    postId = post.id;
  }

  await audit({
    actorId,
    action: "TRAINING_PLAN_APPLIED",
    entityType: "TrainingPlan",
    entityId: plan.id,
    metadata: { teamId, weekStart: input.weekStart, assignmentCount: assignments.length },
    ipAddress,
  });
  return { assignments, postId };
}
