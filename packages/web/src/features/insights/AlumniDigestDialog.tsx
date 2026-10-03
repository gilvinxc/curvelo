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
 * AI-drafted alumni update. The coach reviews and edits the draft, then
 * publishes it as an announcement (which alumni can see). The AI drafts —
 * it never posts on its own.
 */
export function AlumniDigestDialog({
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
    mutationFn: () => api.draftAlumniDigest(teamId),
    onSuccess: (res) => {
      setBody(res.draft);
      setError(null);
    },
    onError: (err) => {
      setError(
        err instanceof ApiError ? err.message : "Couldn't draft the update.",
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
        err instanceof ApiError ? err.message : "Couldn't publish the update.",
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
          Alumni update
        </h3>
        <p className="mt-1 text-[13px] text-mist">
          AI-drafted from recent team highlights. Review it — you publish, not
          the AI.
        </p>
        {error && (
          <div className="mt-3">
            <ErrorBanner message={error} />
          </div>
        )}
        {published ? (
          <div className="mt-4">
            <p className="text-[14px] font-semibold text-volt-200">
              Published as an announcement. Alumni can see it now.
            </p>
            <Button
              variant="secondary"
              className="mt-4 min-h-[48px] w-full"
              onClick={onClose}
            >
              Done
            </Button>
          </div>
        ) : draftMutation.isPending || body === null ? (
          <p className="py-8 text-center text-[14px] text-mist">
            Drafting from recent highlights…
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            <Field label="Draft">
              <TextArea
                value={body}
                rows={10}
                maxLength={2000}
                onChange={(e) => setBody(e.target.value)}
              />
            </Field>
            <div className="flex gap-2">
              <Button
                className="min-h-[48px] flex-1"
                disabled={!valid || publishMutation.isPending}
                onClick={() => publishMutation.mutate()}
              >
                {publishMutation.isPending ? "Publishing…" : "Publish as announcement"}
              </Button>
              <Button
                variant="secondary"
                className="min-h-[48px] px-5"
                onClick={onClose}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
