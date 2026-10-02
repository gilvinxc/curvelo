import { Link, Outlet, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { Avatar, Logo } from "./ui";

export function AppShell() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { data: unread } = useQuery({
    queryKey: ["unread-count"],
    queryFn: () => api.unreadCount(),
    enabled: !loading && !!user,
    refetchInterval: 60_000,
  });
  const unreadN = unread?.unread ?? 0;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-ink-950/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <Link to="/dashboard" aria-label="Curvelo home">
            <Logo />
          </Link>
          {!loading && user && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate("/notifications")}
                aria-label="Notifications"
                className="relative rounded-full border border-white/10 bg-ink-900 p-2.5 transition hover:border-white/25"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-white/80"
                >
                  <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                  <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                </svg>
                {unreadN > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-volt-400 px-1 text-[11px] font-bold text-ink-950">
                    {unreadN > 99 ? "99+" : unreadN}
                  </span>
                )}
              </button>
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
            </div>
          )}
        </div>
      </header>
      <main className="hero-glow mx-auto w-full max-w-3xl px-4 pb-16 pt-6">
        <Outlet />
      </main>
    </div>
  );
}
