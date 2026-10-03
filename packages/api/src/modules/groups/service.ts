import type {
  AddGroupMembersInput,
  CreateGroupInput,
  SetGroupLeaderInput,
  TeamGroupDTO,
} from "@curvelo/shared";
import { db } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import {
  activeMembership,
  canManageGroupMembership,
  canManageTeam,
  isGroupLeaderOf,
  requireManager,
} from "../../lib/permissions.js";
import {
  ensureGroupConversation,
  getGroupConversation,
  postMessage,
} from "../messages/service.js";

type GroupWithMembers = {
  id: string;
  teamId: string;
  name: string;
  leaderId: string | null;
  leader: { id: string; displayName: string } | null;
  members: Array<{ user: { id: string; displayName: string } }>;
};

function toDTO(g: GroupWithMembers, includeMembers: boolean): TeamGroupDTO {
  return {
    id: g.id,
    teamId: g.teamId,
    name: g.name,
    memberCount: g.members.length,
    leaderId: g.leaderId,
    leaderName: g.leader?.displayName ?? null,
    ...(includeMembers
      ? {
          members: g.members.map((m) => ({
            userId: m.user.id,
            displayName: m.user.displayName,
          })),
        }
      : {}),
  };
}

async function getGroupOr404(groupId: string) {
  const group = await db.teamGroup.findUnique({
    where: { id: groupId },
    include: {
      leader: { select: { id: true, displayName: true } },
      members: { include: { user: { select: { id: true, displayName: true } } } },
    },
  });
  if (!group) throw notFound("Group not found");
  return group;
}

export async function createGroup(
  actorId: string,
  teamId: string,
  input: CreateGroupInput,
  ipAddress?: string,
): Promise<TeamGroupDTO> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);

  const clash = await db.teamGroup.findUnique({
    where: { teamId_name: { teamId, name: input.name.trim() } },
  });
  if (clash) throw conflict("GROUP_EXISTS", "A group with that name already exists");

  // Every member must be an ACTIVE team member.
  const members = await db.teamMembership.findMany({
    where: {
      teamId,
      userId: { in: input.memberIds },
      status: "ACTIVE",
      role: { not: "PARENT" },
    },
    select: { userId: true },
  });
  const validIds = new Set(members.map((m) => m.userId));
  const invalid = input.memberIds.filter((id) => !validIds.has(id));
  if (invalid.length > 0) {
    throw new AppError(422, "INVALID_MEMBERS", "Some members are not on this team", {
      memberIds: invalid,
    });
  }

  const group = await db.$transaction(async (tx) => {
    const created = await tx.teamGroup.create({
      data: { teamId, name: input.name.trim(), createdById: actorId },
    });
    if (input.memberIds.length > 0) {
      await tx.teamGroupMember.createMany({
        data: [...new Set(input.memberIds)].map((userId) => ({
          groupId: created.id,
          userId,
        })),
      });
    }
    return tx.teamGroup.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        leader: { select: { id: true, displayName: true } },
        members: { include: { user: { select: { id: true, displayName: true } } } },
      },
    });
  });

  await audit({
    actorId,
    action: "GROUP_CREATED",
    entityType: "TeamGroup",
    entityId: group.id,
    metadata: { teamId, name: group.name, members: input.memberIds.length },
    ipAddress,
  });

  // Every team group gets its own chat channel.
  await ensureGroupConversation(teamId, group.id, group.name, actorId);

  return toDTO(group, true);
}

export async function listGroups(actorId: string, teamId: string): Promise<TeamGroupDTO[]> {
  await activeMembership(actorId, teamId);
  const groups = await db.teamGroup.findMany({
    where: { teamId },
    include: {
      leader: { select: { id: true, displayName: true } },
      members: { include: { user: { select: { id: true, displayName: true } } } },
    },
    orderBy: { name: "asc" },
  });
  return groups.map((g) => toDTO(g, true));
}

export async function getGroup(actorId: string, groupId: string): Promise<TeamGroupDTO> {
  const group = await getGroupOr404(groupId);
  await activeMembership(actorId, group.teamId);
  return toDTO(group, true);
}

export async function addGroupMembers(
  actorId: string,
  groupId: string,
  input: AddGroupMembersInput,
  ipAddress?: string,
): Promise<TeamGroupDTO> {
  const group = await getGroupOr404(groupId);
  await activeMembership(actorId, group.teamId);
  if (
    !(await canManageGroupMembership(actorId, group.teamId, groupId, group.leaderId))
  ) {
    throw forbidden("You cannot manage this group's membership");
  }

  const members = await db.teamMembership.findMany({
    where: {
      teamId: group.teamId,
      userId: { in: input.memberIds },
      status: "ACTIVE",
      role: { not: "PARENT" },
    },
    select: { userId: true },
  });
  const validIds = new Set(members.map((m) => m.userId));
  const invalid = input.memberIds.filter((id) => !validIds.has(id));
  if (invalid.length > 0) {
    throw new AppError(422, "INVALID_MEMBERS", "Some members are not on this team", {
      memberIds: invalid,
    });
  }

  await db.teamGroupMember.createMany({
    data: [...new Set(input.memberIds)].map((userId) => ({ groupId, userId })),
    skipDuplicates: true,
  });

  await audit({
    actorId,
    action: "GROUP_MEMBERS_ADDED",
    entityType: "TeamGroup",
    entityId: groupId,
    metadata: { memberIds: input.memberIds },
    ipAddress,
  });

  return getGroup(actorId, groupId);
}

export async function removeGroupMember(
  actorId: string,
  groupId: string,
  userId: string,
  ipAddress?: string,
): Promise<TeamGroupDTO> {
  const group = await getGroupOr404(groupId);
  await activeMembership(actorId, group.teamId);
  if (
    !(await canManageGroupMembership(actorId, group.teamId, groupId, group.leaderId))
  ) {
    throw forbidden("You cannot manage this group's membership");
  }

  await db.teamGroupMember.deleteMany({ where: { groupId, userId } });
  await audit({
    actorId,
    action: "GROUP_MEMBER_REMOVED",
    entityType: "TeamGroup",
    entityId: groupId,
    metadata: { userId },
    ipAddress,
  });
  return getGroup(actorId, groupId);
}

export async function deleteGroup(
  actorId: string,
  groupId: string,
  ipAddress?: string,
): Promise<void> {
  const group = await getGroupOr404(groupId);
  const membership = await activeMembership(actorId, group.teamId);
  requireManager(membership);

  // Assignments targeting the group become team-wide (SetNull) rather than vanishing.
  await db.teamGroup.delete({ where: { id: groupId } });
  await audit({
    actorId,
    action: "GROUP_DELETED",
    entityType: "TeamGroup",
    entityId: groupId,
    metadata: { name: group.name },
    ipAddress,
  });
}

/**
 * Assign or remove a group's leader (assistant coach). Team owner only.
 * The leader must be an active COACH-role member of the team.
 */
export async function setGroupLeader(
  actorId: string,
  groupId: string,
  input: SetGroupLeaderInput,
  ipAddress?: string,
): Promise<TeamGroupDTO> {
  const group = await getGroupOr404(groupId);
  await activeMembership(actorId, group.teamId);
  const team = await db.team.findUniqueOrThrow({
    where: { id: group.teamId },
    select: { ownerId: true },
  });
  if (team.ownerId !== actorId) {
    throw forbidden("Only the head coach can assign group leaders");
  }

  let leaderName: string | null = null;
  if (input.leaderId !== null) {
    const target = await db.teamMembership.findUnique({
      where: { teamId_userId: { teamId: group.teamId, userId: input.leaderId } },
      include: { user: { select: { displayName: true } } },
    });
    if (!target || target.status !== "ACTIVE" || target.role !== "COACH") {
      throw badRequest("Group leader must be an active coach on this team");
    }
    leaderName = target.user.displayName;
  }

  await db.teamGroup.update({
    where: { id: groupId },
    data: { leaderId: input.leaderId },
  });
  await audit({
    actorId,
    action: input.leaderId ? "GROUP_LEADER_ASSIGNED" : "GROUP_LEADER_REMOVED",
    entityType: "TeamGroup",
    entityId: groupId,
    metadata: { leaderId: input.leaderId, leaderName },
    ipAddress,
  });
  return getGroup(actorId, groupId);
}

/**
 * Post an announcement scoped to a group — lands in the group's
 * conversation. Allowed: the team owner, the group's leader, or a team
 * manager who is not designated as a group leader (leaders are scoped to
 * the groups they lead).
 */
export async function postGroupAnnouncement(
  actorId: string,
  groupId: string,
  body: string,
  ipAddress?: string,
) {
  const group = await getGroupOr404(groupId);
  const membership = await activeMembership(actorId, group.teamId);
  const team = await db.team.findUniqueOrThrow({
    where: { id: group.teamId },
    select: { ownerId: true },
  });

  const isOwner = team.ownerId === actorId;
  const leader = await isGroupLeaderOf(actorId, groupId);
  let allowed = isOwner || leader;
  if (!allowed && canManageTeam(membership)) {
    // Full managers may announce anywhere; designated leaders are scoped.
    const ledCount = await db.teamGroup.count({
      where: { teamId: group.teamId, leaderId: actorId },
    });
    allowed = ledCount === 0;
  }
  if (!allowed) {
    throw forbidden("Only this group's leader or a team manager can post here");
  }

  const conv = await getGroupConversation(group.teamId, group.id, group.name, actorId);
  return postMessage(actorId, group.teamId, conv.id, { body }, ipAddress);
}
