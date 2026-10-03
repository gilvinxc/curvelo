import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { CheckInDTO, ConversationDTO } from "@curvelo/shared";
import { ApiError, api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Modal,
} from "../../components/ui";
import { MessageThread, timeAgo } from "./MessageThread";

function asConversation(c: CheckInDTO): ConversationDTO {
  return {
    id: c.id,
    kind: "CHECK_IN",
    title: c.title,
    groupId: null,
    groupName: null,
    canPost: c.canPost,
    lastMessageAt: c.lastMessageAt,
  };
}

function CheckInRow({
  checkIn,
  subtitle,
  selected,
  onSelect,
}: {
  checkIn: CheckInDTO;
  subtitle: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      aria-selected={selected}
      className={`flex min-h-[56px] w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${
        selected
          ? "border-volt-400/50 bg-volt-400/10"
          : "border-white/10 bg-white/5 hover:border-white/25"
      }`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-volt-400/15 text-[16px]">
        💬
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-bold text-ink-50">
          {checkIn.title}
        </span>
        <span className="block truncate text-[12px] text-mist">
          {subtitle}
          {checkIn.lastMessageAt ? ` · ${timeAgo(checkIn.lastMessageAt)}` : ""}
        </span>
      </span>
      <span className="shrink-0 text-mist">›</span>
    </button>
  );
}

/** Runner flow: pick a coach, open (or create) the check-in channel. */
function TalkToCoach({ teamId, onOpen }: { teamId: string; onOpen: (c: CheckInDTO) => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ["checkInStatus", teamId],
    queryFn: () => api.checkInStatus(teamId),
    enabled: !!teamId,
  });
  const coachesQuery = useQuery({
    queryKey: ["teamCoaches", teamId],
    queryFn: async () => {
      const { roster } = await api.getRoster(teamId);
      return roster.filter((m) => m.role === "COACH");
    },
    enabled: pickerOpen,
  });

  const create = useMutation({
    mutationFn: (coachId: string) =>
      api.createCheckIn(teamId, { coachId, runnerId: user!.id }),
    onSuccess: ({ checkIn }) => {
      void queryClient.invalidateQueries({ queryKey: ["checkIns", teamId] });
      setPickerOpen(false);
      onOpen(checkIn);
    },
    onError: (err) => {
      setError(
        err instanceof ApiError ? err.message : "Couldn't open the check-in.",
      );
    },
  });

  const status = statusQuery.data?.status;
  if (statusQuery.isLoading) return null;
  if (status?.guardianRequired) {
    return (
      <Card className="border-amber-400/30">
        <p className="text-[14px] font-bold text-ink-50">
          Ask a parent to connect first
        </p>
        <p className="mt-1 text-[13px] text-mist">
          To keep you safe, a verified parent or guardian joins every
          coach check-in. Ask them to accept the guardian invite, then come
          back here.
        </p>
        <Link to="/family" className="mt-3 inline-block">
          <Button variant="secondary" className="min-h-[44px]">
            Go to Family
          </Button>
        </Link>
      </Card>
    );
  }

  return (
    <>
      {error && <ErrorBanner message={error} />}
      <Button onClick={() => setPickerOpen(true)} className="min-h-[48px] w-full">
        💬 Talk to my coach
      </Button>
      <Modal open={pickerOpen} onClose={() => setPickerOpen(false)} title="Choose a coach">
        {coachesQuery.isLoading && (
          <p className="py-4 text-center text-[14px] text-mist">Loading coaches…</p>
        )}
        {coachesQuery.isError && (
          <ErrorBanner message="Couldn't load the coaches." />
        )}
        <div className="flex flex-col gap-2">
          {(coachesQuery.data ?? []).map((c) => (
            <button
              key={c.userId}
              disabled={create.isPending}
              onClick={() => create.mutate(c.userId)}
              className="flex min-h-[52px] items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:border-white/25 disabled:opacity-50"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-[14px] font-bold text-ink-50">
                {c.displayName.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-bold text-ink-50">
                  {c.displayName}
                </span>
                <span className="block text-[12px] text-mist">
                  Your parent or guardian is always included
                </span>
              </span>
            </button>
          ))}
          {coachesQuery.data?.length === 0 && (
            <p className="py-4 text-center text-[14px] text-mist">
              No coaches on this team yet.
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}

/**
 * Youth-safe check-ins: a coach + runner (+ verified guardians for minors)
 * channel. No adult/minor private DMs can exist.
 */
export function CheckInSection({
  teamId,
  myRole,
  mode,
}: {
  teamId: string;
  myRole?: string | null;
  mode: "member" | "guardian";
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const checkInsQuery = useQuery({
    queryKey: ["checkIns", teamId],
    queryFn: () => api.listCheckIns(teamId),
    enabled: !!teamId,
  });

  const checkIns = checkInsQuery.data?.checkIns ?? [];
  const selected = checkIns.find((c) => c.id === selectedId);
  const isCoach = mode === "member" && myRole === "COACH";

  if (checkInsQuery.isLoading) return null;
  if (checkInsQuery.isError) {
    return <ErrorBanner message="Couldn't load check-ins." />;
  }

  const openThread = (c: CheckInDTO) => setSelectedId(c.id);

  return (
    <div className="mb-6">
      <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
        Check-ins
      </h2>

      {mode === "member" && !isCoach && (
        <div className="mb-3">
          <TalkToCoach teamId={teamId} onOpen={openThread} />
        </div>
      )}

      {checkIns.length === 0 ? (
        mode === "guardian" || isCoach ? (
          <EmptyState
            title="No check-ins yet"
            body={
              isCoach
                ? "When a runner starts a check-in with you, it shows up here."
                : "Your athlete's coach check-ins will appear here."
            }
          />
        ) : null
      ) : (
        <div className="mb-3 flex flex-col gap-2">
          {checkIns.map((c) => (
            <CheckInRow
              key={c.id}
              checkIn={c}
              subtitle={
                isCoach
                  ? c.guardianNames.length > 0
                    ? `with ${c.guardianNames.join(", ")}`
                    : "Coach + runner"
                  : mode === "guardian"
                    ? `with ${c.coachName}`
                    : c.guardianNames.length > 0
                      ? `${c.coachName} · ${c.guardianNames.join(", ")} included`
                      : c.coachName
              }
              selected={c.id === selectedId}
              onSelect={() => openThread(c)}
            />
          ))}
        </div>
      )}

      {selected ? (
        <MessageThread
          teamId={teamId}
          conversation={asConversation(selected)}
          canModerate={false}
        />
      ) : (
        checkIns.length > 0 && (
          <Card>
            <p className="py-4 text-center text-[14px] text-mist">
              Pick a check-in above to read the thread.
            </p>
          </Card>
        )
      )}
    </div>
  );
}
