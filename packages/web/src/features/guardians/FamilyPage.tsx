import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { ChildSummaryDTO } from "@curvelo/shared";
import { ApiError, api } from "../../lib/api";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  FullScreenLoader,
  PageHeader,
} from "../../components/ui";
import { cn } from "../../components/cx";
import { AssignmentRow } from "../calendar/CalendarBits";
import { ActivityRow } from "../activities/ActivityRow";
import { GuardianDocumentsSection } from "../documents/DocumentsTab";

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

function ChildCard({ child }: { child: ChildSummaryDTO }) {
  const badge = consentBadge(child);
  return (
    <Card>
      <div className="flex items-center gap-3">
        <Avatar name={child.athleteName} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[17px] font-extrabold tracking-tight">
            {child.athleteName}
          </h3>
          <p className="mt-0.5 truncate text-[13px] text-mist">
            {child.teamName}
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
          This team requires your consent before {child.athleteName.split(" ")[0]}{" "}
          can participate. Ask the coach to send you a fresh consent link.
        </p>
      )}

      {!child.teamActive && (
        <p className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3 text-[13px] leading-snug text-mist">
          {child.athleteName.split(" ")[0]} is no longer on {child.teamName}.
          Your parent association is unchanged — their documents below remain
          available to you.
        </p>
      )}

      {child.teamActive && (
        <div className="mt-4">
          <Link
            to={`/family/${child.athleteId}/${child.teamId}/messages`}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 text-[14px] font-semibold text-ink-50 transition hover:border-volt-400/40"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
            </svg>
            Team conversations
            <span className="text-[12px] font-normal text-mist">read-only</span>
          </Link>
        </div>
      )}

      {child.teamActive && (
        <div className="mt-4">
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
        </div>
      )}

      <div className="mt-4">
        <h4 className="mb-2 text-[12px] font-bold uppercase tracking-[0.14em] text-mist">
          Recent runs
        </h4>        {child.recentActivities.length === 0 ? (
          <p className="text-[13px] text-mist">Nothing logged yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {child.recentActivities.map((a) => (
              <ActivityRow key={a.id} activity={a} />
            ))}
          </div>
        )}
      </div>

      <GuardianDocumentsSection
        teamId={child.teamId}
        athleteId={child.athleteId}
        athleteName={child.athleteName}
      />

      <DeleteAthleteData
        athleteId={child.athleteId}
        athleteName={child.athleteName}
      />
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

export function FamilyPage() {
  const childrenQuery = useQuery({
    queryKey: ["children"],
    queryFn: () => api.myChildren(),
  });

  if (childrenQuery.isLoading) return <FullScreenLoader />;

  const children = childrenQuery.data?.children ?? [];

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
        <div className="flex flex-col gap-4">
          {children.map((child) => (
            <ChildCard
              key={`${child.athleteId}-${child.teamId}`}
              child={child}
            />
          ))}
        </div>
      )}
    </div>
  );
}
