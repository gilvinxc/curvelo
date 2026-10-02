import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
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

export function SignInPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Something went wrong signing in.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center">
      <div className="mb-8 flex flex-col items-center text-center">
        <Logo />
        <p className="mt-3 text-[15px] font-semibold uppercase tracking-[0.2em] text-volt-400">
          Empower your run
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">
          Welcome back
        </h1>
      </div>
      <Card>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {error && <ErrorBanner message={error} />}
          <Field label="Email">
            <TextInput
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </Field>
          <Field label="Password">
            <TextInput
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
            />
          </Field>
          <div className="-mt-2 text-right">
            <Link
              to="/forgot-password"
              className="text-[13px] font-semibold text-volt-300 hover:text-volt-400"
            >
              Forgot password?
            </Link>
          </div>
          <Button type="submit" loading={busy} className="mt-1 w-full">
            Sign in
          </Button>
        </form>
      </Card>
      <p className="mt-6 text-center text-[14px] text-mist">
        New to Curvelo?{" "}
        <Link
          to={`/register${next !== "/dashboard" ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="font-bold text-volt-300 hover:text-volt-400"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
