import type { PersonalPlan, PersonalPlanDay } from "@prisma/client";
import type {
  CreatePersonalPlanInput,
  PersonalPlanDayDTO,
  PersonalPlanDTO,
  UpdatePersonalPlanInput,
} from "@curvelo/shared";
import { db } from "../../db.js";
import { forbidden, notFound } from "../../lib/errors.js";
import { activeMembership, canManageTeam } from "../../lib/permissions.js";

function toDayDTO(d: PersonalPlanDay): PersonalPlanDayDTO {
  return {
    id: d.id,
    date: d.date.toISOString().slice(0, 10),
    title: d.title,
    notes: d.notes,
    position: d.position,
  };
}

function toPlanDTO(
  p: PersonalPlan & { days: PersonalPlanDay[] },
): PersonalPlanDTO {
  const days = [...p.days].sort(
    (a, b) => a.date.getTime() - b.date.getTime() || a.position - b.position,
  );
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    applied: p.applied,
    days: days.map(toDayDTO),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

async function getOwnPlanOrThrow(
  userId: string,
  planId: string,
): Promise<PersonalPlan & { days: PersonalPlanDay[] }> {
  const plan = await db.personalPlan.findUnique({
    where: { id: planId },
    include: { days: true },
  });
  if (!plan || plan.userId !== userId) throw notFound("Plan not found");
  return plan;
}

export async function listPersonalPlans(
  userId: string,
): Promise<PersonalPlanDTO[]> {
  const plans = await db.personalPlan.findMany({
    where: { userId },
    include: { days: true },
    orderBy: { updatedAt: "desc" },
  });
  return plans.map(toPlanDTO);
}

export async function createPersonalPlan(
  userId: string,
  input: CreatePersonalPlanInput,
): Promise<PersonalPlanDTO> {
  const plan = await db.personalPlan.create({
    data: {
      userId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      days: {
        create: input.days.map((d, i) => ({
          date: new Date(d.date + "T00:00:00Z"),
          title: d.title.trim(),
          notes: d.notes?.trim() || null,
          position: i,
        })),
      },
    },
    include: { days: true },
  });
  return toPlanDTO(plan);
}

export async function updatePersonalPlan(
  userId: string,
  planId: string,
  input: UpdatePersonalPlanInput,
): Promise<PersonalPlanDTO> {
  await getOwnPlanOrThrow(userId, planId);
  const plan = await db.personalPlan.update({
    where: { id: planId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
      ...(input.days !== undefined
        ? {
            days: {
              deleteMany: {},
              create: input.days.map((d, i) => ({
                date: new Date(d.date + "T00:00:00Z"),
                title: d.title.trim(),
                notes: d.notes?.trim() || null,
                position: i,
              })),
            },
          }
        : {}),
    },
    include: { days: true },
  });
  return toPlanDTO(plan);
}

export async function deletePersonalPlan(
  userId: string,
  planId: string,
): Promise<void> {
  await getOwnPlanOrThrow(userId, planId);
  await db.personalPlan.delete({ where: { id: planId } });
}

export async function setPlanApplied(
  userId: string,
  planId: string,
  applied: boolean,
): Promise<PersonalPlanDTO> {
  await getOwnPlanOrThrow(userId, planId);
  const plan = await db.personalPlan.update({
    where: { id: planId },
    data: { applied },
    include: { days: true },
  });
  return toPlanDTO(plan);
}

/**
 * Days from the user's applied plans inside a date range, for the personal
 * calendar. Includes the plan name so the calendar can label each item.
 */
export async function appliedPlanDays(
  userId: string,
  from: string,
  to: string,
): Promise<Array<PersonalPlanDayDTO & { planId: string; planName: string }>> {
  const fromDate = new Date(from + "T00:00:00Z");
  const toExclusive = new Date(to + "T00:00:00Z");
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
  const days = await db.personalPlanDay.findMany({
    where: {
      plan: { userId, applied: true },
      date: { gte: fromDate, lt: toExclusive },
    },
    include: { plan: { select: { id: true, name: true } } },
    orderBy: [{ date: "asc" }, { position: "asc" }],
  });
  return days.map((d) => ({
    ...toDayDTO(d),
    planId: d.plan.id,
    planName: d.plan.name,
  }));
}

/**
 * Coach view: an athlete's upcoming planned workouts. Only coaches/admins of
 * a team the athlete belongs to may call this — the route checks that.
 */
export async function athletePlannedDays(
  athleteId: string,
  from: string,
  to: string,
): Promise<Array<PersonalPlanDayDTO & { planId: string; planName: string }>> {
  return appliedPlanDays(athleteId, from, to);
}

/** Guard for the coach route: caller must manage a team the athlete is on. */
export async function assertCanViewAthletePlan(
  callerId: string,
  athleteId: string,
  teamId: string,
): Promise<void> {
  const membership = await activeMembership(callerId, teamId);
  if (!canManageTeam(membership)) throw forbidden("Requires coach or team admin role");
  const athleteMembership = await db.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId: athleteId } },
  });
  if (!athleteMembership || athleteMembership.status !== "ACTIVE") {
    throw notFound("Athlete not found on this team");
  }
}
