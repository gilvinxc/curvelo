import { useQuery } from "@tanstack/react-query";
import type { AthleteInsight } from "@curvelo/shared";
import { api, ApiError } from "../../lib/api";
import { Button, Card, ErrorBanner } from "../../components/ui";
import { formatDistanceM, formatPaceSec } from "../../lib/workoutFormat";
import { cn } from "../../components/cx";

function ProviderBadge({ provider }: { provider: AthleteInsight["provider"] }) {
  const isLlm = provider === "llm";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider",
        isLlm
          ? "border-violet-400/40 bg-violet-400/10 text-violet-300"
          : "border-volt-400/40 bg-volt-400/10 text-volt-300",
      )}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 3v3" />
        <path d="M18.4 5.6 16.3 7.7" />
        <path d="M21 12h-3" />
        <path d="M18.4 18.4l-2.1-2.1" />
        <path d="M12 18v3" />
        <path d="M7.7 16.3l-2.1 2.1" />
        <path d="M6 12H3" />
        <path d="M7.7 7.7 5.6 5.6" />
      </svg>
      {isLlm ? "AI insights" : "Curvelo analyst"}
    </span>
  );
}

function TrendBadge({ trend }: { trend: AthleteInsight["stats"]["paceTrend"] }) {
  const config = {
    improving: {
      label: "Pace improving",
      arrow: "M7 17 17 7M7 7h10v10",
      className: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
    },
    declining: {
      label: "Pace declining",
      arrow: "M7 7l10 10M17 7v10H7",
      className: "border-amber-400/40 bg-amber-400/10 text-amber-300",
    },
    stable: {
      label: "Pace steady",
      arrow: "M5 12h14",
      className: "border-white/15 bg-white/5 text-mist",
    },
    insufficient: {
      label: "Not enough data",
      arrow: "M5 12h14",
      className: "border-white/15 bg-white/5 text-mist/60",
    },
  }[trend];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider",
        config.className,
      )}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={config.arrow} />
      </svg>
      {config.label}
    </span>
  );
}

function InsightStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-ink-950/60 px-3 py-2.5 text-center">
      <p className="text-[15px] font-extrabold tracking-tight">{value}</p>
      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-mist">
        {label}
      </p>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse" aria-hidden>
      <div className="mb-3 flex items-center gap-2">
        <div className="h-5 w-28 rounded-full bg-white/10" />
        <div className="h-5 w-20 rounded-full bg-white/10" />
      </div>
      <div className="mb-3 grid grid-cols-3 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-14 rounded-xl bg-white/10" />
        ))}
      </div>
      <div className="mb-2 h-4 w-full rounded bg-white/10" />
      <div className="mb-2 h-4 w-5/6 rounded bg-white/10" />
      <div className="h-4 w-4/6 rounded bg-white/10" />
    </div>
  );
}

export function InsightCard({
  insight,
  footnote,
}: {
  insight: AthleteInsight;
  footnote: string;
}) {
  const ins = insight;
  const st = ins.stats;
  const completion =
    st.completionRate != null ? `${Math.round(st.completionRate * 100)}%` : "—";
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ProviderBadge provider={ins.provider} />
        <span className="text-[12px] font-semibold text-mist">
          {ins.periodDays}-day window
        </span>
        <TrendBadge trend={st.paceTrend} />
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2">
        <InsightStat label="Sessions" value={String(st.sessions)} />
        <InsightStat label="Active days" value={String(st.activeDays)} />
        <InsightStat label="Distance" value={formatDistanceM(st.totalDistanceM)} />
        <InsightStat
          label="Avg pace"
          value={st.avgPaceSecPerKm != null ? formatPaceSec(st.avgPaceSecPerKm) : "—"}
        />
        <InsightStat label="Day streak" value={String(st.streakDays)} />
        <InsightStat label="Completion" value={completion} />
      </div>

      <p className="mb-4 text-[14px] leading-relaxed text-ink-50/90">
        {ins.narrative}
      </p>

      {ins.highlights.length > 0 && (
        <div className="mb-3">
          <h3 className="mb-1.5 text-[12px] font-bold uppercase tracking-[0.14em] text-emerald-300">
            Highlights
          </h3>
          <ul className="flex flex-col gap-1.5">
            {ins.highlights.map((h, i) => (
              <li key={i} className="flex items-start gap-2 text-[14px]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6ee7b7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mt-0.5 shrink-0">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <span className="text-ink-50/90">{h}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ins.watchOuts.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-[12px] font-bold uppercase tracking-[0.14em] text-amber-300">
            Watch-outs
          </h3>
          <ul className="flex flex-col gap-1.5">
            {ins.watchOuts.map((w, i) => (
              <li key={i} className="flex items-start gap-2 text-[14px]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fcd34d" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mt-0.5 shrink-0">
                  <path d="m12 9-4.9 8h9.8L12 9Z" />
                  <path d="M12 4v0" />
                  <path d="M12 13v3" />
                </svg>
                <span className="text-ink-50/90">{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-4 text-[11px] text-mist/70">{footnote}</p>
    </Card>
  );
}

export function AthleteInsights({
  teamId,
  athleteId,
  athleteName,
}: {
  teamId: string;
  athleteId: string;
  athleteName: string;
}) {
  const insightQuery = useQuery({
    queryKey: ["insight", teamId, athleteId],
    queryFn: () => api.getAthleteInsight(teamId, athleteId),
    enabled: !!teamId && !!athleteId,
  });

  return (
    <section aria-label="AI insights" className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
          AI Insights
        </h2>
        <Button
          variant="secondary"
          onClick={() => insightQuery.refetch()}
          disabled={insightQuery.isFetching}
          className="min-h-[36px] px-3 py-1 text-[13px]"
        >
          {insightQuery.isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {insightQuery.isLoading ? (
        <Skeleton />
      ) : insightQuery.isError || !insightQuery.data ? (
        <div className="flex flex-col gap-3">
          <ErrorBanner
            message={
              insightQuery.error instanceof ApiError &&
              insightQuery.error.status === 403
                ? "Insights are available to coaches and team admins."
                : "Couldn't generate insights for this athlete."
            }
          />
          <div>
            <Button variant="secondary" onClick={() => insightQuery.refetch()}>
              Try again
            </Button>
          </div>
        </div>
      ) : (
        <InsightCard
          insight={insightQuery.data.insight}
          footnote={`Generated ${new Date(
            insightQuery.data.insight.generatedAt,
          ).toLocaleString()} · ${
            athleteName.split(" ")[0]
          }'s coach sees this, not the whole team.`}
        />
      )}
    </section>
  );
}

/** The athlete's own 28-day insight — same engine, their own data. */
export function MyInsights() {
  const insightQuery = useQuery({
    queryKey: ["myInsights"],
    queryFn: () => api.myInsights(),
  });

  return (
    <section aria-label="My AI insights" className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
          My AI Insights
        </h2>
        <Button
          variant="secondary"
          onClick={() => insightQuery.refetch()}
          disabled={insightQuery.isFetching}
          className="min-h-[36px] px-3 py-1 text-[13px]"
        >
          {insightQuery.isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {insightQuery.isLoading ? (
        <Skeleton />
      ) : insightQuery.isError || !insightQuery.data ? (
        <div className="flex flex-col gap-3">
          <ErrorBanner message="Couldn't generate your insights yet. Log a few runs first." />
          <div>
            <Button variant="secondary" onClick={() => insightQuery.refetch()}>
              Try again
            </Button>
          </div>
        </div>
      ) : (
        <InsightCard
          insight={insightQuery.data.insight}
          footnote={`Generated ${new Date(
            insightQuery.data.insight.generatedAt,
          ).toLocaleString()} · Private to you.`}
        />
      )}
    </section>
  );
}
