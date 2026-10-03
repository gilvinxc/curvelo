import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ApiError, api } from "../../lib/api";
import {
  Button,
  ErrorBanner,
  Field,
  TextArea,
} from "../../components/ui";

/**
 * AI-drafted weekly parent recap. The coach reviews and edits the draft,
 * then publishes it as a team announcement. The AI drafts — it never
 * posts on its own.
 */
export function WeeklyRecapDialog({
  teamId,
  onClose,
}: {
  teamId: string;
  onClose: () => void;
}) {
  const [body, setBody] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);

  const draftMutation = useMutation({
    mutationFn: () => api.draftWeeklyRecap(teamId),
    onSuccess: (res) => {
      setBody(res.draft);
      setError(null);
    },
    onError: (err) => {
      setError(
        err instanceof ApiError ? err.message : "Couldn't draft the recap.",
      );
    },
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      const convs = await api.listConversations(teamId);
      const announcement = convs.conversations.find(
        (c) => c.kind === "ANNOUNCEMENT",
      );
      if (!announcement) throw new Error("No announcement channel found.");
      return api.postMessage(teamId, announcement.id, (body ?? "").trim());
    },
    onSuccess: () => {
      setPublished(true);
      setError(null);
    },
    onError: (err) => {
      setError(
        err instanceof ApiError ? err.message : "Couldn't publish the recap.",
      );
    },
  });

  // Draft on open.
  useEffect(() => {
    if (body === null && !draftMutation.isPending && !draftMutation.isError) {
      draftMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const valid = (body ?? "").trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/10 bg-ink-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[18px] font-extrabold tracking-tight">
          Weekly parent recap
        </h3>
        <p className="mt-1 text-[13px] text-mist">
          AI-drafted from this week's team stats. Review and edit before
          publishing — it goes out as a team announcement.
        </p>

        <div className="mt-4">
          {draftMutation.isPending && (
            <p className="text-[14px] text-mist">Drafting the recap…</p>
          )}
          {error && <ErrorBanner message={error} />}
          {published ? (
            <p className="rounded-2xl border border-lime-400/30 bg-lime-400/10 px-4 py-3 text-[14px] font-bold text-lime-200">
              Published to the team announcements. 🎉
            </p>
          ) : (
            body !== null && (
              <Field label="Recap">
                <TextArea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={12}
                />
              </Field>
            )
          )}
        </div>

        <div className="mt-4 flex gap-2">
          {!published && body !== null && (
            <Button
              onClick={() => publishMutation.mutate()}
              disabled={!valid || publishMutation.isPending}
              className="min-h-[48px] flex-1"
            >
              {publishMutation.isPending ? "Publishing…" : "Publish recap"}
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={onClose}
            className="min-h-[48px] flex-1"
          >
            {published ? "Done" : "Cancel"}
          </Button>
        </div>
      </div>
    </div>
  );
}
