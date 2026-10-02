import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { TextArea } from "./ui";

interface MentionTextareaProps {
  teamId: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  autoFocus?: boolean;
  /** Called on Enter (no shift) when the suggestion popup is closed. */
  onEnter?: () => void;
  className?: string;
}

/**
 * Textarea with @-mention autocomplete. Typing "@" + letters shows matching
 * teammates; picking one inserts "@Display Name". Mentions resolve server-side.
 * When teamId is empty, behaves like a plain textarea.
 */
export function MentionTextarea({
  teamId,
  value,
  onChange,
  placeholder,
  rows = 3,
  maxLength,
  autoFocus,
  onEnter,
  className,
}: MentionTextareaProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [atPos, setAtPos] = useState(-1);
  const ref = useRef<HTMLTextAreaElement>(null);

  const rosterQuery = useQuery({
    queryKey: ["roster", teamId],
    queryFn: () => api.getRoster(teamId),
    enabled: open,
    staleTime: 60_000,
  });
  const members = useMemo(
    () =>
      (rosterQuery.data?.roster ?? [])
        .filter((m) => m.status === "ACTIVE")
        .map((m) => ({ userId: m.userId, displayName: m.displayName })),
    [rosterQuery.data],
  );

  const matches = useMemo(() => {
    const q = query.toLowerCase();
    return members
      .filter((m) => m.displayName.toLowerCase().includes(q))
      .slice(0, 6);
  }, [members, query]);

  useEffect(() => setHighlight(0), [query]);

  function handleChange(v: string, cursor: number) {
    onChange(v);
    const before = v.slice(0, cursor);
    const at = before.lastIndexOf("@");
    if (at >= 0) {
      const q = before.slice(at + 1);
      // Open only when the @ starts a token (start or after whitespace).
      if ((at === 0 || /\s/.test(before[at - 1])) && !/[\n]/.test(q) && q.length <= 40) {
        setAtPos(at);
        setQuery(q);
        setOpen(true);
        return;
      }
    }
    setOpen(false);
  }

  function pick(m: { displayName: string }) {
    const before = value.slice(0, atPos);
    const after = value.slice(ref.current?.selectionStart ?? value.length);
    const next = `${before}@${m.displayName} ${after}`;
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        const pos = before.length + m.displayName.length + 2;
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (open && matches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (h + 1) % matches.length);
        return;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h - 1 + matches.length) % matches.length);
        return;
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(matches[highlight] ?? matches[0]);
        return;
      } else if (e.key === "Escape") {
        setOpen(false);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && onEnter) {
      e.preventDefault();
      onEnter();
    }
  }

  // No team context: plain textarea, no mention lookup.
  if (!teamId) {
    return (
      <TextArea
        ref={ref}
        value={value}
        rows={rows}
        maxLength={maxLength}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={className}
      />
    );
  }

  return (
    <div className={`relative ${className ?? ""}`}>
      <TextArea
        ref={ref}
        value={value}
        rows={rows}
        maxLength={maxLength}
        autoFocus={autoFocus}
        placeholder={placeholder ? `${placeholder} (type @ to tag a teammate)` : "Type @ to tag a teammate"}
        onChange={(e) =>
          handleChange(e.target.value, e.target.selectionStart ?? 0)
        }
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && matches.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-48 w-64 overflow-auto rounded-xl border border-white/10 bg-ink-800 shadow-card">
          {matches.map((m, i) => (
            <button
              key={m.userId}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(m);
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                i === highlight ? "bg-white/10 text-white" : "text-white/80"
              }`}
            >
              <span className="font-medium">@{m.displayName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
