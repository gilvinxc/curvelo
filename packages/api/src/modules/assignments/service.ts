import type { AssignmentDTO, CreateAssignmentInput } from "@curvelo/shared";
import { db } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { AppError, forbidden, notFound } from "../../lib/errors.js";
import { activeMembership, requireManager } from "../../lib/permissions.js";
import { ageToday, evaluateWorkoutAssignment } from "../../lib/compliance.js";

type AssignmentWithJoins = {
  id: string;
  workoutId: string;
  teamId: string;
  groupId: string | null;
  assignedToUserId: string | null;
  scheduledDate: Date;
  notes: string | null;
  needsApproval: boolean;
  createdBy: { displayName: string };
  workout: { title: string; kind: string };
  team: { name: string };
  group: { name: string } | null;
  assignedToUser: { displayName: string } | null;
};

function toDTO(a: AssignmentWithJoins): AssignmentDTO {
  return {
    id: a.id,
    workoutId: a.workoutId,
    workoutTitle: a.workout.title,
    workoutKind: a.workout.kind,
    teamId: a.teamId,
    teamName: a.team.name,
    groupId: a.groupId,
    groupName: a.group?.name ?? null,
    assignedToUserId: a.assignedToUserId,
    assignedToName: a.assignedToUser?.displayName ?? null,
    scheduledDate: a.scheduledDate.toISOString().slice(0, 10),
    notes: a.notes,
    needsApproval: a.needsApproval,
    createdByName: a.createdBy.displayName,
  };
}

const WITH_JOINS = {
  createdBy: { select: { displayName: true } },
  workout: { select: { title: true, kind: true } },
  team: { select: { name: true } },
  group: { select: { name: true } },
  assignedToUser: { select: { displayName: true } },
} as const;

export async function createAssignment(
  actorId: string,
  teamId: string,
  input: CreateAssignmentInput,
  ipAddress?: string,
): Promise<AssignmentDTO> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);

  const workout = await db.workout.findUnique({ where: { id: input.workoutId } });
  if (!workout || workout.teamId !== teamId) {
    throw notFound("Workout not found");
  }

  if (input.assignedToUserId) {
    const target = await db.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId: input.assignedToUserId } },
    });
    if (!target || target.status !== "ACTIVE") {
      throw new AppError(422, "INVALID_ASSIGNEE", "That athlete is not on this team");
    }
  }

  if (input.groupId) {
    const group = await db.teamGroup.findUnique({ where: { id: input.groupId } });
    if (!group || group.teamId !== teamId) throw notFound("Group not found");
  }

  const scheduledDate = new Date(input.scheduledDate + "T00:00:00Z");

  // Compliance checkpoint: dead periods etc. can block or flag the assignment.
  const athlete =
    input.assignedToUserId != null
      ? await db.user.findUnique({
          where: { id: input.assignedToUserId },
          select: { dateOfBirth: true },
        })
      : null;
  const decision = await evaluateWorkoutAssignment({
    teamId,
    scheduledDate,
    athleteAge: ageToday(athlete?.dateOfBirth),
    actorId,
  });
  if (decision.blocked) {
    throw forbidden("This assignment is blocked by an organizational policy");
  }

  const assignment = await db.workoutAssignment.create({
    data: {
      workoutId: input.workoutId,
      teamId,
      assignedToUserId: input.assignedToUserId,
      groupId: input.groupId,
      scheduledDate,
      notes: input.notes?.trim() || null,
      needsApproval: decision.needsApproval,
      createdById: actorId,
    },
    include: WITH_JOINS,
  });

  await audit({
    actorId,
    action: "ASSIGNMENT_CREATED",
    entityType: "WorkoutAssignment",
    entityId: assignment.id,
    metadata: {
      teamId,
      workoutId: input.workoutId,
      scheduledDate: input.scheduledDate,
      target: input.assignedToUserId
        ? { userId: input.assignedToUserId }
        : input.groupId
          ? { groupId: input.groupId }
          : "team",
      needsApproval: decision.needsApproval,
    },
    ipAddress,
  });

  return toDTO(assignment);
}

export async function deleteAssignment(
  actorId: string,
  assignmentId: string,
  ipAddress?: string,
): Promise<void> {
  const assignment = await db.workoutAssignment.findUnique({
    where: { id: assignmentId },
  });
  if (!assignment) throw notFound("Assignment not found");
  const membership = await activeMembership(actorId, assignment.teamId);
  requireManager(membership);

  await db.workoutAssignment.delete({ where: { id: assignmentId } });
  await audit({
    actorId,
    action: "ASSIGNMENT_DELETED",
    entityType: "WorkoutAssignment",
    entityId: assignmentId,
    ipAddress,
  });
}

/** Team calendar: managers see everything; athletes see their own + team-wide. */
export async function teamCalendar(
  actorId: string,
  teamId: string,
  from: string,
  to: string,
): Promise<AssignmentDTO[]> {
  const membership = await activeMembership(actorId, teamId);
  const isManager =
    membership.role === "COACH" || membership.role === "TEAM_ADMIN";

  const fromDate = new Date(from + "T00:00:00Z");
  const toDate = new Date(to + "T00:00:00Z");

  const myGroupIds = isManager
    ? []
    : (
        await db.teamGroupMember.findMany({
          where: { userId: actorId, group: { teamId } },
          select: { groupId: true },
        })
      ).map((m) => m.groupId);

  const assignments = await db.workoutAssignment.findMany({
    where: {
      teamId,
      scheduledDate: { gte: fromDate, lte: toDate },
      ...(isManager
        ? {}
        : {
            OR: [
              { assignedToUserId: actorId },
              { assignedToUserId: null, groupId: null },
              { groupId: { in: myGroupIds } },
            ],
          }),
    },
    include: WITH_JOINS,
    orderBy: [{ scheduledDate: "asc" }, { createdAt: "asc" }],
  });
  return assignments.map(toDTO);
}

/** Personal calendar across all of the athlete's teams. */
export async function myCalendar(
  actorId: string,
  from: string,
  to: string,
): Promise<AssignmentDTO[]> {
  const fromDate = new Date(from + "T00:00:00Z");
  const toDate = new Date(to + "T00:00:00Z");

  const myGroupIds = (
    await db.teamGroupMember.findMany({
      where: { userId: actorId },
      select: { groupId: true },
    })
  ).map((m) => m.groupId);

  const assignments = await db.workoutAssignment.findMany({
    where: {
      scheduledDate: { gte: fromDate, lte: toDate },
      team: { memberships: { some: { userId: actorId, status: "ACTIVE" } } },
      OR: [
        { assignedToUserId: actorId },
        { assignedToUserId: null, groupId: null },
        { groupId: { in: myGroupIds } },
      ],
    },
    include: WITH_JOINS,
    orderBy: [{ scheduledDate: "asc" }, { createdAt: "asc" }],
  });
  return assignments.map(toDTO);
}

/**
 * Practice planner: schedule a workout ahead of time, optionally announcing
 * it to the team feed in the same action.
 */
export async function createPracticePlan(
  actorId: string,
  teamId: string,
  input: {
    workoutId: string;
    groupId?: string;
    assignedToUserId?: string;
    scheduledDate: string;
    notes?: string;
    announce: boolean;
  },
  ipAddress?: string,
): Promise<{ assignment: AssignmentDTO; postId: string | null }> {
  const assignment = await createAssignment(
    actorId,
    teamId,
    {
      workoutId: input.workoutId,
      groupId: input.groupId,
      assignedToUserId: input.assignedToUserId,
      scheduledDate: input.scheduledDate,
      notes: input.notes,
    },
    ipAddress,
  );

  let postId: string | null = null;
  if (input.announce) {
    const { createPost } = await import("../feed/service.js");
    const target = assignment.groupName
      ? ` (${assignment.groupName})`
      : assignment.assignedToName
        ? ` — ${assignment.assignedToName}`
        : "";
    const body = [
      `📋 Practice plan for ${input.scheduledDate}${target}: ${assignment.workoutTitle}.`,
      input.notes?.trim() ? `\n${input.notes.trim()}` : "",
    ].join("");
    const post = await createPost(actorId, teamId, { body }, ipAddress);
    postId = post.id;
  }

  return { assignment, postId };
}
