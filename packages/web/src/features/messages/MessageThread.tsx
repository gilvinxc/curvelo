import { useEffect, useRef, useState } from "react";
import type { ChatMessageDTO, ConversationDTO } from "@curvelo/shared";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import {
  Button,
  Card,
  ErrorBanner,
  Modal,
  RoleBadge,
  Spinner,
} from "../../components/ui";
import { MentionTextarea } from "../../components/MentionTextarea";
import { RichText } from "../../components/RichText";
import { cn } from "../../components/cx";

export const MESSAGE_PAGE_LIMIT = 30;
export const MESSAGE_MAX_LENGTH = 2000;

export function timeAgo(iso: string | null): string {
  if (!iso) return "No messages yet";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${time}`;
}

const CAN_MODERATE = new Set(["COACH", "TEAM_ADMIN"]);

function MessageBubble({
  message,
  teamId,
  isOwn,
  canModerate,
  onEdit,
  onDelete,
}: {
  message: ChatMessageDTO;
  teamId: string;
  isOwn: boolean;
  canModerate: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={cn("flex", isOwn ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[85%] sm:max-w-[75%]", isOwn && "text-right")}>
        {!isOwn && (
          <div className="mb-1 flex items-center gap-2 px-1">
            <span className="truncate text-[13px] font-bold text-ink-50">
              {message.authorName}
            </span>
            <RoleBadge role={message.authorRole} />
          </div>
        )}
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-left",
            message.deleted
              ? "border border-white/10 bg-white/5"
              : isOwn
                ? "rounded-br-md border border-volt-400/30 bg-volt-400/15"
                : "rounded-bl-md border border-white/10 bg-white/5",
          )}
        >
          {message.deleted || message.body === null ? (
            <p className="text-[14px] italic text-mist/70">
              This message was removed.
            </p>
          ) : (
            <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink-50">
              <RichText text={message.body ?? ""} mentions={message.mentions} teamId={teamId} />
            </p>
          )}
          <div className="mt-1 flex items-center justify-end gap-2">
            {message.editedAt && !message.deleted && (
              <span className="text-[11px] text-mist/60">edited</span>
            )}
            <span className="text-[11px] text-mist/60">
              {formatMessageTime(message.createdAt)}
            </span>
            {!message.deleted && (isOwn || canModerate) && (
              <span className="flex items-center gap-1">
                {isOwn && (
                  <button
                    onClick={onEdit}
                    aria-label="Edit message"
                    className="rounded p-1 text-mist/70 hover:bg-white/10 hover:text-ink-50"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    </svg>
                  </button>
                )}
                <button
                  onClick={onDelete}
                  aria-label="Delete message"
                  className="rounded p-1 text-mist/70 hover:bg-white/10 hover:text-red-300"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M3 6h18" />
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  </svg>
                </button>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function MessageThread({
  teamId,
  conversation,
  readOnly = false,
  canModerate = false,
}: {
  teamId: string;
  conversation: ConversationDTO;
  readOnly?: boolean;
  canModerate?: boolean;
}) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleting, setDeleting] = useState<ChatMessageDTO | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadInitial = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listMessages(teamId, conversation.id, {
        limit: MESSAGE_PAGE_LIMIT,
      });
      setMessages(data.messages);
      setHasMore(data.hasMore);
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Couldn't load messages.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setMessages([]);
    setHasMore(false);
    setEditingId(null);
    setDraft("");
    void loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, conversation.id]);

  const loadOlder = async () => {
    if (messages.length === 0 || loadingOlder) return;
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    setLoadingOlder(true);
    try {
      const data = await api.listMessages(teamId, conversation.id, {
        before: messages[0].createdAt,
        limit: MESSAGE_PAGE_LIMIT,
      });
      setMessages((prev) => [...data.messages, ...prev]);
      setHasMore(data.hasMore);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    } catch {
      // keep the user where they are; a retry button is below
    } finally {
      setLoadingOlder(false);
    }
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setPostError(null);
    try {
      const { message } = await api.postMessage(
        teamId,
        conversation.id,
        body,
      );
      setMessages((prev) => [...prev, message]);
      setDraft("");
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    } catch (e) {
      setPostError(
        e instanceof ApiError ? e.message : "Couldn't send your message.",
      );
    } finally {
      setSending(false);
    }
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const body = editDraft.trim();
    if (!body || body.length > MESSAGE_MAX_LENGTH || savingEdit) return;
    setSavingEdit(true);
    try {
      const { message } = await api.editMessage(editingId, body);
      setMessages((prev) =>
        prev.map((m) => (m.id === editingId ? message : m)),
      );
      setEditingId(null);
    } catch (e) {
      setPostError(
        e instanceof ApiError ? e.message : "Couldn't save your edit.",
      );
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const id = deleting.id;
    setDeleting(null);
    try {
      await api.deleteMessage(id);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, body: null, deleted: true } : m,
        ),
      );
    } catch (e) {
      setPostError(
        e instanceof ApiError ? e.message : "Couldn't delete the message.",
      );
    }
  };

  const showComposer = !readOnly && conversation.canPost;

  return (
    <Card className="flex flex-col p-0">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h3 className="truncate text-[16px] font-extrabold tracking-tight">
          {conversation.title}
        </h3>
        <button
          onClick={() => void loadInitial()}
          aria-label="Refresh messages"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-mist hover:bg-white/10 hover:text-ink-50"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
            <path d="M8 16H3v5" />
          </svg>
        </button>
      </div>

      <div
        ref={scrollRef}
        className="flex max-h-[60vh] min-h-[240px] flex-col gap-3 overflow-y-auto px-4 py-4"
      >
        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : error ? (
          <ErrorBanner message={error} />
        ) : (
          <>
            {hasMore && (
              <div className="flex justify-center">
                <button
                  onClick={() => void loadOlder()}
                  disabled={loadingOlder}
                  className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-[13px] font-semibold text-mist hover:text-ink-50 disabled:opacity-50"
                >
                  {loadingOlder ? "Loading…" : "Load older messages"}
                </button>
              </div>
            )}
            {messages.length === 0 ? (
              <p className="py-6 text-center text-[14px] text-mist">
                No messages yet.{" "}
                {showComposer ? "Start the conversation." : ""}
              </p>
            ) : (
              messages.map((m) =>
                editingId === m.id ? (
                  <div key={m.id} className="flex flex-col gap-2">
                    <MentionTextarea
                      teamId={teamId}
                      value={editDraft}
                      onChange={setEditDraft}
                      rows={3}
                      maxLength={MESSAGE_MAX_LENGTH}
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={() => void saveEdit()}
                        loading={savingEdit}
                        disabled={!editDraft.trim()}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    teamId={teamId}
                    isOwn={m.authorId === user?.id}
                    canModerate={canModerate}
                    onEdit={() => {
                      setEditingId(m.id);
                      setEditDraft(m.body ?? "");
                    }}
                    onDelete={() => setDeleting(m)}
                  />
                ),
              )
            )}
          </>
        )}
      </div>

      <div className="border-t border-white/10 px-4 py-3">
        {postError && (
          <div className="mb-2">
            <ErrorBanner message={postError} />
          </div>
        )}
        {showComposer ? (
          <div className="flex items-end gap-2">
            <MentionTextarea
              teamId={teamId}
              value={draft}
              onChange={setDraft}
              placeholder="Write a message…"
              rows={2}
              maxLength={MESSAGE_MAX_LENGTH}
              className="flex-1"
              onEnter={() => void send()}
            />
            <Button
              onClick={() => void send()}
              loading={sending}
              disabled={!draft.trim()}
              className="min-h-[48px] shrink-0 px-4"
              aria-label="Send message"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m22 2-7 20-4-9-9-4Z" />
                <path d="M22 2 11 13" />
              </svg>
            </Button>
          </div>
        ) : (
          !readOnly && (
            <p className="py-1 text-center text-[13px] text-mist">
              {conversation.kind === "ANNOUNCEMENT"
                ? "Only coaches can post announcements."
                : "You have read-only access to this conversation."}
            </p>
          )
        )}
      </div>

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete message?"
      >
        <p className="text-[14px] leading-relaxed text-mist">
          This removes the message for everyone. This can't be undone.
        </p>
        <div className="mt-6 flex gap-2">
          <Button
            variant="secondary"
            onClick={() => setDeleting(null)}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={() => void confirmDelete()}
            className="flex-1 bg-red-500 text-white hover:bg-red-400"
          >
            Delete
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

export { CAN_MODERATE };
