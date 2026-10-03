import { db } from "../../db.js";
import { AppError, forbidden, notFound } from "../../lib/errors.js";

/** Persist a simplified GPS route. No-op when there are fewer than 2 points. */
export async function saveActivityRoute(
  activityId: string,
  route: Array<[number, number]> | null | undefined,
): Promise<void> {
  if (!route || route.length < 2) return;
  const points = route.filter(
    (p): p is [number, number] =>
      Array.isArray(p) &&
      p.length === 2 &&
      p.every((v) => typeof v === "number" && Number.isFinite(v)),
  );
  if (points.length < 2) return;
  await db.activityRoute.upsert({
    where: { activityId },
    create: { activityId, points },
    update: { points },
  });
}

/**
 * Route maps are visible ONLY to the activity owner and their verified
 * guardians. Coaches, teammates, team admins, and everyone else are excluded
 * by design — GPS tracks are the most sensitive data in the app.
 */
export async function canSeeRoute(actorId: string, ownerId: string): Promise<boolean> {
  if (actorId === ownerId) return true;
  const link = await db.guardianLink.findFirst({
    where: { guardianId: actorId, athleteId: ownerId, status: "VERIFIED" },
    select: { id: true },
  });
  return link !== null;
}

/** Fetch an activity's route points, enforcing the owner/guardian-only rule. */
export async function getActivityRoute(
  actorId: string,
  activityId: string,
): Promise<{ points: Array<[number, number]> }> {
  const activity = await db.activity.findUnique({
    where: { id: activityId },
    select: { id: true, userId: true, route: { select: { points: true } } },
  });
  if (!activity) throw notFound("Activity not found");
  if (!(await canSeeRoute(actorId, activity.userId))) {
    throw forbidden("Route maps are only visible to the runner and their verified guardians.");
  }
  const points = activity.route?.points as Array<[number, number]> | null;
  if (!points || points.length === 0) throw notFound("No route for this activity.");
  return { points };
}
