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

/**
 * Verified guardian of an active member on the team. Guardians aren't team
 * members themselves, but they may act for their athlete (uploads, docs).
 * A removed athlete's guardian keeps access — removing a member never
 * breaks the parent/child association.
 */
export async function isGuardianOfTeamMember(
  guardianId: string,
  teamId: string,
): Promise<boolean> {
  const link = await db.guardianLink.findFirst({
    where: {
      guardianId,
      status: "VERIFIED",
      athlete: {
        memberships: { some: { teamId, status: "ACTIVE" } },
      },
    },
  });
  return Boolean(link);
}

/** Member or guardian-of-member access to team-scoped resources. */
export async function teamAccess(
  userId: string,
  teamId: string,
): Promise<TeamMembership | "guardian" | null> {
  const membership = await db.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
  if (membership && membership.status === "ACTIVE") return membership;
  if (await isGuardianOfTeamMember(userId, teamId)) return "guardian";
  return null;
}
