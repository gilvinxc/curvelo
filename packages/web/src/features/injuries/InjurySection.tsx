import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InjuryDTO } from "@curvelo/shared";
import { ApiError, api } from "../../lib/api";
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Modal,
} from "../../components/ui";
import { cn } from "../../components/cx";

function InjuryRow({
  teamId,
  injury,
}: {
  teamId: string;
  injury: InjuryDTO;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["injuries", teamId] });

  const recover = useMutation({
    mutationFn: () => api.updateInjury(teamId, injury.id, { status: "RECOVERED" }),
    onSuccess: () => void invalidate(),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Couldn't update."),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteInjury(teamId, injury.id),
    onSuccess: () => void invalidate(),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Couldn't delete."),
  });

  return (
    <Card className="p-4">
      {error && (
        <div className="mb-2">
          <ErrorBanner message={error} />
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[15px] font-extrabold tracking-tight">
              {injury.title}
            </p>
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider",
                injury.status === "ACTIVE"
                  ? "border-red-400/40 bg-red-400/10 text-red-300"
                  : "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
              )}
            >
              {injury.status === "ACTIVE" ? "Active" : "Recovered"}
            </span>
          </div>
          <p className="mt-0.5 text-[13px] text-mist">
            {injury.athleteName} · reported by {injury.reportedByName}
            {injury.expectedReturn &&
              ` · back ~${injury.expectedReturn}`}
          </p>
          {injury.detail && (
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink-50/90">
              {injury.detail}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          {injury.status === "ACTIVE" && (
            <Button
              variant="secondary"
              className="min-h-[36px] px-3 py-1 text-[13px]"
              disabled={recover.isPending}
              onClick={() => recover.mutate()}
            >
              Mark recovered
            </Button>
          )}
          <Button
            variant="secondary"
            className="min-h-[36px] px-3 py-1 text-[13px] text-red-300"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`Delete this injury record for ${injury.athleteName}?`)) {
                remove.mutate();
              }
            }}
          >
            Delete
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ReportInjuryDialog({
  teamId,
  open,
  onClose,
  fixedAthleteId,
  fixedAthleteName,
  showAthletePicker,
}: {
  teamId: string;
  open: boolean;
  onClose: () => void;
  fixedAthleteId?: string;
  fixedAthleteName?: string;
  showAthletePicker?: boolean;
}) {
  const queryClient = useQueryClient();
  const [athleteId, setAthleteId] = useState(fixedAthleteId ?? "");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [expectedReturn, setExpectedReturn] = useState("");
  const [error, setError] = useState<string | null>(null);

  const rosterQuery = useQuery({
    queryKey: ["roster", teamId],
    queryFn: () => api.getRoster(teamId),
    enabled: open && !!showAthletePicker,
  });
  const runners = (rosterQuery.data?.roster ?? []).filter(
    (m) => m.role === "RUNNER" && m.status === "ACTIVE",
  );

  const report = useMutation({
    mutationFn: () =>
      api.reportInjury(teamId, {
        athleteId,
        title: title.trim(),
        detail: detail.trim() || undefined,
        expectedReturn: expectedReturn || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["injuries", teamId] });
      onClose();
      setAthleteId(fixedAthleteId ?? "");
      setTitle("");
      setDetail("");
      setExpectedReturn("");
      setError(null);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Couldn't report."),
  });

  const canSubmit = athleteId !== "" && title.trim() !== "" && !report.isPending;

  return (
    <Modal open={open} onClose={onClose} title="Report an injury">
      <div className="flex flex-col gap-3">
        {error && <ErrorBanner message={error} />}
        {showAthletePicker && !fixedAthleteId ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-bold text-mist">Athlete</span>
            <select
              value={athleteId}
              onChange={(e) => setAthleteId(e.target.value)}
              className="min-h-[44px] rounded-xl border border-white/10 bg-ink-900 px-3 text-[14px]"
            >
              <option value="">Select athlete…</option>
              {runners.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-[14px] text-mist">
            For <span className="font-bold text-ink-50">{fixedAthleteName}</span>
          </p>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-bold text-mist">Injury</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Shin splints, ankle sprain"
            maxLength={120}
            className="min-h-[44px] rounded-xl border border-white/10 bg-ink-900 px-3 text-[14px]"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-bold text-mist">
            Notes <span className="font-normal">(optional)</span>
          </span>
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="What happened, treatment, restrictions…"
            className="rounded-xl border border-white/10 bg-ink-900 px-3 py-2.5 text-[14px]"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-bold text-mist">
            Expected return <span className="font-normal">(optional)</span>
          </span>
          <input
            type="date"
            value={expectedReturn}
            onChange={(e) => setExpectedReturn(e.target.value)}
            className="min-h-[44px] rounded-xl border border-white/10 bg-ink-900 px-3 text-[14px]"
          />
        </label>
        <p className="text-[12px] text-mist/70">
          Only coaches, the athlete, and their verified guardians can see
          injury records.
        </p>
        <Button
          disabled={!canSubmit}
          onClick={() => report.mutate()}
          className="min-h-[48px]"
        >
          {report.isPending ? "Reporting…" : "Report injury"}
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Injury log section. Used on the coaching tab (all athletes, with picker)
 * and on the coach's athlete page (single athlete).
 */
export function InjurySection({
  teamId,
  athleteId,
  athleteName,
  showAthletePicker,
  title = "Injuries",
}: {
  teamId: string;
  athleteId?: string;
  athleteName?: string;
  showAthletePicker?: boolean;
  title?: string;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const injuriesQuery = useQuery({
    queryKey: ["injuries", teamId],
    queryFn: () => api.listInjuries(teamId),
  });

  const all = injuriesQuery.data?.injuries ?? [];
  const injuries = athleteId
    ? all.filter((i) => i.athleteId === athleteId)
    : all;
  const active = injuries.filter((i) => i.status === "ACTIVE");
  const recovered = injuries.filter((i) => i.status === "RECOVERED");

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
          {title}
          {active.length > 0 && (
            <span className="ml-2 rounded-full bg-red-400/15 px-2 py-0.5 text-[11px] font-black text-red-300">
              {active.length} active
            </span>
          )}
        </h2>
        <Button
          variant="secondary"
          onClick={() => setDialogOpen(true)}
          className="min-h-[36px] px-3 py-1 text-[13px]"
        >
          🩹 Report injury
        </Button>
      </div>

      {injuriesQuery.isLoading ? (
        <div className="animate-pulse" aria-hidden>
          <div className="h-16 rounded-2xl bg-white/10" />
        </div>
      ) : injuriesQuery.isError ? (
        <ErrorBanner message="Couldn't load injuries." />
      ) : injuries.length === 0 ? (
        <EmptyState
          title="No injuries on record"
          body={
            athleteName
              ? `${athleteName} has no reported injuries.`
              : "Nobody's hurt — long may it continue."
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {active.map((i) => (
            <InjuryRow key={i.id} teamId={teamId} injury={i} />
          ))}
          {recovered.length > 0 && (
            <>
              <p className="mt-2 text-[12px] font-bold uppercase tracking-[0.14em] text-mist">
                Recovered
              </p>
              {recovered.map((i) => (
                <InjuryRow key={i.id} teamId={teamId} injury={i} />
              ))}
            </>
          )}
        </div>
      )}

      <ReportInjuryDialog
        teamId={teamId}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        fixedAthleteId={athleteId}
        fixedAthleteName={athleteName}
        showAthletePicker={showAthletePicker}
      />
    </div>
  );
}
