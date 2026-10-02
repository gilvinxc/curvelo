import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ActivityDTO } from "@curvelo/shared";
import { api, ApiError } from "../../lib/api";
import {
  Button,
  EmptyState,
  ErrorBanner,
  Modal,
  TextArea,
} from "../../components/ui";
import { cn } from "../../components/cx";
import { activitySummary, activityTitle } from "../../lib/activityFormat";

/** Share an activity to a team's feed, with an optional message. */
export function ShareToFeedDialog({
  activity,
  open,
  onClose,
}: {
  activity: ActivityDTO;
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [teamId, setTeamId] = useState<string | null>(activity.teamId);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const teamsQuery = useQuery({
    queryKey: ["teams"],
    queryFn: () => api.listTeams(),
    enabled: open,
  });

  const shareMutation = useMutation({
    mutationFn: () =>
      api.createPost(teamId!, {
        body: message.trim() || undefined,
        activityId: activity.id,
      }),
    onSuccess: () => {
      onClose();
      navigate(`/teams/${teamId}/feed`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "INVALID_ACTIVITY") {
        setError("That run can't be shared to this team — check its visibility.");
      } else {
        setError(err instanceof ApiError ? err.message : "Couldn't share the run.");
      }
    },
  });

  const teams = teamsQuery.data?.teams ?? [];

  return (
    <Modal open={open} onClose={onClose} title="Share to team feed">
      <div className="rounded-xl border border-volt-400/30 bg-volt-400/5 px-4 py-3">
        <p className="truncate text-[14px] font-bold text-volt-300">
          {activityTitle(activity)}
        </p>
        <p className="text-[13px] text-mist">{activitySummary(activity)}</p>
      </div>

      <div className="mt-4">
        <span className="mb-1.5 block text-[13px] font-semibold uppercase tracking-wide text-mist">
          Team
        </span>
        {teamsQuery.isLoading ? (
          <p className="py-2 text-[14px] text-mist">Loading teams…</p>
        ) : teamsQuery.isError ? (
          <ErrorBanner message="Couldn't load your teams." />
        ) : teams.length === 0 ? (
          <EmptyState title="No teams" body="Join a team first to share runs." />
        ) : (
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Team">
            {teams.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={teamId === t.id}
                onClick={() => setTeamId(t.id)}
                className={cn(
                  "min-h-[48px] rounded-xl border px-4 text-left text-[15px] font-semibold transition",
                  teamId === t.id
                    ? "border-volt-400/60 bg-volt-400/10 text-ink-50"
                    : "border-white/10 bg-ink-800 text-mist hover:text-ink-50",
                )}
              >
                {t.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        <TextArea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Say something about this run (optional)…"
          aria-label="Message with shared run"
          className="min-h-[72px]"
        />
      </div>

      {error && (
        <div className="mt-3">
          <ErrorBanner message={error} />
        </div>
      )}

      <Button
        disabled={!teamId}
        loading={shareMutation.isPending}
        onClick={() => shareMutation.mutate()}
        className="mt-4 w-full"
      >
        Share to feed
      </Button>
    </Modal>
  );
}
