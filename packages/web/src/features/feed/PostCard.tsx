import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { REACTION_EMOJIS } from "@curvelo/shared";
import type { CommentDTO, PostDTO } from "@curvelo/shared";
import { api, ApiError } from "../../lib/api";
import {
  Button,
  ErrorBanner,
  Modal,
  GpsBadge,
  UserAvatar,} from "../../components/ui";
import { cn } from "../../components/cx";
import {
  activitySummary,
  activityTitle,
  formatActivityDateShort,
} from "../../lib/activityFormat";
import { formatRelativeTime } from "./feedFormat";
import { RichText } from "../../components/RichText";
import { MentionTextarea } from "../../components/MentionTextarea";
import { PhotoImg } from "../../components/PhotoImg";

const REPORT_REASONS = [
  "Inappropriate content",
  "Harassment or bullying",
  "Spam",
  "Privacy concern",
  "Something else",
];

function ReportDialog({
  post,
  open,
  onClose,
  onReported,
}: {
  post: PostDTO;
  open: boolean;
  onClose: () => void;
  onReported: () => void;
}) {
  const [reason, setReason] = useState(REPORT_REASONS[0]);
  const [error, setError] = useState<string | null>(null);

  const reportMutation = useMutation({
    mutationFn: () => api.reportPost(post.id, reason),
    onSuccess: () => {
      onClose();
      onReported();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "REPORT_EXISTS") {
        setError("You've already reported this post — a coach will review it.");
      } else {
        setError(err instanceof ApiError ? err.message : "Couldn't send the report.");
      }
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Report post">
      <p className="mb-4 text-[14px] text-mist">
        Flag this post for a coach to review. The author won't be told who
        reported it.
      </p>
      <div className="flex flex-col gap-2" role="radiogroup" aria-label="Report reason">
        {REPORT_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={reason === r}
            onClick={() => setReason(r)}
            className={cn(
              "min-h-[48px] rounded-xl border px-4 text-left text-[15px] font-semibold transition",
              reason === r
                ? "border-volt-400/60 bg-volt-400/10 text-ink-50"
                : "border-white/10 bg-ink-800 text-mist hover:text-ink-50",
            )}
          >
            {r}
          </button>
        ))}
      </div>
      {post.photos && post.photos.length > 0 && (
        <div
          className={`mt-3 grid gap-2 ${
            post.photos.length > 1 ? "grid-cols-2" : "grid-cols-1"
          }`}
        >
          {post.photos.map((ph) => (
            <PhotoImg
              key={ph.id}
              photoId={ph.id}
              alt={ph.caption ?? "Team photo"}
              className="w-full rounded-xl object-cover max-h-80"
            />
          ))}
        </div>
      )}

      {error && (
        <div className="mt-3">
          <ErrorBanner message={error} />
        </div>
      )}
      <Button
        loading={reportMutation.isPending}
        onClick={() => reportMutation.mutate()}
        className="mt-5 w-full"
      >
        Send report
      </Button>
    </Modal>
  );
}

function CommentThread({
  post,
  canModerate,
  currentUserId,
}: {
  post: PostDTO;
  canModerate: boolean;
  currentUserId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const commentsQuery = useQuery({
    queryKey: ["comments", post.id],
    queryFn: () => api.listComments(post.id),
  });

  const addMutation = useMutation({
    mutationFn: () => api.createComment(post.id, draft.trim()),
    onSuccess: () => {
      setDraft("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["comments", post.id] });
      queryClient.invalidateQueries({ queryKey: ["feed", post.teamId] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Couldn't add the comment.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => api.deleteComment(commentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comments", post.id] });
      queryClient.invalidateQueries({ queryKey: ["feed", post.teamId] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Couldn't delete the comment.");
    },
  });

  const comments = commentsQuery.data?.comments ?? [];

  return (
    <div className="mt-3 border-t border-white/10 pt-3">
      {commentsQuery.isLoading ? (
        <p className="py-2 text-[13px] text-mist">Loading comments…</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {comments.map((c: CommentDTO) => {
            const canDelete =
              canModerate || (currentUserId != null && c.authorId === currentUserId);
            return (
              <li key={c.id} className="flex items-start gap-2.5">
                <UserAvatar userId={c.authorId} name={c.authorName} hasAvatar={c.authorHasAvatar} size="sm" />
                <div className="min-w-0 flex-1 rounded-xl bg-ink-800 px-3.5 py-2.5">
                  <p className="text-[13px]">
                    <span className="font-bold">{c.authorName}</span>{" "}
                    <span className="text-mist/70">
                      {formatRelativeTime(c.createdAt)}
                    </span>
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-[14px] leading-relaxed">
                    <RichText text={c.body} mentions={c.mentions} teamId={post.teamId} />
                  </p>
                </div>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate(c.id)}
                    aria-label={`Delete comment by ${c.authorName}`}
                    className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-mist/70 hover:bg-white/10 hover:text-red-300"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2m3 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                    </svg>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <div className="mt-2">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <MentionTextarea
          teamId={post.teamId}
          value={draft}
          onChange={setDraft}
          placeholder="Add a comment…"
          rows={1}
          maxLength={1000}
          className="flex-1"
          onEnter={() => {
            if (draft.trim() && !addMutation.isPending) addMutation.mutate();
          }}
        />
        <Button
          disabled={!draft.trim()}
          loading={addMutation.isPending}
          onClick={() => addMutation.mutate()}
          className="min-h-[44px] px-4 text-[14px]"
        >
          Post
        </Button>
      </div>
    </div>
  );
}

export function PostCard({
  post,
  canModerate,
  currentUserId,
  onDeleted,
}: {
  post: PostDTO;
  canModerate: boolean;
  currentUserId: string | undefined;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const [reactions, setReactions] = useState(post.reactions);
  const [myReactions, setMyReactions] = useState<string[]>(post.myReactions);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reported, setReported] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAuthor = currentUserId != null && post.authorId === currentUserId;
  const canDelete = isAuthor || canModerate;

  const reactionMutation = useMutation({
    mutationFn: (emoji: string) => api.toggleReaction(post.id, emoji),
    onSuccess: (data) => {
      setReactions(data.reactions);
      setMyReactions(data.myReactions);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Couldn't react.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deletePost(post.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feed", post.teamId] });
      onDeleted();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 403) {
        setError("Only the author or a coach can delete this post.");
      } else {
        setError(err instanceof ApiError ? err.message : "Couldn't delete the post.");
      }
    },
  });

  const celebrationRing =
    post.kind === "MILESTONE"
      ? "border-volt-400/40"
      : post.kind === "SHOUTOUT"
        ? "border-amber-300/40"
        : post.kind === "WELCOME"
          ? "border-sky-300/40"
          : "border-white/10";
  return (
    <article className={`rounded-2xl border bg-ink-900 p-4 shadow-card ${celebrationRing}`}>
      {/* header */}
      <div className="flex items-start gap-3">
        <UserAvatar userId={post.authorId} name={post.authorName} hasAvatar={post.authorHasAvatar} size="sm" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold">{post.authorName}</p>
          <p className="text-[12px] text-mist/70">
            {formatRelativeTime(post.createdAt)}
            {post.kind === "ACTIVITY_SHARE" ? " · shared a run" : ""}
            {post.kind === "MILESTONE" ? " · 🏆 milestone" : ""}
            {post.kind === "SHOUTOUT" ? " · 💛 shoutout" : ""}
            {post.kind === "WELCOME" ? " · 👋 welcome" : ""}
          </p>
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Post options"
            aria-expanded={menuOpen}
            className="flex h-9 w-9 items-center justify-center rounded-full text-mist hover:bg-white/10 hover:text-ink-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <circle cx="12" cy="5" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="12" cy="19" r="1.8" />
            </svg>
          </button>
          {menuOpen && (
            <div className="absolute right-0 z-10 mt-1 w-44 overflow-hidden rounded-xl border border-white/10 bg-ink-800 shadow-card">
              {canDelete && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirmDelete(true);
                  }}
                  className="block w-full px-4 py-3 text-left text-[14px] font-semibold text-red-300 hover:bg-white/5"
                >
                  Delete post
                </button>
              )}
              {!isAuthor && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setReportOpen(true);
                  }}
                  className="block w-full px-4 py-3 text-left text-[14px] font-semibold text-mist hover:bg-white/5 hover:text-ink-50"
                >
                  Report post
                </button>
              )}
              {!canDelete && isAuthor && (
                <span className="block px-4 py-3 text-[13px] text-mist/60">
                  No actions available
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* body */}
      {post.body && (
        <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed">
          <RichText text={post.body} mentions={post.mentions} teamId={post.teamId} />
        </p>
      )}

      {/* shared activity */}
      {post.activity && (
        <Link
          to={`/activities/${post.activity.id}`}
          className="mt-3 flex items-center gap-3 rounded-xl border border-volt-400/30 bg-volt-400/5 px-4 py-3 transition hover:border-volt-400/60"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c8f542" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
            <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
          </svg>
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[14px] font-bold text-volt-300">
              <span className="truncate">{activityTitle(post.activity)}</span>
              {post.activity.hasGpsRoute && <GpsBadge />}
            </p>
            <p className="text-[13px] text-mist">
              {formatActivityDateShort(post.activity.startedAt)} ·{" "}
              {activitySummary(post.activity)}
            </p>
          </div>
        </Link>
      )}

      {post.photos && post.photos.length > 0 && (
        <div
          className={`mt-3 grid gap-2 ${
            post.photos.length > 1 ? "grid-cols-2" : "grid-cols-1"
          }`}
        >
          {post.photos.map((ph) => (
            <PhotoImg
              key={ph.id}
              photoId={ph.id}
              alt={ph.caption ?? "Team photo"}
              className="w-full rounded-xl object-cover max-h-80"
            />
          ))}
        </div>
      )}

      {error && (
        <div className="mt-3">
          <ErrorBanner message={error} />
        </div>
      )}

      {confirmDelete ? (
        <div className="mt-3 flex gap-2">
          <Button
            variant="danger"
            loading={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate()}
            className="min-h-[44px] flex-1 text-[14px]"
          >
            Delete this post
          </Button>
          <Button
            variant="secondary"
            onClick={() => setConfirmDelete(false)}
            className="min-h-[44px] flex-1 text-[14px]"
          >
            Keep it
          </Button>
        </div>
      ) : (
        <>
          {/* reactions */}
          <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Reactions">
            {REACTION_EMOJIS.map((emoji) => {
              const summary = reactions.find((r) => r.emoji === emoji);
              const mine = myReactions.includes(emoji);
              const count = summary?.count ?? 0;
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => reactionMutation.mutate(emoji)}
                  aria-pressed={mine}
                  aria-label={`React with ${emoji}${count > 0 ? `, ${count}` : ""}`}
                  className={cn(
                    "flex min-h-[40px] items-center gap-1 rounded-full border px-2.5 text-[16px] transition active:scale-95",
                    mine
                      ? "border-volt-400/60 bg-volt-400/15"
                      : "border-white/10 bg-ink-800 hover:border-white/25",
                  )}
                >
                  <span aria-hidden>{emoji}</span>
                  {count > 0 && (
                    <span
                      className={cn(
                        "text-[12px] font-bold",
                        mine ? "text-volt-300" : "text-mist",
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* comment toggle */}
          <button
            type="button"
            onClick={() => setCommentsOpen((v) => !v)}
            aria-expanded={commentsOpen}
            className="mt-2.5 flex min-h-[40px] items-center gap-1.5 text-[14px] font-semibold text-mist hover:text-ink-50"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
            </svg>
            {post.commentCount === 0
              ? "Comment"
              : `${post.commentCount} ${post.commentCount === 1 ? "comment" : "comments"}`}
          </button>

          {commentsOpen && (
            <CommentThread
              post={post}
              canModerate={canModerate}
              currentUserId={currentUserId}
            />
          )}
        </>
      )}

      {reported && (
        <p className="mt-2 text-[13px] font-medium text-volt-300">
          Reported — a coach will take a look.
        </p>
      )}

      <ReportDialog
        post={post}
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        onReported={() => setReported(true)}
      />
    </article>
  );
}
