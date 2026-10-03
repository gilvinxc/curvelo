import {
  forwardRef,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "./cx";
import { BRAND_LOGO_SRC, BRAND_NAME } from "../brand";

/* ---------------------------------- logo --------------------------------- */

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <img
      src={BRAND_LOGO_SRC}
      alt={BRAND_NAME}
      className={compact ? "h-9 w-auto" : "h-12 w-auto"}
    />
  );
}

/* --------------------------------- button -------------------------------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
}

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-volt-400 text-ink-950 font-bold hover:bg-volt-300 shadow-glow disabled:shadow-none",
  secondary:
    "bg-white/5 text-ink-50 border border-white/15 hover:bg-white/10",
  ghost: "text-mist hover:text-ink-50 hover:bg-white/5",
  danger:
    "bg-red-500/10 text-red-300 border border-red-500/30 hover:bg-red-500/20",
};

export function Button({
  variant = "primary",
  loading = false,
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-5 text-[15px] font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
        buttonVariants[variant],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

/* ---------------------------------- card --------------------------------- */

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/10 bg-ink-900 p-5 shadow-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ------------------------------- form fields ------------------------------ */

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-semibold uppercase tracking-wide text-mist">
        {label}
      </span>
      {children}
      {hint && !error && (
        <span className="mt-1.5 block text-[13px] text-mist/80">{hint}</span>
      )}
      {error && (
        <span className="mt-1.5 block text-[13px] font-medium text-red-400">
          {error}
        </span>
      )}
    </label>
  );
}

const inputClass =
  "w-full min-h-[48px] rounded-xl border border-white/10 bg-ink-800 px-4 text-[16px] text-ink-50 placeholder:text-mist/50 outline-none transition focus:border-volt-400 focus:ring-2 focus:ring-volt-400/25";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputClass, props.className)} />;
}

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextArea(props, ref) {
  return (
    <textarea
      {...props}
      ref={ref}
      className={cn(inputClass, "min-h-[96px] py-3", props.className)}
    />
  );
});

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(inputClass, "appearance-none pr-10", props.className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23a7ae97' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 1rem center",
      }}
    />
  );
}

/* ------------------------------ segmented ------------------------------- */

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl border border-white/10 bg-ink-800 p-1"
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "min-h-[44px] rounded-lg px-3 text-[14px] font-semibold transition",
            value === opt.value
              ? "bg-volt-400 text-ink-950"
              : "text-mist hover:text-ink-50",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------- badge --------------------------------- */

const roleStyles: Record<string, string> = {
  COACH: "bg-volt-400/15 text-volt-300 border-volt-400/30",
  TEAM_ADMIN: "bg-ember-400/15 text-ember-300 border-ember-400/30",
  RUNNER: "bg-sky-400/15 text-sky-300 border-sky-400/30",
  PARENT: "bg-mint-400/15 text-mint-300 border-mint-400/30",
  ALUMNI: "bg-white/5 text-mist border-white/15",
};

export function RoleBadge({ role }: { role: string }) {
  const label = role
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider",
        roleStyles[role] ?? "bg-white/5 text-mist border-white/15",
      )}
    >
      {label}
    </span>
  );
}

/* --------------------------------- avatar -------------------------------- */

const avatarHues = [
  "from-lime-500/80 to-emerald-700/80",
  "from-amber-500/80 to-orange-700/80",
  "from-sky-500/80 to-blue-700/80",
  "from-violet-500/80 to-purple-700/80",
  "from-rose-500/80 to-red-700/80",
];

export function Avatar({
  name,
  size = "md",
  className,
  imageUrl,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  imageUrl?: string;
}) {
  const sizes = {
    sm: "h-9 w-9 text-[13px]",
    md: "h-11 w-11 text-[15px]",
    lg: "h-16 w-16 text-xl",
  };
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className={cn(
          "inline-flex shrink-0 rounded-full object-cover",
          sizes[size],
          className,
        )}
      />
    );
  }
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const hue =
    avatarHues[
      [...name].reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % avatarHues.length
    ];
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-bold text-white",
        hue,
        sizes[size],
        className,
      )}
    >
      {initials || "?"}
    </span>
  );
}

/* --------------------------------- modal --------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full max-w-md rounded-t-3xl border border-white/10 bg-ink-900 p-6 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-extrabold tracking-tight">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full text-mist hover:bg-white/10 hover:text-ink-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------- misc bits ------------------------------ */

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn("animate-spin", className ?? "h-8 w-8")}
      viewBox="0 0 24 24"
      fill="none"
      aria-label="Loading"
    >
      <circle
        className="opacity-20"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        className="text-volt-400"
      />
    </svg>
  );
}

export function FullScreenLoader() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Spinner />
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[14px] font-medium text-red-300"
    >
      {message}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-white/15 bg-ink-900/50 px-6 py-12 text-center">
      <svg width="44" height="44" viewBox="0 0 26 26" fill="none" aria-hidden className="mb-4 opacity-40">
        <path
          d="M14.5 1.5 4 15.5h7L11 24.5 22 10.5h-7l-.5-9Z"
          fill="#c8f542"
          strokeLinejoin="round"
        />
      </svg>
      <h3 className="text-lg font-extrabold tracking-tight">{title}</h3>
      <p className="mt-1 max-w-xs text-[14px] text-mist">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  backTo,
  action,
}: {
  title: string;
  subtitle?: string;
  backTo?: string;
  action?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <div className="mb-6 flex flex-wrap items-start gap-3">
      {backTo && (
        <button
          onClick={() => navigate(backTo)}
          aria-label="Go back"
          className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-ink-900 text-mist hover:text-ink-50"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
      )}
      <div className="min-w-0 flex-1 basis-40">
        <h1 className="truncate text-2xl font-black tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[14px] text-mist">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard API unavailable — select fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        "inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-[14px] font-bold transition",
        copied
          ? "bg-volt-400 text-ink-950"
          : "border border-white/15 bg-white/5 text-ink-50 hover:bg-white/10",
      )}
    >
      {copied ? (
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="14" height="14" x="8" y="8" rx="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
          </svg>
          {label}
        </>
      )}
    </button>
  );
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
