import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PostDTO } from "@curvelo/shared";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import {
  Button,
  ErrorBanner,
  Field,
  Modal,
  Select,
  TextArea,
} from "../../components/ui";

/** Give a teammate a public shoutout — kind words, delivered to the team feed. */
export function ShoutoutDialog({
  teamId,
  open,
  onClose,
  onPosted,
}: {
  teamId: string;
  open: boolean;
  onClose: () => void;
  onPosted: (post: PostDTO) => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [teammateId, setTeammateId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const rosterQuery = useQuery({
    queryKey: ["roster", teamId],
    queryFn: () => api.getRoster(teamId),
    enabled: open,
  });
  const teammates =
    rosterQuery.data?.roster.filter(
      (m) => m.status === "ACTIVE" && m.userId !== user?.id,
    ) ?? [];
  const teammate = teammates.find((m) => m.userId === teammateId);

  const postMutation = useMutation({
    mutationFn: () =>
      api.createPost(teamId, {
        body: `@${teammate!.displayName} ${message.trim()}`,
        kind: "SHOUTOUT",
      }),
    onSuccess: (data) => {
      setTeammateId("");
      setMessage("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["feed", teamId] });
      onClose();
      onPosted(data.post);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Couldn't send the shoutout."),
  });

  const canSend = teammate != null && message.trim().length > 0;

  return (
    <Modal open={open} onClose={onClose} title="Give a shoutout 💛">
      <div className="flex flex-col gap-4">
        {error && <ErrorBanner message={error} />}
        <Field label="Teammate">
          <Select
            value={teammateId}
            onChange={(e) => setTeammateId(e.target.value)}
          >
            <option value="">Choose a teammate…</option>
            {teammates.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Your shoutout"
          hint="Call out effort, progress, or just being a great teammate."
        >
          <TextArea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Thanks for pacing me through the last mile today!"
            maxLength={500}
          />
        </Field>
        <Button
          disabled={!canSend || postMutation.isPending}
          onClick={() => postMutation.mutate()}
          className="w-full"
        >
          {postMutation.isPending ? "Sending…" : "Send shoutout"}
        </Button>
      </div>
    </Modal>
  );
}
