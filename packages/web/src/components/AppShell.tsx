import { useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { Avatar, Logo } from "./ui";

import { HelpGuide } from "./HelpGuide";
import { BRAND_NAME } from "../brand";

/** Slide-out navigation drawer. */
function NavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!open || !user) return null;

  const items: Array<{ to: string; label: string; icon: string }> = [
    { to: "/dashboard", label: "Dashboard", icon: "🏠" },
    { to: "/activities/new", label: "Log activity", icon: "🏃" },
    { to: "/calendar", label: "My calendar", icon: "📅" },
    { to: "/activities", label: "Activity history", icon: "📊" },
    { to: "/notifications", label: "Notifications", icon: "🔔" },
    { to: "/settings", label: "Settings", icon: "⚙️" },
  ];
  if (user.systemRole === "SYSTEM_ADMIN") {
    items.push({ to: "/admin", label: "Site admin", icon: "🛡️" });
  }

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <nav
        className="absolute left-0 top-0 flex h-full w-[280px] flex-col bg-ink-950 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between px-2">
          <span className="text-[15px] font-extrabold tracking-tight">Menu</span>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="rounded-full p-2 text-mist hover:text-ink-50"
          >
            ✕
          </button>
        </div>
        {items.map((item) => {
          const active = location.pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={`mb-1 flex items-center gap-3 rounded-xl px-3 py-3 text-[15px] font-semibold transition ${
                active
                  ? "bg-volt-400/15 text-ink-50"
                  : "text-mist hover:bg-white/5 hover:text-ink-50"
              }`}
            >
              <span className="text-[18px]">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function AppShell() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => setHelpOpen(true)}
              aria-label="Help"
              className="rounded-full border border-white/10 bg-ink-900 p-2.5 transition hover:border-white/25"
            >
              <span className="flex h-[18px] w-[18px] items-center justify-center text-[15px] font-black text-white/80">
                ?
              </span>
            </button>
            <button
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              className="rounded-full border border-white/10 bg-ink-900 p-2.5 transition hover:border-white/25"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-white/80">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <Link to="/dashboard" aria-label={`${BRAND_NAME} home`}>
              <Logo />
            </Link>
          </div>
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
                <Avatar
                  name={user.displayName}
                  size="sm"
                  imageUrl={user.hasAvatar ? api.avatarUrl(user.id) : undefined}
                />
                <span className="max-w-[120px] truncate text-[14px] font-semibold">
                  {user.displayName}
                </span>
              </button>
            </div>
          )}
        </div>
      </header>
      <NavDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />
      {helpOpen && <HelpGuide onClose={() => setHelpOpen(false)} />}
      <main className="hero-glow mx-auto w-full max-w-3xl px-4 pb-16 pt-6">
        <Outlet />
      </main>
    </div>
  );
}
