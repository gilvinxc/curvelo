import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  Logo,
  TextInput,
} from "../../components/ui";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.forgotPassword(email.trim());
      setSent(true);
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
          Reset password
        </h1>
      </div>
      <Card>
        {sent ? (
          <div className="flex flex-col gap-3 text-center">
            <p className="text-[15px] font-bold text-ink-50">
              Check your email
            </p>
            <p className="text-[14px] text-mist">
              If an account exists for {email.trim()}, a reset link is on its
              way. It expires in an hour and can only be used once.
            </p>
            <Link
              to="/signin"
              className="mt-2 font-bold text-volt-300 hover:text-volt-400"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            {error && <ErrorBanner message={error} />}
            <p className="text-[14px] text-mist">
              Enter your account email and we'll send you a link to set a new
              password.
            </p>
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
            <Button type="submit" loading={busy} className="mt-1 w-full">
              Send reset link
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
