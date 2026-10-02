import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { ChildSummaryDTO } from "@curvelo/shared";
import { api } from "../../lib/api";
import {
  Avatar,
  Card,
  EmptyState,
  ErrorBanner,
  FullScreenLoader,
  PageHeader,
} from "../../components/ui";
import { cn } from "../../components/cx";
import { AssignmentRow } from "../calendar/CalendarBits";
import { ActivityRow } from "../activities/ActivityRow";

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

      <div className="mt-4">
        <h4 className="mb-2 text-[12px] font-bold uppercase tracking-[0.14em] text-mist">
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
      </div>
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
            <ChildCard key={child.athleteId} child={child} />
          ))}
        </div>
      )}
    </div>
  );
}
