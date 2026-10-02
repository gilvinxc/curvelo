import type { AddGroupMembersInput, CreateGroupInput, TeamGroupDTO } from "@curvelo/shared";
import { db } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { AppError, conflict, notFound } from "../../lib/errors.js";
import { activeMembership, requireManager } from "../../lib/permissions.js";

type GroupWithMembers = {
  id: string;
  teamId: string;
  name: string;
  members: Array<{ user: { id: string; displayName: string } }>;
};

function toDTO(g: GroupWithMembers, includeMembers: boolean): TeamGroupDTO {
  return {
    id: g.id,
    teamId: g.teamId,
    name: g.name,
    memberCount: g.members.length,
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
    include: { members: { include: { user: { select: { id: true, displayName: true } } } } },
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
    where: { teamId, userId: { in: input.memberIds }, status: "ACTIVE" },
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

  return toDTO(group, true);
}

export async function listGroups(actorId: string, teamId: string): Promise<TeamGroupDTO[]> {
  await activeMembership(actorId, teamId);
  const groups = await db.teamGroup.findMany({
    where: { teamId },
    include: { members: { include: { user: { select: { id: true, displayName: true } } } } },
    orderBy: { name: "asc" },
  });
  return groups.map((g) => toDTO(g, false));
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
  const membership = await activeMembership(actorId, group.teamId);
  requireManager(membership);

  const members = await db.teamMembership.findMany({
    where: { teamId: group.teamId, userId: { in: input.memberIds }, status: "ACTIVE" },
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
  const membership = await activeMembership(actorId, group.teamId);
  requireManager(membership);

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
