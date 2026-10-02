import type {
  CreateWorkoutInput,
  UpdateWorkoutInput,
  WorkoutDTO,
  WorkoutStepDTO,
} from "@curvelo/shared";
import { db } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { conflict, notFound } from "../../lib/errors.js";
import {
  activeMembership,
  requireManager,
} from "../../lib/permissions.js";

type WorkoutWithSteps = {
  id: string;
  teamId: string;
  title: string;
  description: string | null;
  kind: string;
  isTemplate: boolean;
  createdAt: Date;
  createdBy: { displayName: string };
  steps: Array<{
    id: string;
    order: number;
    kind: string;
    distanceM: number | null;
    durationS: number | null;
    targetPaceS: number | null;
    targetHrBpm: number | null;
    targetRpe: number | null;
    repetitions: number;
    notes: string | null;
  }>;
};

function toDTO(w: WorkoutWithSteps): WorkoutDTO {
  const steps: WorkoutStepDTO[] = w.steps
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      id: s.id,
      order: s.order,
      kind: s.kind,
      distanceM: s.distanceM,
      durationS: s.durationS,
      targetPaceS: s.targetPaceS,
      targetHrBpm: s.targetHrBpm,
      targetRpe: s.targetRpe,
      repetitions: s.repetitions,
      notes: s.notes,
    }));
  return {
    id: w.id,
    teamId: w.teamId,
    title: w.title,
    description: w.description,
    kind: w.kind,
    isTemplate: w.isTemplate,
    createdByName: w.createdBy.displayName,
    steps,
    createdAt: w.createdAt.toISOString(),
  };
}

const WITH_STEPS = {
  createdBy: { select: { displayName: true } },
  steps: true,
} as const;

export async function createWorkout(
  actorId: string,
  teamId: string,
  input: CreateWorkoutInput,
  ipAddress?: string,
): Promise<WorkoutDTO> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);

  const workout = await db.$transaction(async (tx) => {
    const created = await tx.workout.create({
      data: {
        teamId,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        kind: input.kind,
        isTemplate: input.isTemplate,
        createdById: actorId,
      },
    });
    await tx.workoutStep.createMany({
      data: input.steps.map((s, i) => ({
        workoutId: created.id,
        order: i,
        kind: s.kind,
        distanceM: s.distanceM,
        durationS: s.durationS,
        targetPaceS: s.targetPaceS,
        targetHrBpm: s.targetHrBpm,
        targetRpe: s.targetRpe,
        repetitions: s.repetitions,
        notes: s.notes?.trim() || null,
      })),
    });
    return tx.workout.findUniqueOrThrow({
      where: { id: created.id },
      include: WITH_STEPS,
    });
  });

  await audit({
    actorId,
    action: "WORKOUT_CREATED",
    entityType: "Workout",
    entityId: workout.id,
    metadata: { teamId, title: workout.title, steps: input.steps.length },
    ipAddress,
  });

  return toDTO(workout);
}

export async function listWorkouts(
  actorId: string,
  teamId: string,
  opts: { templatesOnly?: boolean } = {},
): Promise<WorkoutDTO[]> {
  await activeMembership(actorId, teamId);
  const workouts = await db.workout.findMany({
    where: { teamId, ...(opts.templatesOnly ? { isTemplate: true } : {}) },
    include: WITH_STEPS,
    orderBy: { createdAt: "desc" },
  });
  return workouts.map(toDTO);
}

export async function getWorkout(
  actorId: string,
  workoutId: string,
): Promise<WorkoutDTO> {
  const workout = await db.workout.findUnique({
    where: { id: workoutId },
    include: WITH_STEPS,
  });
  if (!workout) throw notFound("Workout not found");
  await activeMembership(actorId, workout.teamId);
  return toDTO(workout);
}

export async function updateWorkout(
  actorId: string,
  workoutId: string,
  input: UpdateWorkoutInput,
  ipAddress?: string,
): Promise<WorkoutDTO> {
  const existing = await db.workout.findUnique({ where: { id: workoutId } });
  if (!existing) throw notFound("Workout not found");
  const membership = await activeMembership(actorId, existing.teamId);
  requireManager(membership);

  const workout = await db.$transaction(async (tx) => {
    if (input.steps) {
      // Full step replacement — simpler and safer than diffing.
      await tx.workoutStep.deleteMany({ where: { workoutId } });
      await tx.workoutStep.createMany({
        data: input.steps!.map((s, i) => ({
          workoutId,
          order: i,
          kind: s.kind,
          distanceM: s.distanceM,
          durationS: s.durationS,
          targetPaceS: s.targetPaceS,
          targetHrBpm: s.targetHrBpm,
          targetRpe: s.targetRpe,
          repetitions: s.repetitions,
          notes: s.notes?.trim() || null,
        })),
      });
    }
    return tx.workout.update({
      where: { id: workoutId },
      data: {
        title: input.title?.trim(),
        description:
          input.description === undefined
            ? undefined
            : input.description?.trim() || null,
        kind: input.kind,
        isTemplate: input.isTemplate,
      },
      include: WITH_STEPS,
    });
  });

  await audit({
    actorId,
    action: "WORKOUT_UPDATED",
    entityType: "Workout",
    entityId: workout.id,
    metadata: { fields: Object.keys(input) },
    ipAddress,
  });

  return toDTO(workout);
}

export async function deleteWorkout(
  actorId: string,
  workoutId: string,
  ipAddress?: string,
): Promise<void> {
  const existing = await db.workout.findUnique({
    where: { id: workoutId },
    include: { _count: { select: { assignments: true } } },
  });
  if (!existing) throw notFound("Workout not found");
  const membership = await activeMembership(actorId, existing.teamId);
  requireManager(membership);

  if (existing._count.assignments > 0) {
    throw conflict(
      "WORKOUT_HAS_ASSIGNMENTS",
      "This workout has scheduled assignments and cannot be deleted",
    );
  }

  await db.workout.delete({ where: { id: workoutId } });
  await audit({
    actorId,
    action: "WORKOUT_DELETED",
    entityType: "Workout",
    entityId: workoutId,
    metadata: { title: existing.title },
    ipAddress,
  });
}
