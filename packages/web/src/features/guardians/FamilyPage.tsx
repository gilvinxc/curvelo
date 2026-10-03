import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { ChildSummaryDTO, FamilyCalendarItemDTO } from "@curvelo/shared";
import { ApiError, api } from "../../lib/api";
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  FullScreenLoader,
  PageHeader,
  Spinner,
  UserAvatar,} from "../../components/ui";
import { cn } from "../../components/cx";
import { AssignmentRow } from "../calendar/CalendarBits";
import { ActivityRow } from "../activities/ActivityRow";
import { GuardianDocumentsSection } from "../documents/DocumentsTab";

const KID_COLORS = [
  "bg-sky-400",
  "bg-volt-400",
  "bg-pink-400",
  "bg-emerald-400",
  "bg-amber-400",
  "bg-violet-400",
];

function consentBadge(child: ChildSummaryDTO): {
  label: string;
  actionNeeded: boolean;
} {
  const granted = child.consents.some((c) => c.status === "GRANTED");
  if (child.consentRequired && !granted) {
    return { label: "Action needed", actionNeeded: true };
  }
  return { label: "Complete", actionNeeded: false };
}

function PhotoConsentToggle({ athleteId, athleteName }: { athleteId: string; athleteName: string }) {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: ["guardian-photo-consent"],
    queryFn: () => api.guardianPhotoConsentStatus(),
  });
  const granted =
    statusQuery.data?.consents.find((c) => c.athleteId === athleteId)?.granted ?? false;
  const mutation = useMutation({
    mutationFn: (next: boolean) => api.setPhotoConsent(athleteId, next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["guardian-photo-consent"] }),
  });
  const firstName = athleteName.split(" ")[0];
  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[14px] font-bold">Team photo sharing</p>
          <p className="mt-0.5 text-[13px] text-mist">
            Allow photos of {firstName} to be shared to the team feed. You can change
            this any time.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={granted}
          disabled={mutation.isPending || statusQuery.isLoading}
          onClick={() => mutation.mutate(!granted)}
          className={cn(
            "relative h-8 w-14 shrink-0 rounded-full transition",
            granted ? "bg-volt-400" : "bg-white/15",
          )}
        >
          <span
            className={cn(
              "absolute top-1 h-6 w-6 rounded-full bg-white transition-all",
              granted ? "left-7" : "left-1",
            )}
          />
        </button>
      </div>
      {mutation.isError && (
        <p className="mt-2 text-[13px] text-red-300">
          {mutation.error instanceof ApiError ? mutation.error.message : "Couldn't update."}
        </p>
      )}
    </div>
  );
}

function ChildCard({
  athleteId,
  athleteName,
  memberships,
  color,
}: {
  athleteId: string;
  athleteName: string;
  memberships: ChildSummaryDTO[];
  color: string;
}) {
  const first = memberships[0];
  const badge = consentBadge(first);
  const activeTeams = memberships.filter((m) => m.teamActive);
  return (
    <Card>
      <div className="flex items-center gap-3">
        <span className={cn("h-10 w-1.5 shrink-0 rounded-full", color)} aria-hidden />
        <UserAvatar userId={first.athleteId} name={athleteName} hasAvatar={first.hasAvatar} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[17px] font-extrabold tracking-tight">
            {athleteName}
          </h3>
          <p className="mt-0.5 truncate text-[13px] text-mist">
            {activeTeams.map((m) => m.teamName).join(" · ") || "No active teams"}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider",
            badge.actionNeeded
              ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
              : "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
          )}
        >
          {badge.label}
        </span>
      </div>

      {badge.actionNeeded && (
        <p className="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/10 p-3 text-[13px] leading-snug text-amber-200">
          This team requires your consent before {athleteName.split(" ")[0]} can
          participate. Ask the coach to send you a fresh consent link.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Link to={`/activities/new?forChild=${athleteId}`}>
          <Button variant="secondary" className="min-h-[44px] px-4 text-[14px]">
            Log a run for {athleteName.split(" ")[0]}
          </Button>
        </Link>
        {activeTeams.slice(0, 1).map((m) => (
          <Link key={m.teamId} to={`/family/${athleteId}/${m.teamId}/messages`}>
            <span className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 text-[14px] font-semibold text-ink-50 transition hover:border-volt-400/40">
              Team conversations
              <span className="text-[12px] font-normal text-mist">read-only</span>
            </span>
          </Link>
        ))}
      </div>

      {memberships.map((child) => (
        <div key={child.teamId} className="mt-4 border-t border-white/10 pt-4">
          <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.14em] text-mist">
            {child.teamName}
            {!child.teamActive && " (former team)"}
          </p>
          {!child.teamActive && (
            <p className="mb-2 text-[13px] text-mist">
              {athleteName.split(" ")[0]} is no longer on this team. Your parent
              association is unchanged.
            </p>
          )}
          {child.teamActive && (
            <>
              <h4 className="mb-2 text-[12px] font-bold uppercase tracking-[0.14em] text-mist">
                Upcoming training
              </h4>
              {child.upcomingAssignments.length === 0 ? (
                <p className="text-[13px] text-mist">Nothing scheduled.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {child.upcomingAssignments.map((a) => (
                    <AssignmentRow key={a.id} assignment={a} />
                  ))}
                </div>
              )}
            </>
          )}
          <h4 className="mb-2 mt-3 text-[12px] font-bold uppercase tracking-[0.14em] text-mist">
            Recent runs
          </h4>
          {child.recentActivities.length === 0 ? (
            <p className="text-[13px] text-mist">Nothing logged yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {child.recentActivities.map((a) => (
                <ActivityRow key={a.id} activity={a} />
              ))}
            </div>
          )}
          <GuardianDocumentsSection
            teamId={child.teamId}
            athleteId={child.athleteId}
            athleteName={child.athleteName}
          />
        </div>
      ))}

      <PhotoConsentToggle athleteId={athleteId} athleteName={athleteName} />

      <DeleteAthleteData athleteId={athleteId} athleteName={athleteName} />
    </Card>
  );
}

/** Verified guardian deletes their athlete's account and data. */
function DeleteAthleteData({
  athleteId,
  athleteName,
}: {
  athleteId: string;
  athleteName: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const firstName = athleteName.split(" ")[0];
  const del = useMutation({
    mutationFn: () => api.deleteUser(athleteId),
    onSuccess: () => window.location.reload(),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Couldn't delete data."),
  });
  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      {error && (
        <div className="mb-3">
          <ErrorBanner message={error} />
        </div>
      )}
      {confirming ? (
        <div className="flex flex-col gap-3">
          <p className="text-[14px]">
            <span className="font-bold text-red-300">
              Delete {firstName}'s account and all their data?
            </span>
            <br />
            <span className="text-mist">
              This removes their activities, posts, and profile everywhere.
              This can't be undone.
            </span>
          </p>
          <p className="text-[14px] text-mist">
            Type <span className="font-bold text-ink-50">DELETE</span> to
            confirm.
          </p>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="DELETE"
            className="min-h-[44px] rounded-xl border border-white/10 bg-ink-900 px-3 text-[14px]"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              className="min-h-[44px] px-4 text-[14px]"
              disabled={typed !== "DELETE" || del.isPending}
              onClick={() => del.mutate()}
            >
              Delete everything
            </Button>
            <Button
              variant="secondary"
              className="min-h-[44px] px-4 text-[14px]"
              onClick={() => {
                setConfirming(false);
                setTyped("");
              }}
            >
              Keep account
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-[14px] font-semibold text-mist hover:text-red-300"
        >
          Delete {firstName}'s data…
        </button>
      )}
    </div>
  );
}

function FamilyCalendar({ kidColors }: { kidColors: Map<string, string> }) {
  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const toDate = new Date(today);
  toDate.setDate(toDate.getDate() + 30);
  const to = toDate.toISOString().slice(0, 10);

  const calQuery = useQuery({
    queryKey: ["family-calendar", from, to],
    queryFn: () => api.familyCalendar(from, to),
  });

  if (calQuery.isLoading) return <Spinner />;
  if (calQuery.isError) return <ErrorBanner message="Couldn't load the family calendar." />;
  const items = calQuery.data?.items ?? [];
  if (items.length === 0) {
    return <p className="text-[13px] text-mist">Nothing on the calendar for the next 30 days.</p>;
  }

  const byDate = new Map<string, FamilyCalendarItemDTO[]>();
  for (const item of items) {
    const list = byDate.get(item.date) ?? [];
    list.push(item);
    byDate.set(item.date, list);
  }

  const kindLabel: Record<string, string> = {
    assignment: "Workout",
    event: "Event",
    plan: "Plan",
  };

  return (
    <div className="flex flex-col gap-3">
      {[...byDate.entries()].map(([date, dayItems]) => (
        <div key={date}>
          <p className="mb-1.5 text-[12px] font-bold uppercase tracking-[0.14em] text-mist">
            {new Date(date + "T12:00:00").toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </p>
          <div className="flex flex-col gap-1.5">
            {dayItems.map((item, i) => (
              <div
                key={`${item.kind}-${item.athleteId}-${item.title}-${i}`}
                className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
              >
                <span
                  className={cn("h-8 w-1.5 shrink-0 rounded-full", kidColors.get(item.athleteId) ?? "bg-white/20")}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold">{item.title}</p>
                  <p className="truncate text-[12px] text-mist">
                    {kindLabel[item.kind]}
                    {item.teamName ? ` · ${item.teamName}` : ""}
                    {item.detail ? ` · ${item.detail}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-[12px] font-bold text-mist">
                  {item.athleteName.split(" ")[0]}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function GuardianTeams() {
  const teamsQuery = useQuery({
    queryKey: ["guardian-teams"],
    queryFn: () => api.guardianTeams(),
  });
  if (teamsQuery.isLoading) return <Spinner />;
  if (teamsQuery.isError || (teamsQuery.data?.teams.length ?? 0) === 0) return null;
  return (
    <Card className="mb-4">
      <h3 className="mb-3 text-[15px] font-extrabold">Your teams</h3>
      <div className="flex flex-col gap-2">
        {teamsQuery.data!.teams.map((t) => (
          <Link
            key={t.id}
            to={`/teams/${t.id}/feed`}
            className="flex min-h-[48px] items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-4 transition hover:border-volt-400/40"
          >
            <span className="truncate text-[14px] font-bold">{t.name}</span>
            <span className="shrink-0 text-[12px] text-mist">
              {t.athletes.join(", ")}
            </span>
          </Link>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-mist">
        Comment, react, and share photos on the team feed.
      </p>
    </Card>
  );
}

export function FamilyPage() {
  const childrenQuery = useQuery({
    queryKey: ["children"],
    queryFn: () => api.myChildren(),
  });

  if (childrenQuery.isLoading) return <FullScreenLoader />;

  const children = childrenQuery.data?.children ?? [];

  // One card per athlete (they may be on several teams).
  const byAthlete = new Map<string, { name: string; memberships: ChildSummaryDTO[] }>();
  for (const child of children) {
    const entry = byAthlete.get(child.athleteId) ?? { name: child.athleteName, memberships: [] };
    entry.memberships.push(child);
    byAthlete.set(child.athleteId, entry);
  }
  const kidColors = new Map<string, string>();
  [...byAthlete.keys()].forEach((id, i) => kidColors.set(id, KID_COLORS[i % KID_COLORS.length]));

  return (
    <div>
      <PageHeader
        title="My athletes"
        subtitle="Training you're following as a guardian"
      />

      {childrenQuery.isError && (
        <ErrorBanner message="Couldn't load your linked athletes." />
      )}

      {children.length === 0 && !childrenQuery.isError ? (
        <EmptyState
          title="No linked athletes yet"
          body="Ask your child's coach to send you an invitation."
          action={
            <Link to="/dashboard">
              <span className="font-bold text-volt-300 hover:text-volt-400">
                Back to dashboard
              </span>
            </Link>
          }
        />
      ) : (
        <>
          <GuardianTeams />
          <Card className="mb-4">
            <h3 className="mb-3 text-[15px] font-extrabold">Family calendar</h3>
            <FamilyCalendar kidColors={kidColors} />
          </Card>
          <div className="flex flex-col gap-4">
            {[...byAthlete.entries()].map(([athleteId, { name, memberships }]) => (
              <ChildCard
                key={athleteId}
                athleteId={athleteId}
                athleteName={name}
                memberships={memberships}
                color={kidColors.get(athleteId) ?? "bg-white/20"}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
