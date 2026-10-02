import { useQuery } from "@tanstack/react-query";
import type { ProgressDTO } from "@curvelo/shared";
import { api } from "../../lib/api";
import { formatDistance, useUnits } from "../../lib/units";
import {
  Card,
  EmptyState,
  ErrorBanner,
  FullScreenLoader,
  PageHeader,
} from "../../components/ui";
import { MyInsights } from "../insights/AthleteInsights";
import { MyGoalsSection } from "../goals/MyGoals";

function WeeklyChart({ progress }: { progress: ProgressDTO }) {
  const units = useUnits();
  const perUnit = units === "metric" ? 1000 : 1609.344;
  const unitLabel = units === "metric" ? "km" : "mi";
  const values = progress.weeks.map((w) => w.distanceM / perUnit);
  const max = Math.max(1, ...values);
  const niceMax = Math.ceil(max);

  const W = 600;
  const H = 200;
  const padL = 34;
  const padB = 26;
  const chartW = W - padL - 12;
  const chartH = H - padB - 8;
  const n = values.length;
  const slot = chartW / n;
  const barW = Math.max(8, slot * 0.55);

  return (
    <Card>
      <div className="mb-1 flex items-baseline justify-between">
        <h3 className="text-[16px] font-extrabold text-ink-50">Weekly distance</h3>
        <span className="text-[12px] font-semibold text-mist">{unitLabel}/week</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Weekly distance chart">
        {[0.25, 0.5, 0.75, 1].map((f) => {
          const y = 8 + chartH * (1 - f);
          return (
            <g key={f}>
              <line x1={padL} x2={W - 12} y1={y} y2={y} stroke="rgba(255,255,255,0.08)" />
              <text x={padL - 6} y={y + 4} textAnchor="end" fontSize="11" fill="#8b93a7">
                {Math.round(niceMax * f)}
              </text>
            </g>
          );
        })}
        {values.map((v, i) => {
          const h = Math.max(2, (v / niceMax) * chartH);
          const x = padL + slot * i + (slot - barW) / 2;
          const y = 8 + chartH - h;
          const isLatest = i === n - 1;
          const weekStart = new Date(progress.weeks[i].weekStart);
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                rx={3}
                fill={isLatest ? "#bef264" : "rgba(190,242,100,0.45)"}
              >
                <title>{`${weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${v.toFixed(1)} ${unitLabel}`}</title>
              </rect>
              {i % 3 === 0 && (
                <text
                  x={x + barW / 2}
                  y={H - 8}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#8b93a7"
                >
                  {weekStart.toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </Card>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-center">
      <p className="text-[20px] font-extrabold text-ink-50">{value}</p>
      <p className="mt-0.5 text-[12px] font-semibold text-mist">{label}</p>
    </div>
  );
}

export function ProgressPage() {
  const units = useUnits();
  const progressQuery = useQuery({
    queryKey: ["myProgress"],
    queryFn: () => api.myProgress(12),
  });
  const progress: ProgressDTO | undefined = progressQuery.data?.progress;

  return (
    <div>
      <PageHeader title="My Progress" backTo="/dashboard" />

      {progressQuery.isLoading ? (
        <FullScreenLoader />
      ) : progressQuery.isError || !progress ? (
        <ErrorBanner message="Couldn't load your progress." />
      ) : progress.totalSessions === 0 ? (
        <EmptyState
          title="No runs yet"
          body="Log your first run and your progress charts will show up here."
        />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-3 gap-2">
            <StatCell label="Day streak" value={`${progress.currentStreakDays} 🔥`} />
            <StatCell label="12-week distance" value={formatDistance(progress.totalDistanceM, units)} />
            <StatCell label="Runs" value={String(progress.totalSessions)} />
          </div>
          <div className="mb-5">
            <WeeklyChart progress={progress} />
          </div>
        </>
      )}

      <div className="mb-5">
        <MyGoalsSection />
      </div>

      <MyInsights />
    </div>
  );
}
