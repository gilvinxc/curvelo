import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { SELF_SIGNUP_ROLES, type SelfSignupRole } from "@curvelo/shared";
import { useAuth } from "../../lib/auth";
import { ApiError } from "../../lib/api";
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  Logo,
  TextInput,
} from "../../components/ui";
import { cn } from "../../components/cx";

const roleCopy: Record<SelfSignupRole, { title: string; body: string }> = {
  RUNNER: {
    title: "Runner",
    body: "Follow training, log runs, and rep your team.",
  },
  COACH: {
    title: "Coach",
    body: "Build teams, assign workouts, and track athletes.",
  },
  PARENT: {
    title: "Parent",
    body: "Follow your child's training and manage consents.",
  },
};

function initialRole(param: string | null): SelfSignupRole {
  return (
    SELF_SIGNUP_ROLES.find((r) => r === param) ?? "RUNNER"
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/dashboard";

  const [role, setRole] = useState<SelfSignupRole>(() =>
    initialRole(params.get("role")),
  );
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await register({
        email: email.trim(),
        password,
        displayName: displayName.trim(),
        role,
        ...(dateOfBirth ? { dateOfBirth } : {}),
      });
      navigate(next, { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Something went wrong.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-sm pb-8">
      <div className="mb-8 flex flex-col items-center text-center">
        <Logo />
        <p className="mt-3 text-[15px] font-semibold uppercase tracking-[0.2em] text-volt-400">
          Empower your run
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">
          Create your account
        </h1>
      </div>
      <Card>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {error && <ErrorBanner message={error} />}

          <Field label="I am a…">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Account type">
              {SELF_SIGNUP_ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={role === r}
                  onClick={() => setRole(r)}
                  className={cn(
                    "rounded-xl border p-4 text-left transition",
                    role === r
                      ? "border-volt-400 bg-volt-400/10 shadow-glow"
                      : "border-white/10 bg-ink-800 hover:border-white/25",
                  )}
                >
                  <span
                    className={cn(
                      "block text-[15px] font-extrabold",
                      role === r ? "text-volt-300" : "text-ink-50",
                    )}
                  >
                    {roleCopy[r].title}
                  </span>
                  <span className="mt-1 block text-[13px] leading-snug text-mist">
                    {roleCopy[r].body}
                  </span>
                </button>
              ))}
            </div>
          </Field>

          <Field label="Display name">
            <TextInput
              required
              maxLength={80}
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Alex Rivera"
            />
          </Field>
          <Field label="Email">
            <TextInput
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </Field>
          <Field label="Password" hint="At least 10 characters.">
            <TextInput
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Make it a strong one"
            />
          </Field>
          <Field label="Date of birth" hint="Optional. Used for age-aware safety features.">
            <TextInput
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
            />
          </Field>

          <Button type="submit" loading={busy} className="mt-1 w-full">
            Create account
          </Button>
        </form>
      </Card>
      <p className="mt-6 text-center text-[14px] text-mist">
        Already have an account?{" "}
        <Link
          to={`/signin${next !== "/dashboard" ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="font-bold text-volt-300 hover:text-volt-400"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
