import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ApiError, api } from "../../lib/api";
import { useUnits } from "../../lib/units";
import { formatDistanceM } from "../../lib/workoutFormat";
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  FullScreenLoader,
  Modal,
  TextInput,
} from "../../components/ui";

function countdownText(days: number | null, name: string | null): string {
  if (days == null || !name) return "";
  if (days > 7) return `${days} days to ${name}`;
  if (days > 1) return `${days} days — championship week is here`;
  if (days === 1) return `Tomorrow: ${name}`;
  if (days === 0) return `Today: ${name} 🏁`;
  return `${name} is in the books`;
}

function SeasonForm({
  teamId,
  initial,
  onDone,
}: {
  teamId: string;
  initial?: {
    id: string;
    name: string;
    startsAt: string;
    endsAt: string;
    championshipName: string | null;
    championshipDate: string | null;
  };
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(initial?.name ?? "");
  const [startsAt, setStartsAt] = useState(initial?.startsAt.slice(0, 10) ?? "");
  const [endsAt, setEndsAt] = useState(initial?.endsAt.slice(0, 10) ?? "");
  const [champName, setChampName] = useState(initial?.championshipName ?? "");
  const [champDate, setChampDate] = useState(
    initial?.championshipDate?.slice(0, 10) ?? "",
  );
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const input = {
        name: name.trim(),
        startsAt,
        endsAt,
        championshipName: champName.trim() || null,
        championshipDate: champDate || null,
      };
      return initial
        ? api.updateSeason(teamId, initial.id, input)
        : api.createSeason(teamId, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activeSeason", teamId] });
      queryClient.invalidateQueries({ queryKey: ["seasons", teamId] });
      onDone();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Couldn't save."),
  });

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorBanner message={error} />}
      <Field label="Season name">
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Fall XC 2026"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts">
          <TextInput
            type="date"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </Field>
        <Field label="Ends">
          <TextInput
            type="date"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Championship" hint="Optional — powers the countdown">
        <TextInput
          value={champName}
          onChange={(e) => setChampName(e.target.value)}
          placeholder="State Championship"
        />
      </Field>
      <Field label="Championship date">
        <TextInput
          type="date"
          value={champDate}
          onChange={(e) => setChampDate(e.target.value)}
        />
      </Field>
      <Button
        loading={save.isPending}
        disabled={!name.trim() || !startsAt || !endsAt}
        onClick={() => save.mutate()}
      >
        {initial ? "Save changes" : "Create season"}
      </Button>
    </div>
  );
}

function TrophyCount({ teamId, from, to }: { teamId: string; from: string; to: string }) {
  const countQuery = useQuery({
    queryKey: ["awardCount", teamId, from, to],
    queryFn: () => api.awardCount(teamId, from.slice(0, 10), to.slice(0, 10)),
  });
  const total = countQuery.data?.total ?? 0;
  return (
    <Card className="mb-4 p-5 text-center">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-mist">
        Team awards this season
      </p>
      <p className="mt-1 text-[26px] font-black tracking-tight text-ink-50">
        🏆 {countQuery.isLoading ? "…" : total}
      </p>
    </Card>
  );
}

export function SeasonTab({
  teamId,
  myRole,
}: {
  teamId: string;
  myRole: string | null;
}) {
  const units = useUnits();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(false);
  const isCoach = myRole === "COACH";

  const activeQuery = useQuery({
    queryKey: ["activeSeason", teamId],
    queryFn: () => api.getActiveSeason(teamId),
  });

  const del = useMutation({
    mutationFn: (seasonId: string) => api.deleteSeason(teamId, seasonId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["activeSeason", teamId] }),
  });

  if (activeQuery.isLoading) return <FullScreenLoader />;
  if (activeQuery.isError)
    return <ErrorBanner message="Couldn't load the season." />;

  const active = activeQuery.data?.active;
  if (!active) {
    return (
      <div>
        <EmptyState
          title="No season yet"
          body={
            isCoach
              ? "Set up a season to get the championship countdown and the week-by-week timeline."
              : "Your coach hasn't set up a season yet."
          }
          action={
            isCoach ? (
              <Button onClick={() => setShowForm(true)}>New season</Button>
            ) : undefined
          }
        />
        <Modal open={showForm} onClose={() => setShowForm(false)} title="New season">
          <SeasonForm teamId={teamId} onDone={() => setShowForm(false)} />
        </Modal>
      </div>
    );
  }

  const { season, daysToChampionship, weeks } = active;
  const maxMiles = Math.max(1, ...weeks.map((w) => w.milesM));

  return (
    <div>
      {/* Countdown header */}
      <Card className="mb-4 border-volt-400/30 bg-volt-400/5 p-5 text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-mist">
          {season.name}
        </p>
        <p className="mt-1 text-[26px] font-black tracking-tight text-ink-50">
          {countdownText(daysToChampionship, season.championshipName) ||
            season.name}
        </p>
        {isCoach && (
          <div className="mt-3 flex justify-center gap-2">
            <Button
              variant="secondary"
              className="min-h-[40px] px-4 text-[13px]"
              onClick={() => setEditing(true)}
            >
              Edit season
            </Button>
            <Button
              variant="secondary"
              className="min-h-[40px] px-4 text-[13px]"
              loading={del.isPending}
              onClick={() => {
                if (window.confirm(`Delete "${season.name}"?`))
                  del.mutate(season.id);
              }}
            >
              Delete
            </Button>
          </div>
        )}
      </Card>

      <TrophyCount
        teamId={teamId}
        from={season.startsAt}
        to={season.endsAt}
      />

      {/* Week-by-week timeline */}
      <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
        Season timeline
      </h2>
      <div className="-mx-4 overflow-x-auto px-4 pb-2">
        <div className="flex gap-2" style={{ minWidth: weeks.length * 64 }}>
          {weeks.map((w) => {
            const h = Math.max(4, Math.round((w.milesM / maxMiles) * 72));
            const d = new Date(w.weekStart + "T00:00:00Z");
            const label = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
            return (
              <div
                key={w.weekStart}
                className="flex w-14 shrink-0 flex-col items-center"
              >
                <div className="flex h-20 items-end">
                  <div
                    className="w-8 rounded-t bg-volt-400/70"
                    style={{ height: h }}
                    title={`${formatDistanceM(w.milesM, units)} that week`}
                  />
                </div>
                <p className="mt-1 text-[11px] font-bold text-mist">{label}</p>
                <div className="mt-0.5 flex h-5 items-center gap-1">
                  {w.races.map((r) => (
                    <Link
                      key={r.id}
                      to={`/teams/${teamId}/calendar`}
                      title={r.title}
                      className="text-[14px]"
                    >
                      🏁
                    </Link>
                  ))}
                  {isCoach && w.injuryCount != null && w.injuryCount > 0 && (
                    <span title={`${w.injuryCount} injuries`} className="text-[12px]">
                      🏥{w.injuryCount}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-1 text-[12px] text-mist">
        Team miles per week · 🏁 race on the calendar · 🏥 injuries (coach only)
      </p>

      {isCoach && (
        <div className="mt-4">
          <Button variant="secondary" onClick={() => setShowForm(true)}>
            + New season
          </Button>
        </div>
      )}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New season"
      >
        <SeasonForm teamId={teamId} onDone={() => setShowForm(false)} />
      </Modal>
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit season"
      >
        <SeasonForm
          teamId={teamId}
          initial={season}
          onDone={() => setEditing(false)}
        />
      </Modal>
    </div>
  );
}
