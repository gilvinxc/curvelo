/**
 * @-mention matching. The composer inserts "@Display Name"; the server and
 * the renderer match those tokens against known teammate display names.
 */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns the subset of `names` that appear in `text` as @-mentions
 * (case-insensitive, must not be immediately followed by a word character).
 * Names are returned as given in `names`.
 */
export function matchMentionedNames(text: string, names: string[]): string[] {
  const found: string[] = [];
  for (const name of names) {
    if (!name) continue;
    const re = new RegExp(`@${escapeRegExp(name)}(?![\\w])`, "i");
    if (re.test(text)) found.push(name);
  }
  return found;
}

/** Split text into plain/mention segments for link rendering. */
export type TextSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; name: string; userId: string };

export function splitMentions(
  text: string,
  mentions: Array<{ displayName: string; userId: string }>,
): TextSegment[] {
  const sorted = [...mentions].sort((a, b) => b.displayName.length - a.displayName.length);
  const segments: TextSegment[] = [];
  let rest = text;
  while (rest) {
    let earliest: { index: number; m: (typeof sorted)[number] } | null = null;
    for (const m of sorted) {
      const re = new RegExp(`@${escapeRegExp(m.displayName)}(?![\\w])`, "i");
      const match = re.exec(rest);
      if (match && (earliest === null || match.index < earliest.index)) {
        earliest = { index: match.index, m };
      }
    }
    if (!earliest) {
      segments.push({ kind: "text", text: rest });
      break;
    }
    if (earliest.index > 0) {
      segments.push({ kind: "text", text: rest.slice(0, earliest.index) });
    }
    const matchedLen = earliest.m.displayName.length + 1; // "@" + name
    segments.push({
      kind: "mention",
      name: rest.slice(earliest.index, earliest.index + matchedLen),
      userId: earliest.m.userId,
    });
    rest = rest.slice(earliest.index + matchedLen);
  }
  return segments;
}
