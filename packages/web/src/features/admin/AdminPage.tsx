import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { AdminUserDTO } from "@curvelo/shared";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import {
  Button,
  Card,
  ErrorBanner,
  FullScreenLoader,
  PageHeader,
  TextInput,
} from "../../components/ui";

type Tab = "overview" | "users" | "teams" | "audit";

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-center">
      <p className="text-[22px] font-black text-ink-50">{value}</p>
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
        {label}
      </p>
    </div>
  );
}

function Overview() {
  const q = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => api.adminStats(),
  });
  if (q.isLoading) return <FullScreenLoader />;
  if (q.isError || !q.data)
    return <ErrorBanner message="Couldn't load site stats." />;
  const s = q.data.stats;
  return (
    <div className="grid grid-cols-3 gap-2">
      <StatCell label="Users" value={String(s.users)} />
      <StatCell label="Teams" value={String(s.teams)} />
      <StatCell label="Activities" value={String(s.activities)} />
      <StatCell label="Race results" value={String(s.raceResults)} />
      <StatCell label="Documents" value={String(s.documents)} />
      <StatCell label="Posts" value={String(s.posts)} />
      <StatCell label="Audit (24h)" value={String(s.auditEvents24h)} />
    </div>
  );
}

function UserRow({ user }: { user: AdminUserDTO }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<null | "suspend" | "activate" | "admin" | "unadmin">(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] });

  const mut = useMutation({
    mutationFn: (input: { status?: "ACTIVE" | "SUSPENDED"; systemRole?: "SYSTEM_ADMIN" | null }) =>
      api.adminUpdateUser(user.id, input),
    onSuccess: () => {
      setConfirming(null);
      refresh();
    },
  });

  const isAdmin = user.systemRole === "SYSTEM_ADMIN";
  const suspended = user.status === "SUSPENDED";

  return (
    <li className="py-2.5">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-bold text-ink-50">
            {user.displayName}
            {isAdmin && (
              <span className="ml-2 rounded-full bg-volt-400/15 px-2 py-0.5 text-[10px] font-bold text-volt-300">
                ADMIN
              </span>
            )}
            {suspended && (
              <span className="ml-2 rounded-full bg-red-400/15 px-2 py-0.5 text-[10px] font-bold text-red-300">
                SUSPENDED
              </span>
            )}
          </span>
          <span className="block truncate text-[12px] text-mist">
            {user.email} · {user.teamCount} teams · joined{" "}
            {new Date(user.createdAt).toLocaleDateString()}
          </span>
        </span>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setConfirming(suspended ? "activate" : "suspend")}
            className="text-[13px] font-semibold text-mist hover:text-ink-50"
          >
            {suspended ? "Activate" : "Suspend"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(isAdmin ? "unadmin" : "admin")}
            className="text-[13px] font-semibold text-mist hover:text-ink-50"
          >
            {isAdmin ? "Remove admin" : "Make admin"}
          </button>
        </div>
      </div>
      {confirming && (
        <div className="mt-2 rounded-xl border border-white/10 bg-white/5 p-3">
          <p className="mb-2 text-[13px] text-mist">
            {confirming === "suspend" &&
              `Suspend ${user.displayName}? They'll be signed out everywhere immediately.`}
            {confirming === "activate" && `Reactivate ${user.displayName}?`}
            {confirming === "admin" &&
              `Grant site admin to ${user.displayName}? Admins can manage all users, teams, and see the full audit log.`}
            {confirming === "unadmin" && `Remove site admin from ${user.displayName}?`}
          </p>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                if (confirming === "suspend") mut.mutate({ status: "SUSPENDED" });
                else if (confirming === "activate") mut.mutate({ status: "ACTIVE" });
                else if (confirming === "admin") mut.mutate({ systemRole: "SYSTEM_ADMIN" });
                else mut.mutate({ systemRole: null });
              }}
              disabled={mut.isPending}
              className="min-h-[44px] px-4 text-[13px]"
            >
              {mut.isPending ? "…" : "Confirm"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setConfirming(null)}
              className="min-h-[44px] px-4 text-[13px]"
            >
              Cancel
            </Button>
          </div>
          {mut.isError && (
            <ErrorBanner
              message={
                mut.error instanceof ApiError ? mut.error.message : "Couldn't update."
              }
            />
          )}
        </div>
      )}
    </li>
  );
}

function Users() {
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const q = useQuery({
    queryKey: ["admin", "users", applied],
    queryFn: () => api.adminUsers(applied || undefined),
  });

  return (
    <div>
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(search.trim());
        }}
      >
        <TextInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or email"
          aria-label="Search users"
        />
        <Button type="submit" className="min-h-[48px] shrink-0 px-5">
          Search
        </Button>
      </form>
      {q.isLoading ? (
        <FullScreenLoader />
      ) : q.isError ? (
        <ErrorBanner message="Couldn't load users." />
      ) : (
        <>
          <p className="mb-2 text-[12px] text-mist">
            {q.data!.total} user{q.data!.total === 1 ? "" : "s"}
          </p>
          <ul className="divide-y divide-white/5">
            {q.data!.users.map((u) => (
              <UserRow key={u.id} user={u} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Teams() {
  const q = useQuery({
    queryKey: ["admin", "teams"],
    queryFn: () => api.adminTeams(),
  });
  if (q.isLoading) return <FullScreenLoader />;
  if (q.isError || !q.data)
    return <ErrorBanner message="Couldn't load teams." />;
  return (
    <ul className="divide-y divide-white/5">
      {q.data.teams.map((t) => (
        <li key={t.id} className="py-2.5">
          <Link to={`/teams/${t.id}`} className="flex items-center gap-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-bold text-ink-50">
                {t.name}
              </span>
              <span className="block text-[12px] text-mist">
                {t.memberCount} members · {t.visibility} · owner {t.ownerName}
              </span>
            </span>
            <span className="shrink-0 text-mist">›</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Audit() {
  const [action, setAction] = useState("");
  const [applied, setApplied] = useState("");
  const q = useQuery({
    queryKey: ["admin", "audit", applied],
    queryFn: () => api.adminAudit(applied || undefined),
  });

  return (
    <div>
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(action.trim());
        }}
      >
        <TextInput
          value={action}
          onChange={(e) => setAction(e.target.value)}
          placeholder="Filter by action, e.g. DOCUMENT_VIEWED"
          aria-label="Filter audit log by action"
        />
        <Button type="submit" className="min-h-[48px] shrink-0 px-5">
          Filter
        </Button>
      </form>
      {q.isLoading ? (
        <FullScreenLoader />
      ) : q.isError ? (
        <ErrorBanner message="Couldn't load the audit log." />
      ) : (
        <>
          <p className="mb-2 text-[12px] text-mist">
            {q.data!.total} event{q.data!.total === 1 ? "" : "s"} (newest first)
          </p>
          <ul className="divide-y divide-white/5">
            {q.data!.events.map((e) => (
              <li key={e.id} className="py-2">
                <p className="text-[13px] font-bold text-ink-50">
                  {e.action}
                  <span className="ml-2 font-normal text-mist">
                    {e.actorName ?? "system"}
                  </span>
                </p>
                <p className="text-[12px] text-mist">
                  {new Date(e.createdAt).toLocaleString()}
                  {e.entityType ? ` · ${e.entityType}` : ""}
                  {e.ipAddress ? ` · ${e.ipAddress}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function AdminPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");

  if (user && user.systemRole !== "SYSTEM_ADMIN") {
    return (
      <div>
        <PageHeader title="Admin" backTo="/dashboard" />
        <ErrorBanner message="Site admin required." />
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "users", label: "Users" },
    { id: "teams", label: "Teams" },
    { id: "audit", label: "Audit log" },
  ];

  return (
    <div>
      <PageHeader title="Site admin" backTo="/dashboard" />
      <nav
        aria-label="Admin sections"
        className="mb-5 grid auto-cols-fr grid-flow-col gap-1 overflow-x-auto rounded-xl border border-white/10 bg-ink-900 p-1"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`min-h-[44px] whitespace-nowrap rounded-lg px-3 text-[14px] font-semibold transition ${
              tab === t.id
                ? "bg-volt-400 text-ink-950"
                : "text-mist hover:text-ink-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <Card>
        {tab === "overview" && <Overview />}
        {tab === "users" && <Users />}
        {tab === "teams" && <Teams />}
        {tab === "audit" && <Audit />}
      </Card>
    </div>
  );
}
