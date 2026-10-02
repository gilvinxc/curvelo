import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ActivityDTO } from "@curvelo/shared";
import { api } from "../../lib/api";
import {
  activitySummary,
  activityTitle,
  formatActivityDateShort,
} from "../../lib/activityFormat";
import { useUnits } from "../../lib/units";
import {
  EmptyState,
  ErrorBanner,
  FullScreenLoader,
  Modal,
} from "../../components/ui";
import { cn } from "../../components/cx";

/** Modal listing the user's recent TEAM-visible activities for this team. */
export function ActivityPicker({
  teamId,
  open,
  onClose,
  onPick,
}: {
  teamId: string;
  open: boolean;
  onClose: () => void;
  onPick: (activity: ActivityDTO) => void;
}) {
  const units = useUnits();
  const [query, setQuery] = useState("");

  const from = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }, []);
  const to = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const activitiesQuery = useQuery({
    queryKey: ["activities", teamId, from, to],
    queryFn: () => api.listActivities(from, to, teamId),
    enabled: open,
  });

  const activities = useMemo(() => {
    const list = (activitiesQuery.data?.activities ?? []).filter(
      (a) => a.visibility === "TEAM",
    );
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (a) =>
        activityTitle(a).toLowerCase().includes(q) ||
        activitySummary(a, units).toLowerCase().includes(q),
    );
  }, [activitiesQuery.data, query, units]);

  return (
    <Modal open={open} onClose={onClose} title="Share a run">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search your runs…"
        aria-label="Search your runs"
        className="mb-3 min-h-[48px] w-full rounded-xl border border-white/10 bg-ink-800 px-4 text-[16px] text-ink-50 placeholder:text-mist/50 outline-none focus:border-volt-400"
      />
      {activitiesQuery.isLoading ? (
        <FullScreenLoader />
      ) : activitiesQuery.isError ? (
        <ErrorBanner message="Couldn't load your activities." />
      ) : activities.length === 0 ? (
        <EmptyState
          title="No shareable runs"
          body="Log a run with Team visibility first, then share it here."
        />
      ) : (
        <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
          {activities.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                onPick(a);
                onClose();
              }}
              className={cn(
                "flex items-center gap-3 rounded-xl border border-white/10 bg-ink-800 px-4 py-3 text-left transition",
                "hover:border-volt-400/50 active:scale-[0.99]",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold">
                  {activityTitle(a)}
                </p>
                <p className="mt-0.5 text-[13px] text-mist">
                  {formatActivityDateShort(a.startedAt)} · {activitySummary(a, units)}
                </p>
              </div>
              <span className="shrink-0 text-[13px] font-bold text-volt-300">
                Share
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
