import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ActivityDTO, PostDTO } from "@curvelo/shared";
import { api, ApiError } from "../../lib/api";
import { Avatar, Button, ErrorBanner } from "../../components/ui";
import { MentionTextarea } from "../../components/MentionTextarea";
import { PhotoPicker } from "../photos/PhotoPicker";
import { PhotoImg } from "../../components/PhotoImg";
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
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [photoPickerOpen, setPhotoPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const units = useUnits();

  const canPost = body.trim().length > 0 || activity !== null || photoIds.length > 0;

  const postMutation = useMutation({
    mutationFn: () =>
      api.createPost(teamId, {
        body: body.trim() || undefined,
        activityId: activity?.id,
        photoIds: photoIds.length > 0 ? photoIds : undefined,
      }),
    onSuccess: (data) => {
      setBody("");
      setActivity(null);
      setPhotoIds([]);
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
          <MentionTextarea
            teamId={teamId}
            value={body}
            onChange={setBody}
            placeholder="Share something with the team…"
            rows={3}
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

      {photoIds.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {photoIds.map((id) => (
            <div key={id} className="relative">
              <PhotoImg
                photoId={id}
                alt="Attached photo"
                className="aspect-square w-full rounded-xl object-cover"
              />
              <button
                type="button"
                aria-label="Remove photo"
                onClick={() => setPhotoIds((ids) => ids.filter((x) => x !== id))}
                className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex gap-2">
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
          variant="secondary"
          onClick={() => setPhotoPickerOpen(true)}
          className="min-h-[44px] px-4 text-[14px]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
          </svg>
          Photos
        </Button>
        </div>
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
      <PhotoPicker
        teamId={teamId}
        open={photoPickerOpen}
        selected={photoIds}
        max={5}
        onClose={() => setPhotoPickerOpen(false)}
        onDone={setPhotoIds}
      />
    </div>
  );
}
