import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { TeamDigest, TeamDigestAthlete } from "@curvelo/shared";
import { api, ApiError } from "../../lib/api";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
} from "../../components/ui";
import { cn } from "../../components/cx";
import { BRAND_NAME } from "../../brand";

const STATUS_STYLE: Record<TeamDigestAthlete["status"], { label: string; className: string }> = {
  "on-track": {
    label: "On track",
    className: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  },
  quiet: {
    label: "Quiet",
    className: "border-white/15 bg-white/5 text-mist",
  },
  "needs-attention": {
    label: "Needs attention",
    className: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  },
};

function StatusBadge({ status }: { status: TeamDigestAthlete["status"] }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider",
        s.className,
      )}
    >
      {s.label}
    </span>
  );
}

function DigestSkeleton() {
  return (
    <div className="animate-pulse" aria-hidden>
      <div className="mb-3 h-4 w-full rounded bg-white/10" />
      <div className="mb-4 h-4 w-5/6 rounded bg-white/10" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 rounded-2xl bg-white/10" />
        ))}
      </div>
    </div>
  );
}

export function TeamDigestSection({
  teamId,
  groupId,
  title,
}: {
  teamId: string;
  groupId?: string;
  title?: string;
}) {
  const digestQuery = useQuery({
    queryKey: groupId ? ["group-digest", groupId] : ["team-digest", teamId],
    queryFn: () =>
      groupId ? api.getGroupDigest(groupId) : api.getTeamDigest(teamId),
    enabled: !!teamId,
  });

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
          {title ?? "Coaching digest"}
        </h2>
        <Button
          variant="secondary"
          onClick={() => digestQuery.refetch()}
          disabled={digestQuery.isFetching}
          className="min-h-[36px] px-3 py-1 text-[13px]"
        >
          {digestQuery.isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {digestQuery.isLoading ? (
        <DigestSkeleton />
      ) : digestQuery.isError || !digestQuery.data ? (
        <div className="flex flex-col gap-3">
          <ErrorBanner
            message={
              digestQuery.error instanceof ApiError &&
              digestQuery.error.status === 403
                ? "The coaching digest is available to coaches and team admins."
                : "Couldn't generate the coaching digest."
            }
          />
          <div>
            <Button variant="secondary" onClick={() => digestQuery.refetch()}>
              Try again
            </Button>
          </div>
        </div>
      ) : (
        (() => {
          const { digest }: { digest: TeamDigest } = digestQuery.data;
          const attentionFirst = [...digest.athletes].sort((a, b) => {
            if (a.dormant !== b.dormant) return Number(b.dormant) - Number(a.dormant);
            const rank = { "needs-attention": 0, quiet: 1, "on-track": 2 };
            return rank[a.status] - rank[b.status];
          });
          return (
            <div>
              <Card className="mb-4 p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider",
                      digest.provider === "llm"
                        ? "border-violet-400/40 bg-violet-400/10 text-violet-300"
                        : "border-volt-400/40 bg-volt-400/10 text-volt-300",
                    )}
                  >
                    {digest.provider === "llm" ? "AI digest" : `${BRAND_NAME} analyst`}
                  </span>
                  <span className="text-[12px] font-semibold text-mist">
                    {digest.periodDays}-day window
                  </span>
                </div>
                <p className="text-[14px] leading-relaxed text-ink-50/90">
                  {digest.summary}
                </p>
              </Card>

              {digest.coachHealth.noActiveCoach && (
                <Card className="mb-4 border-amber-400/40 p-4">
                  <p className="text-[14px] font-bold text-amber-200">
                    ⚠️ No active coach
                  </p>
                  <p className="mt-1 text-[13px] text-mist">
                    None of this team&apos;s {digest.coachHealth.coachCount}{" "}
                    {digest.coachHealth.coachCount === 1 ? "coach has" : "coaches have"}{" "}
                    opened the app in the last 30 days. Consider handing off
                    coaching duties.
                  </p>
                </Card>
              )}

              {attentionFirst.length === 0 ? (
                <EmptyState
                  title="No athletes yet"
                  body="Invite athletes to the team to start the coaching digest."
                />
              ) : (
                <div className="flex flex-col gap-2">
                  {attentionFirst.map((a) => (
                    <Link
                      key={a.athleteId}
                      to={`/teams/${teamId}/athletes/${a.athleteId}`}
                      aria-label={`View ${a.athleteName}'s training`}
                    >
                      <Card className="p-4 transition hover:border-volt-400/40">
                        <div className="flex items-center gap-3">
                          <Avatar name={a.athleteName} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[15px] font-bold">
                              {a.athleteName}
                            </p>
                            <p className="text-[12px] text-mist/70">
                              {a.sessions}{" "}
                              {a.sessions === 1 ? "session" : "sessions"} ·{" "}
                              {a.activeDays}{" "}
                              {a.activeDays === 1 ? "day" : "days"} active ·{" "}
                              {a.completionRate != null
                                ? `${Math.round(a.completionRate * 100)}% assigned done`
                                : "no assignments"}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <StatusBadge status={a.status} />
                            {a.dormant && (
                              <span className="rounded-md bg-amber-400/15 px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-amber-200">
                                Dormant
                              </span>
                            )}
                          </div>
                        </div>
                      </Card>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })()
      )}
    </div>
  );
}
