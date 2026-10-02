import type { TeamMembership } from "@prisma/client";
import { db } from "../db.js";
import { forbidden, notFound } from "./errors.js";

/**
 * Team-scoped permission helpers.
 *
 * Rules for slice 1:
 * - Team existence is not leaked: non-members get 404, not 403.
 * - COACH and TEAM_ADMIN can manage the team (update, invite).
 * - Any ACTIVE member can view the roster; only COACH/TEAM_ADMIN see emails.
 */

export async function activeMembership(
  userId: string,
  teamId: string,
): Promise<TeamMembership> {
  const membership = await db.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
  if (!membership || membership.status !== "ACTIVE") {
    throw notFound("Team not found");
  }
  return membership;
}

export function canManageTeam(membership: TeamMembership): boolean {
  return membership.role === "COACH" || membership.role === "TEAM_ADMIN";
}

export function requireManager(membership: TeamMembership): void {
  if (!canManageTeam(membership)) {
    throw forbidden("Requires coach or team admin role");
  }
}

export function canSeeEmails(membership: TeamMembership): boolean {
  return canManageTeam(membership);
}
