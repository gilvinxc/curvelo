import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ActivityDTO, PostDTO } from "@curvelo/shared";
import { api, ApiError } from "../../lib/api";
import { Avatar, Button, ErrorBanner, TextArea } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import {
  activitySummary,
  activityTitle,
  formatActivityDateShort,
} from "../../lib/activityFormat";
import { useUnits } from "../../lib/units";
import { ActivityPicker } from "./ActivityPicker";

/** Post composer: optional text + optional shared activity. */
export function Composer({
  teamId,
  onPosted,
}: {
  teamId: string;
  onPosted: (post: PostDTO) => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [activity, setActivity] = useState<ActivityDTO | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const units = useUnits();

  const canPost = body.trim().length > 0 || activity !== null;

  const postMutation = useMutation({
    mutationFn: () =>
      api.createPost(teamId, {
        body: body.trim() || undefined,
        activityId: activity?.id,
      }),
    onSuccess: (data) => {
      setBody("");
      setActivity(null);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["feed", teamId] });
      onPosted(data.post);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "INVALID_ACTIVITY") {
        setError("That run can't be shared — it may be private or from another team.");
      } else {
        setError(err instanceof ApiError ? err.message : "Couldn't post. Try again.");
      }
    },
  });

  return (
    <div className="rounded-2xl border border-white/10 bg-ink-900 p-4 shadow-card">
      <div className="flex gap-3">
        <Avatar name={user?.displayName ?? "?"} size="sm" className="mt-1" />
        <div className="min-w-0 flex-1">
          <TextArea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Share something with the team…"
            aria-label="Post to team feed"
            className="min-h-[72px]"
          />
        </div>
      </div>

      {activity && (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-volt-400/30 bg-volt-400/5 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-mist">
              Sharing run
            </p>
            <p className="truncate text-[14px] font-bold">
              {activityTitle(activity)}
            </p>
            <p className="text-[13px] text-mist">
              {formatActivityDateShort(activity.startedAt)} ·{" "}
              {activitySummary(activity, units)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActivity(null)}
            aria-label="Remove shared run"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-mist hover:bg-white/10 hover:text-ink-50"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {error && (
        <div className="mt-3">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => setPickerOpen(true)}
          className="min-h-[44px] px-4 text-[14px]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
          </svg>
          Share a run
        </Button>
        <Button
          type="button"
          disabled={!canPost}
          loading={postMutation.isPending}
          onClick={() => postMutation.mutate()}
          className="min-h-[44px] px-6 text-[14px]"
        >
          Post
        </Button>
      </div>

      <ActivityPicker
        teamId={teamId}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={setActivity}
      />
    </div>
  );
}
