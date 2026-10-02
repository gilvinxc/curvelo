import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  Logo,
  TextInput,
} from "../../components/ui";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    if (password.length < 10) {
      setError("Use at least 10 characters.");
      return;
    }
    setBusy(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center">
      <div className="mb-8 flex flex-col items-center text-center">
        <Logo />
        <h1 className="mt-2 text-3xl font-black tracking-tight">
          New password
        </h1>
      </div>
      <Card>
        {!token ? (
          <div className="flex flex-col gap-3 text-center">
            <ErrorBanner message="This reset link is missing its token." />
            <Link
              to="/forgot-password"
              className="font-bold text-volt-300 hover:text-volt-400"
            >
              Request a new link
            </Link>
          </div>
        ) : done ? (
          <div className="flex flex-col gap-3 text-center">
            <p className="text-[15px] font-bold text-ink-50">
              Password updated
            </p>
            <p className="text-[14px] text-mist">
              Your password is set. All other sessions were signed out.
            </p>
            <Link
              to="/signin"
              className="mt-2 font-bold text-volt-300 hover:text-volt-400"
            >
              Sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            {error && <ErrorBanner message={error} />}
            <Field label="New password">
              <TextInput
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 10 characters"
              />
            </Field>
            <Field label="Confirm password">
              <TextInput
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat it"
              />
            </Field>
            <Button type="submit" loading={busy} className="mt-1 w-full">
              Set new password
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
