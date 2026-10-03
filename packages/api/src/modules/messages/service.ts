import type { TeamMembership } from "@prisma/client";
import type {
  ChatMessageDTO,
  ConversationDTO,
  SendMessageInput,
} from "@curvelo/shared";
import { db } from "../../db.js";
import { mentionRefsFor, syncMentions } from "../../lib/mentions.js";
import { audit } from "../../lib/audit.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { activeMembership } from "../../lib/permissions.js";
import { consentRequiredFor } from "../guardians/service.js";

type ConversationWithJoins = {
  id: string;
  kind: string;
  title: string;
  groupId: string | null;
  group: { name: string } | null;
  messages: { createdAt: Date }[];
};

function scopeKey(kind: string, groupId: string | null): string {
  return `${kind}:${groupId ?? "-"}`;
}

/** Create the default per-team conversations if they don't exist. */
export async function ensureTeamConversations(
  teamId: string,
  creatorId: string,
): Promise<void> {
  const defaults = [
    { kind: "ANNOUNCEMENT", title: "Announcements" },
    { kind: "TEAM_CHAT", title: "Team chat" },
  ];
  for (const d of defaults) {
    await db.conversation.upsert({
      where: { teamId_scopeKey: { teamId, scopeKey: scopeKey(d.kind, null) } },
      create: {
        teamId,
        kind: d.kind,
        scopeKey: scopeKey(d.kind, null),
        title: d.title,
        createdById: creatorId,
      },
      update: {},
    });
  }
}

/** Create the group chat for a newly created team group. */
export async function ensureGroupConversation(
  teamId: string,
  groupId: string,
  groupName: string,
  creatorId: string,
): Promise<void> {
  await db.conversation.upsert({
    where: { teamId_scopeKey: { teamId, scopeKey: scopeKey("GROUP_CHAT", groupId) } },
    create: {
      teamId,
      kind: "GROUP_CHAT",
      groupId,
      scopeKey: scopeKey("GROUP_CHAT", groupId),
      title: groupName,
      createdById: creatorId,
    },
    update: { title: groupName },
  });
}

type TeamAccess =
  | { membership: TeamMembership; guardian: false }
  | { membership: null; guardian: true };

/**
 * Members get full access; verified guardians of athletes on the team get
 * read-only access. Everyone else gets 404 (no team-existence leak).
 */
export async function resolveTeamAccess(
  actorId: string,
  teamId: string,
): Promise<TeamAccess> {
  const membership = await activeMembership(actorId, teamId).catch(() => null);
  if (membership) return { membership, guardian: false };

  const link = await db.guardianLink.findFirst({
    where: {
      guardianId: actorId,
      status: "VERIFIED",
      athlete: { memberships: { some: { teamId, status: "ACTIVE" } } },
    },
    select: { id: true },
  });
  if (link) return { membership: null, guardian: true };

  throw notFound("Team not found");
}

async function getConversation(teamId: string, convId: string) {
  const conv = await db.conversation.findFirst({
    where: { id: convId, teamId },
    include: { group: { select: { name: true } } },
  });
  if (!conv) throw notFound("Conversation not found");
  return conv;
}

function isManagerRole(role: string): boolean {
  return role === "COACH" || role === "TEAM_ADMIN";
}

async function canPost(
  access: TeamAccess,
  conv: { id: string; kind: string; groupId: string | null },
  teamId: string,
  actorId: string,
): Promise<boolean> {
  // CHECK_IN: only conversation participants may post — this covers the
  // coach, the runner, and the runner's verified guardians.
  if (conv.kind === "CHECK_IN") {
    const participant = await db.conversationParticipant.findUnique({
      where: {
        conversationId_userId: { conversationId: conv.id, userId: actorId },
      },
    });
    if (!participant) return false;
    if (access.membership && access.membership.role === "ALUMNI") return false;
    return true;
  }
  if (access.guardian || !access.membership) return false;
  const role = access.membership.role;
  // Alumni are read-only everywhere.
  if (role === "ALUMNI") return false;
  if (conv.kind === "ANNOUNCEMENT") return isManagerRole(role);
  if (conv.kind === "TEAM_CHAT") return true;
  // GROUP_CHAT: coaches/admins or group members only.
  if (isManagerRole(role)) return true;
  if (!conv.groupId) return false;
  const member = await db.teamGroupMember.findUnique({
    where: { groupId_userId: { groupId: conv.groupId, userId: actorId } },
  });
  return !!member;
}

function toConversationDTO(
  conv: ConversationWithJoins,
  canPostFlag: boolean,
): ConversationDTO {
  return {
    id: conv.id,
    kind: conv.kind,
    title: conv.title,
    groupId: conv.groupId,
    groupName: conv.group?.name ?? null,
    canPost: canPostFlag,
    lastMessageAt: conv.messages[0]?.createdAt.toISOString() ?? null,
  };
}

export async function listConversations(
  actorId: string,
  teamId: string,
): Promise<ConversationDTO[]> {
  const access = await resolveTeamAccess(actorId, teamId);
  // Backfill defaults for teams created before this slice.
  if (!access.guardian) {
    await ensureTeamConversations(teamId, actorId);
  }

  const convs = await db.conversation.findMany({
    where: { teamId },
    include: {
      group: { select: { name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const dtos: ConversationDTO[] = [];
  const isAlumni = !access.guardian && access.membership.role === "ALUMNI";
  for (const conv of convs) {
    // Check-ins are member-scoped and served by the dedicated endpoint.
    if (conv.kind === "CHECK_IN") continue;
    // Alumni (outer tier) see announcements only — no team chat, no groups.
    if (isAlumni && conv.kind !== "ANNOUNCEMENT") continue;
    // Guardians only see conversations their linked athlete could see.
    if (access.guardian && conv.kind === "GROUP_CHAT" && conv.groupId) {
      const linked = await db.guardianLink.findFirst({
        where: {
          guardianId: actorId,
          status: "VERIFIED",
          athlete: {
            OR: [
              { memberships: { some: { teamId, status: "ACTIVE", role: { in: ["COACH", "TEAM_ADMIN"] } } } },
              { groupMemberships: { some: { groupId: conv.groupId } } },
            ],
          },
        },
        select: { id: true },
      });
      if (!linked) continue;
    }
    dtos.push(toConversationDTO(conv, await canPost(access, conv, teamId, actorId)));
  }
  return dtos;
}

type MessageWithAuthor = {
  id: string;
  conversationId: string;
  authorId: string;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  author: { displayName: string };
  conversation: { teamId: string };
};

async function toMessageDTO(
  m: MessageWithAuthor,
  authorRole: string,
  mentions: Map<string, { userId: string; displayName: string }[]>,
): Promise<ChatMessageDTO> {
  const deleted = m.deletedAt !== null;
  return {
    id: m.id,
    conversationId: m.conversationId,
    authorId: m.authorId,
    authorName: m.author.displayName,
    authorRole,
    body: deleted ? null : m.body,
    mentions: mentions.get(m.id) ?? [],
    deleted,
    createdAt: m.createdAt.toISOString(),
    editedAt: m.editedAt?.toISOString() ?? null,
  };
}

async function authorRoles(userIds: string[], teamId: string): Promise<Map<string, string>> {
  const memberships = await db.teamMembership.findMany({
    where: { teamId, userId: { in: userIds } },
    select: { userId: true, role: true },
  });
  return new Map(memberships.map((m) => [m.userId, m.role]));
}

export async function listMessages(
  actorId: string,
  teamId: string,
  convId: string,
  before?: string,
  limit = 50,
): Promise<{ messages: ChatMessageDTO[]; hasMore: boolean }> {
  const access = await resolveTeamAccess(actorId, teamId);
  const conv = await getConversation(teamId, convId);
  if (conv.kind === "CHECK_IN") {
    await requireCheckInParticipant(conv.id, actorId);
  }
  // Alumni (outer tier) may only read announcements.
  if (
    conv.kind !== "CHECK_IN" &&
    !access.guardian &&
    access.membership.role === "ALUMNI" &&
    conv.kind !== "ANNOUNCEMENT"
  ) {
    throw notFound("Conversation not found");
  }

  const where = {
    conversationId: conv.id,
    ...(before ? { createdAt: { lt: new Date(before) } } : {}),
  };
  const rows = await db.message.findMany({
    where,
    include: {
      author: { select: { displayName: true } },
      conversation: { select: { teamId: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const page = (hasMore ? rows.slice(0, limit) : rows).reverse();
  const roles = await authorRoles(page.map((m) => m.authorId), teamId);
  return {
    messages: await Promise.all(
      page.map(async (m) => {
        const mentions = await mentionRefsFor("MESSAGE", [m.id]);
        return toMessageDTO(m, roles.get(m.authorId) ?? "RUNNER", mentions);
      }),
    ),
    hasMore,
  };
}

export async function postMessage(
  actorId: string,
  teamId: string,
  convId: string,
  input: SendMessageInput,
  ipAddress?: string,
): Promise<ChatMessageDTO> {
  const access = await resolveTeamAccess(actorId, teamId);
  const conv = await getConversation(teamId, convId);
  if (!(await canPost(access, conv, teamId, actorId))) {
    throw forbidden(
      conv.kind === "ANNOUNCEMENT"
        ? "Only coaches can post announcements"
        : "You cannot post in this conversation",
    );
  }

  const message = await db.message.create({
    data: { conversationId: conv.id, authorId: actorId, body: input.body },
    include: {
      author: { select: { displayName: true } },
      conversation: { select: { teamId: true } },
    },
  });

  await audit({
    actorId,
    action: "MESSAGE_POSTED",
    entityType: "Message",
    entityId: message.id,
    metadata: { teamId, conversationId: conv.id, kind: conv.kind },
    ipAddress,
  });

  await syncMentions({
    targetType: "MESSAGE",
    targetId: message.id,
    teamId,
    mentionerId: actorId,
    mentionerName: message.author.displayName,
    text: message.body,
    link: `/teams/${teamId}/messages`,
  });

  const roles = await authorRoles([actorId], teamId);
  const mentions = await mentionRefsFor("MESSAGE", [message.id]);
  return toMessageDTO(message, roles.get(actorId) ?? "RUNNER", mentions);
}

async function getMessage(messageId: string) {
  const message = await db.message.findUnique({
    where: { id: messageId },
    include: {
      author: { select: { displayName: true } },
      conversation: { select: { id: true, teamId: true, kind: true } },
    },
  });
  if (!message) throw notFound("Message not found");
  return message;
}

export async function editMessage(
  actorId: string,
  messageId: string,
  body: string,
  ipAddress?: string,
): Promise<ChatMessageDTO> {
  const message = await getMessage(messageId);
  await resolveTeamAccess(actorId, message.conversation.teamId);
  if (message.authorId !== actorId) {
    throw forbidden("You can only edit your own messages");
  }
  if (message.deletedAt) {
    throw forbidden("This message was removed");
  }

  const updated = await db.message.update({
    where: { id: messageId },
    data: { body, editedAt: new Date() },
    include: {
      author: { select: { displayName: true } },
      conversation: { select: { teamId: true } },
    },
  });

  await audit({
    actorId,
    action: "MESSAGE_EDITED",
    entityType: "Message",
    entityId: messageId,
    ipAddress,
  });

  await syncMentions({
    targetType: "MESSAGE",
    targetId: updated.id,
    teamId: message.conversation.teamId,
    mentionerId: actorId,
    mentionerName: updated.author.displayName,
    text: updated.body,
    link: `/teams/${message.conversation.teamId}/messages`,
  });

  const roles = await authorRoles([actorId], message.conversation.teamId);
  const mentions = await mentionRefsFor("MESSAGE", [updated.id]);
  return toMessageDTO(updated, roles.get(actorId) ?? "RUNNER", mentions);
}

export async function deleteMessage(
  actorId: string,
  messageId: string,
  ipAddress?: string,
): Promise<void> {
  const message = await getMessage(messageId);
  const access = await resolveTeamAccess(actorId, message.conversation.teamId);
  const isAuthor = message.authorId === actorId;
  // Check-ins are private to their participants — no outside moderation.
  if (message.conversation.kind === "CHECK_IN") {
    await requireCheckInParticipant(message.conversation.id, actorId);
  }
  const isManager =
    message.conversation.kind !== "CHECK_IN" &&
    !access.guardian &&
    access.membership &&
    isManagerRole(access.membership.role);
  if (!isAuthor && !isManager) {
    throw forbidden("You cannot delete this message");
  }
  if (message.deletedAt) return;

  await db.message.update({
    where: { id: messageId },
    data: { deletedAt: new Date(), deletedById: actorId },
  });

  await audit({
    actorId,
    action: "MESSAGE_DELETED",
    entityType: "Message",
    entityId: messageId,
    metadata: {
      teamId: message.conversation.teamId,
      moderated: !isAuthor,
      originalAuthorId: message.authorId,
    },
    ipAddress,
  });
}

// ─── Check-ins: youth-safe coach/runner channel ─────────────────────────
// A check-in is a CHECK_IN conversation whose participants are the coach,
// the runner, and — for minors — ALL of the runner's verified guardians.
// No adult/minor private channel can exist without the guardian.

async function requireCheckInParticipant(
  conversationId: string,
  userId: string,
): Promise<void> {
  const participant = await db.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!participant) throw notFound("Conversation not found");
}

function checkInScopeKey(coachId: string, runnerId: string): string {
  const [a, b] = [coachId, runnerId].sort();
  return `CHECK_IN:${a}:${b}`;
}

export interface CheckInDTO {
  id: string;
  title: string;
  coachId: string;
  coachName: string;
  runnerId: string;
  runnerName: string;
  guardianNames: string[];
  lastMessageAt: string | null;
  canPost: boolean;
}

async function toCheckInDTO(
  conv: {
    id: string;
    title: string;
    createdById: string;
    participants: { userId: string; user: { displayName: string } }[];
    messages: { createdAt: Date }[];
  },
  teamId: string,
  actorId: string,
  access: TeamAccess,
): Promise<CheckInDTO> {
  const roles = await authorRoles(
    conv.participants.map((p) => p.userId),
    teamId,
  );
  let coachId = "";
  let coachName = "";
  let runnerId = "";
  let runnerName = "";
  const guardianNames: string[] = [];
  for (const p of conv.participants) {
    const role = roles.get(p.userId);
    if (role === "COACH" && !coachId) {
      coachId = p.userId;
      coachName = p.user.displayName;
    } else if (role === "RUNNER" && !runnerId) {
      runnerId = p.userId;
      runnerName = p.user.displayName;
    } else {
      guardianNames.push(p.user.displayName);
    }
  }
  return {
    id: conv.id,
    title: conv.title,
    coachId,
    coachName,
    runnerId,
    runnerName,
    guardianNames,
    lastMessageAt: conv.messages[0]?.createdAt.toISOString() ?? null,
    canPost: await canPost(
      access,
      { kind: "CHECK_IN", groupId: null, id: conv.id },
      teamId,
      actorId,
    ),
  };
}

/**
 * Open (or find) the check-in channel between a coach and a runner.
 * Either side — or the runner's verified guardian — may initiate.
 * Minors require at least one verified guardian, who is always included.
 */
export async function createCheckIn(
  actorId: string,
  teamId: string,
  coachId: string,
  runnerId: string,
  ipAddress?: string,
): Promise<CheckInDTO> {
  const access = await resolveTeamAccess(actorId, teamId);

  const [coachMembership, runnerMembership] = await Promise.all([
    db.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId: coachId } },
    }),
    db.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId: runnerId } },
    }),
  ]);
  if (
    !coachMembership ||
    coachMembership.status !== "ACTIVE" ||
    coachMembership.role !== "COACH"
  ) {
    throw badRequest("Coach must be an active coach on this team");
  }
  if (!runnerMembership || runnerMembership.status !== "ACTIVE") {
    throw badRequest("Runner must be an active member of this team");
  }

  // The initiator must be the coach, the runner, or the runner's guardian.
  const isCoach = actorId === coachId;
  const isRunner = actorId === runnerId;
  let guardianLink: { id: string } | null = null;
  if (!isCoach && !isRunner) {
    guardianLink = await db.guardianLink.findFirst({
      where: { guardianId: actorId, athleteId: runnerId, status: "VERIFIED" },
      select: { id: true },
    });
    if (!guardianLink) throw forbidden("You cannot start this check-in");
  }

  const runner = await db.user.findUnique({
    where: { id: runnerId },
    select: { dateOfBirth: true, displayName: true },
  });
  if (!runner) throw notFound("Runner not found");
  const minor = consentRequiredFor(runner.dateOfBirth);

  // Minors: every verified guardian joins the channel. No exceptions.
  let guardianIds: string[] = [];
  if (minor) {
    const links = await db.guardianLink.findMany({
      where: { athleteId: runnerId, status: "VERIFIED" },
      select: { guardianId: true },
    });
    if (links.length === 0) {
      throw badRequest(
        "A verified guardian is required before a minor can message a coach",
      );
    }
    guardianIds = links.map((l) => l.guardianId);
  }

  const scopeKey = checkInScopeKey(coachId, runnerId);
  const existing = await db.conversation.findFirst({
    where: { teamId, scopeKey },
    include: {
      participants: { include: { user: { select: { displayName: true } } } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });
  if (existing) {
    // Fold in guardians verified since the channel was created.
    const known = new Set(existing.participants.map((p) => p.userId));
    const missing = [coachId, runnerId, ...guardianIds].filter(
      (id) => !known.has(id),
    );
    if (missing.length > 0) {
      await db.conversationParticipant.createMany({
        data: missing.map((userId) => ({
          conversationId: existing.id,
          userId,
        })),
        skipDuplicates: true,
      });
      existing.participants.push(
        ...(await db.conversationParticipant.findMany({
          where: { conversationId: existing.id, userId: { in: missing } },
          include: { user: { select: { displayName: true } } },
        })),
      );
    }
    await requireCheckInParticipant(existing.id, actorId);
    return toCheckInDTO(existing, teamId, actorId, access);
  }

  const participantIds = [...new Set([coachId, runnerId, ...guardianIds])];
  const conv = await db.conversation.create({
    data: {
      teamId,
      kind: "CHECK_IN",
      scopeKey,
      title: `Check-in with ${runner.displayName}`,
      createdById: actorId,
      participants: {
        create: participantIds.map((userId) => ({ userId })),
      },
    },
    include: {
      participants: { include: { user: { select: { displayName: true } } } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  await audit({
    actorId,
    action: "CHECK_IN_CREATED",
    entityType: "Conversation",
    entityId: conv.id,
    metadata: { teamId, coachId, runnerId, minor },
    ipAddress,
  });

  return toCheckInDTO(conv, teamId, actorId, access);
}

/** Check-ins the caller participates in. */
export async function listCheckIns(
  actorId: string,
  teamId: string,
): Promise<CheckInDTO[]> {
  const access = await resolveTeamAccess(actorId, teamId);
  const convs = await db.conversation.findMany({
    where: {
      teamId,
      kind: "CHECK_IN",
      participants: { some: { userId: actorId } },
    },
    include: {
      participants: { include: { user: { select: { displayName: true } } } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return Promise.all(
    convs.map((c) => toCheckInDTO(c, teamId, actorId, access)),
  );
}

/**
 * Whether the caller (as a runner) can open a check-in right now.
 * Drives the "Talk to my coach" vs "Ask a parent to connect first" UI.
 */
export async function checkInStatus(
  actorId: string,
  teamId: string,
): Promise<{
  isMinor: boolean;
  hasVerifiedGuardian: boolean;
  guardianRequired: boolean;
}> {
  await resolveTeamAccess(actorId, teamId);
  const user = await db.user.findUnique({
    where: { id: actorId },
    select: { dateOfBirth: true },
  });
  const isMinor = consentRequiredFor(user?.dateOfBirth ?? null);
  let hasVerifiedGuardian = false;
  if (isMinor) {
    const link = await db.guardianLink.findFirst({
      where: { athleteId: actorId, status: "VERIFIED" },
      select: { id: true },
    });
    hasVerifiedGuardian = !!link;
  }
  return {
    isMinor,
    hasVerifiedGuardian,
    guardianRequired: isMinor && !hasVerifiedGuardian,
  };
}
