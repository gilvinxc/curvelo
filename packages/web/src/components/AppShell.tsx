import { Link, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Avatar, Logo } from "./ui";

export function AppShell() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-ink-950/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <Link to="/dashboard" aria-label="Curvelo home">
            <Logo />
          </Link>
          {!loading && user && (
            <button
              onClick={() => navigate("/settings")}
              aria-label="Settings"
              className="flex items-center gap-2 rounded-full border border-white/10 bg-ink-900 py-1 pl-1 pr-3 transition hover:border-white/25"
            >
              <Avatar name={user.displayName} size="sm" />
              <span className="max-w-[120px] truncate text-[14px] font-semibold">
                {user.displayName}
              </span>
            </button>
          )}
        </div>
      </header>
      <main className="hero-glow mx-auto w-full max-w-3xl px-4 pb-16 pt-6">
        <Outlet />
      </main>
    </div>
  );
}
