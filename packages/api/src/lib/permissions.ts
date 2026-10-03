import type { TeamMembership } from "@prisma/client";
import { db } from "../db.js";
import { forbidden, notFound } from "./errors.js";

/**
 * Team-scoped permission helpers.
 *
 * Rules for slice 1:
 * - Team existence is not leaked: non-members get 404, not 403.
 * - COACH and TEAM_ADMIN can manage the team (update, invite).
 * - Any ACTIVE member can view the roster; only COACH sees contact info.
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

/**
 * Sensitive contact info (emails, phones, emergency contacts) is
 * coach-only. TEAM_ADMIN handles operations, not athlete contact data.
 */
export function canSeeEmails(membership: TeamMembership): boolean {
  return membership.role === "COACH";
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

/**
 * Large teams: group leaders (assistant coaches).
 *
 * A group leader is an active COACH-role member designated to run one
 * subgroup. Leader powers are strictly scoped to the groups they lead:
 * - manage that group's membership (add/remove runners)
 * - post announcements to that group's conversation
 * - see coaching insights scoped to that group
 * The designation itself grants nothing team-wide. The team owner is never
 * scoped — owners keep full powers everywhere.
 */
export async function groupLeaderIds(
  actorId: string,
  teamId: string,
): Promise<string[]> {
  const groups = await db.teamGroup.findMany({
    where: { teamId, leaderId: actorId },
    select: { id: true },
  });
  return groups.map((g) => g.id);
}

export async function isGroupLeaderOf(
  actorId: string,
  groupId: string,
): Promise<boolean> {
  const group = await db.teamGroup.findUnique({
    where: { id: groupId },
    select: { leaderId: true },
  });
  return group?.leaderId === actorId;
}

/**
 * Whether the actor may manage a group's membership. Team managers keep
 * full access — unless they are designated as a group leader, in which case
 * they are scoped to the groups they lead (the team owner excepted).
 */
export async function canManageGroupMembership(
  actorId: string,
  teamId: string,
  groupId: string,
  groupLeaderId: string | null,
): Promise<boolean> {
  const membership = await activeMembership(actorId, teamId);
  if (!canManageTeam(membership)) return false;
  const team = await db.team.findUnique({
    where: { id: teamId },
    select: { ownerId: true },
  });
  if (team?.ownerId === actorId) return true;
  const led = await groupLeaderIds(actorId, teamId);
  if (led.length > 0) return groupLeaderId === actorId;
  return true;
}
