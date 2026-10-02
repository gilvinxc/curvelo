import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ConversationDTO } from "@curvelo/shared";
import { api } from "../../lib/api";
import {
  Card,
  EmptyState,
  ErrorBanner,
  FullScreenLoader,
} from "../../components/ui";
import { cn } from "../../components/cx";
import {
  CAN_MODERATE,
  MessageThread,
  timeAgo,
} from "./MessageThread";

function ConversationIcon({ kind }: { kind: string }) {
  if (kind === "ANNOUNCEMENT") {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#facc15" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
        <path d="m3 11 18-5v12L3 13v-2z" />
        <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
      </svg>
    );
  }
  if (kind === "GROUP_CHAT") {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a7ae97" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a7ae97" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  );
}

const KIND_RANK: Record<string, number> = {
  ANNOUNCEMENT: 0,
  TEAM_CHAT: 1,
  GROUP_CHAT: 2,
};

export function MessagesSection({
  teamId,
  myRole,
  readOnly = false,
}: {
  teamId: string;
  myRole?: string | null;
  readOnly?: boolean;
}) {
  const conversationsQuery = useQuery({
    queryKey: ["conversations", teamId],
    queryFn: () => api.listConversations(teamId),
    enabled: !!teamId,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const conversations = [...(conversationsQuery.data?.conversations ?? [])].sort(
    (a, b) =>
      (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9) ||
      a.title.localeCompare(b.title),
  );

  useEffect(() => {
    // Auto-open the first conversation once the list loads.
    if (!selectedId && conversations.length > 0) {
      setSelectedId(conversations[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationsQuery.data]);

  if (conversationsQuery.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <FullScreenLoader />
      </div>
    );
  }
  if (conversationsQuery.isError) {
    return <ErrorBanner message="Couldn't load conversations." />;
  }
  if (conversations.length === 0) {
    return (
      <EmptyState
        title="No conversations yet"
        body="Conversations appear here once the team sets them up."
      />
    );
  }

  const selected: ConversationDTO | undefined = conversations.find(
    (c) => c.id === selectedId,
  );
  const canModerate = !readOnly && !!myRole && CAN_MODERATE.has(myRole);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Conversations">
        {conversations.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={c.id === selected?.id}
            onClick={() => setSelectedId(c.id)}
            className={cn(
              "flex min-h-[48px] shrink-0 items-center gap-2.5 rounded-xl border px-4 py-2.5 text-left transition",
              c.id === selected?.id
                ? "border-volt-400/50 bg-volt-400/10"
                : "border-white/10 bg-white/5 hover:border-white/25",
            )}
          >
            <ConversationIcon kind={c.kind} />
            <span className="max-w-[160px]">
              <span className="block truncate text-[14px] font-bold text-ink-50">
                {c.title}
              </span>
              <span className="block truncate text-[12px] text-mist">
                {timeAgo(c.lastMessageAt)}
              </span>
            </span>
          </button>
        ))}
      </div>

      {selected ? (
        <MessageThread
          teamId={teamId}
          conversation={selected}
          readOnly={readOnly}
          canModerate={canModerate}
        />
      ) : (
        <Card>
          <p className="py-4 text-center text-[14px] text-mist">
            Pick a conversation above to read the thread.
          </p>
        </Card>
      )}
    </div>
  );
}
