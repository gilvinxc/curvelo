import { Link } from "react-router-dom";
import { splitMentions } from "@curvelo/shared";
import type { MentionRef } from "@curvelo/shared";

/**
 * Renders body text with @-mentions as links to the teammate's athlete page.
 * Falls back to plain text when there are no mentions.
 */
export function RichText({
  text,
  mentions,
  teamId,
  className,
}: {
  text: string;
  mentions: MentionRef[];
  teamId: string;
  className?: string;
}) {
  if (!mentions.length) {
    return <span className={className}>{text}</span>;
  }
  const segments = splitMentions(text, mentions);
  return (
    <span className={className}>
      {segments.map((seg, i) =>
        seg.kind === "mention" ? (
          <Link
            key={i}
            to={`/teams/${teamId}/athletes/${seg.userId}`}
            className="font-semibold text-volt-300 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {seg.name}
          </Link>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </span>
  );
}
