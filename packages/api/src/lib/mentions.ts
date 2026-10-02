import { matchMentionedNames } from "@curvelo/shared";
import type { MentionRef } from "@curvelo/shared";
import { db } from "../db.js";

export type MentionTarget = "POST" | "COMMENT" | "MESSAGE" | "ACTIVITY";

interface SyncMentionsInput {
  targetType: MentionTarget;
  targetId: string;
  teamId: string;
  mentionerId: string;
  mentionerName: string;
  text: string | null | undefined;
  /** Where tapping the notification should land. */
  link: string;
}

/**
 * Recompute @-mentions for a target: deletes the old set, matches @Display
 * Name tokens against active team members, and creates Mention rows plus a
 * MENTION notification for each tagged teammate (never for self-tags, never
 * for ambiguous duplicate display names). Safe to call on create and edit.
 */
export async function syncMentions(input: SyncMentionsInput): Promise<void> {
  const { targetType, targetId, teamId, mentionerId, mentionerName, text, link } =
    input;
  await db.mention.deleteMany({ where: { targetType, targetId } });

  if (!text || !text.includes("@")) return;

  const memberships = await db.teamMembership.findMany({
    where: { teamId, status: "ACTIVE" },
    include: { user: { select: { id: true, displayName: true } } },
  });
  const names = memberships.map((m) => m.user.displayName);
  const matched = matchMentionedNames(text, names);

  const seen = new Set<string>();
  for (const name of matched) {
    const candidates = memberships.filter(
      (m) => m.user.displayName.toLowerCase() === name.toLowerCase(),
    );
    // Ambiguous display name: don't guess.
    if (candidates.length !== 1) continue;
    const userId = candidates[0].user.id;
    if (userId === mentionerId || seen.has(userId)) continue;
    seen.add(userId);

    await db.mention.create({
      data: {
        mentionedUserId: userId,
        mentionerId,
        teamId,
        targetType,
        targetId,
        displayName: candidates[0].user.displayName,
      },
    });
    const snippet = text.trim().replace(/\s+/g, " ").slice(0, 140);
    await db.notification.create({
      data: {
        userId,
        type: "MENTION",
        title: `${mentionerName} mentioned you`,
        body: snippet || null,
        link,
      },
    });
  }
}

/** Batch-load mention refs for a list of targets, keyed by target id. */
export async function mentionRefsFor(
  targetType: MentionTarget,
  targetIds: string[],
): Promise<Map<string, MentionRef[]>> {
  const map = new Map<string, MentionRef[]>();
  if (targetIds.length === 0) return map;
  const rows = await db.mention.findMany({
    where: { targetType, targetId: { in: targetIds } },
    select: { targetId: true, mentionedUserId: true, displayName: true },
  });
  for (const r of rows) {
    const list = map.get(r.targetId) ?? [];
    list.push({ userId: r.mentionedUserId, displayName: r.displayName });
    map.set(r.targetId, list);
  }
  return map;
}
