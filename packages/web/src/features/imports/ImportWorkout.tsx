import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActivityDTO, ImportedActivitySummary } from "@curvelo/shared";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { confirmImport, previewImport } from "./api";
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  PageHeader,
  SegmentedControl,
  Select,
  Spinner,
  TextInput,
} from "../../components/ui";
import { cn } from "../../components/cx";
import { formatDistanceM, formatDurationS } from "../../lib/workoutFormat";
import { formatElevation, useUnits } from "../../lib/units";
import { activityKindLabel, formatActivityDateTime } from "../../lib/activityFormat";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT_EXTENSIONS = [".fit", ".gpx", ".tcx"];
const ACCEPT_ATTR = ".fit,.gpx,.tcx";

type Phase = "pick" | "preview" | "done";

const FORMAT_BADGE: Record<ImportedActivitySummary["format"], string> = {
  FIT: "bg-volt-400/15 text-volt-300 border-volt-400/30",
  GPX: "bg-sky-400/15 text-sky-300 border-sky-400/30",
  TCX: "bg-violet-400/15 text-violet-300 border-violet-400/30",
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-ink-800 px-3 py-2.5 text-center">
      <p className="text-[16px] font-extrabold tracking-tight">{value}</p>
      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-mist">
        {label}
      </p>
    </div>
  );
}

export function ImportWorkoutPage() {
  const units = useUnits();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<ImportedActivitySummary | null>(null);
  const [created, setCreated] = useState<ActivityDTO | null>(null);
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState<"TEAM" | "PRIVATE">("TEAM");
  const [teamId, setTeamId] = useState("");
  const [taggedUserIds, setTaggedUserIds] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const teamsQuery = useQuery({
    queryKey: ["teams"],
    queryFn: () => api.listTeams(),
  });
  const teams = teamsQuery.data?.teams ?? [];
  const { user } = useAuth();

  const tagRosterQuery = useQuery({
    queryKey: ["roster", teamId],
    queryFn: () => api.getRoster(teamId),
    enabled: phase === "preview" && teamId !== "" && visibility === "TEAM",
  });
  const taggableTeammates =
    tagRosterQuery.data?.roster.filter(
      (m) => m.status === "ACTIVE" && m.userId !== user?.id,
    ) ?? [];

  function validateFile(f: File): string | null {
    const lower = f.name.toLowerCase();
    const okExt = ACCEPT_EXTENSIONS.some((ext) => lower.endsWith(ext));
    if (!okExt) return "That file type isn't supported. Choose a .fit, .gpx, or .tcx file.";
    if (f.size > MAX_BYTES) return "That file is too big — the limit is 10 MB.";
    if (f.size === 0) return "That file looks empty.";
    return null;
  }

  async function handleFile(f: File) {
    const problem = validateFile(f);
    if (problem) {
      setPickError(problem);
      return;
    }
    setPickError(null);
    setRequestError(null);
    setFile(f);
    setPreviewLoading(true);
    try {
      const res = await previewImport(f);
      setSummary(res.summary);
      setTitle(res.summary.title);
      setPhase("preview");
    } catch (err) {
      setRequestError(
        err instanceof ApiError ? err.message : "Couldn't read that file.",
      );
      setFile(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  function reset() {
    setPhase("pick");
    setFile(null);
    setSummary(null);
    setCreated(null);
    setTitle("");
    setVisibility("TEAM");
    setTeamId("");
    setTaggedUserIds([]);
    setPickError(null);
    setRequestError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleConfirm() {
    if (!file) return;
    setRequestError(null);
    setConfirmLoading(true);
    try {
      const res = await confirmImport(file, {
        title: title.trim() || undefined,
        visibility,
        teamId: teamId || undefined,
        taggedUserIds: taggedUserIds.length > 0 ? taggedUserIds : undefined,
      });
      setCreated(res.activity);
      setPhase("done");
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      queryClient.invalidateQueries({ queryKey: ["myStats"] });
      queryClient.invalidateQueries({ queryKey: ["teamCalendar"] });
      queryClient.invalidateQueries({ queryKey: ["myCalendar"] });
    } catch (err) {
      if (err instanceof ApiError && err.code === "ALREADY_IMPORTED") {
        // Server says it's a duplicate — reflect that in the preview state.
        setSummary((s) => (s ? { ...s, alreadyImported: true } : s));
      } else {
        setRequestError(
          err instanceof ApiError ? err.message : "Couldn't import that file.",
        );
      }
    } finally {
      setConfirmLoading(false);
    }
  }

  const alreadyImported = summary?.alreadyImported === true;

  return (
    <div>
      <PageHeader
        title="Import workout file"
        subtitle="Upload a .fit, .gpx, or .tcx file from your watch or app."
        backTo="/dashboard"
      />

      {phase === "pick" && (
        <div>
          {pickError && (
            <div className="mb-4">
              <ErrorBanner message={pickError} />
            </div>
          )}
          {requestError && (
            <div className="mb-4">
              <ErrorBanner message={requestError} />
            </div>
          )}

          <button
            type="button"
            disabled={previewLoading}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void handleFile(f);
            }}
            className={cn(
              "flex w-full flex-col items-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition",
              dragging
                ? "border-volt-400 bg-volt-400/10"
                : "border-white/15 bg-ink-900/50 hover:border-white/30",
              previewLoading && "opacity-60",
            )}
          >
            {previewLoading ? (
              <Spinner className="mb-4 h-10 w-10" />
            ) : (
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mb-4 text-volt-400">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="m17 8-5-5-5 5" />
                <path d="M12 3v12" />
              </svg>
            )}
            <span className="text-[16px] font-extrabold">
              {previewLoading ? "Reading your file…" : "Drop a workout file here"}
            </span>
            <span className="mt-1 text-[14px] text-mist">
              or tap to browse your device
            </span>
            <span className="mt-3 text-[12px] text-mist/70">
              .fit · .gpx · .tcx — up to 10 MB
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_ATTR}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
          <p className="mt-4 text-[13px] leading-relaxed text-mist">
            Export a run from Strava, Garmin, or any other app — then upload it
            here. Nothing leaves your device until you confirm the import.
          </p>
        </div>
      )}

      {phase === "preview" && summary && (
        <div className="flex flex-col gap-5">
          {requestError && <ErrorBanner message={requestError} />}

          <Card>
            <div className="mb-4 flex items-center justify-between gap-3">
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider",
                  FORMAT_BADGE[summary.format],
                )}
              >
                {summary.format}
              </span>
              <span className="truncate text-[13px] text-mist">
                {summary.fileName}
              </span>
            </div>

            <p className="text-xl font-black tracking-tight">
              {title.trim() || activityKindLabel(summary.kind)}
            </p>
            <p className="mt-1 text-[14px] text-mist">
              {activityKindLabel(summary.kind)} ·{" "}
              {formatActivityDateTime(summary.startedAt)}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat
                label="Distance"
                value={
                  summary.distanceM != null
                    ? formatDistanceM(summary.distanceM, units)
                    : "—"
                }
              />
              <Stat
                label="Duration"
                value={
                  summary.durationS != null
                    ? formatDurationS(summary.durationS)
                    : "—"
                }
              />
              <Stat
                label="Avg HR"
                value={
                  summary.avgHrBpm != null ? `${summary.avgHrBpm} bpm` : "—"
                }
              />
              <Stat
                label="Max HR"
                value={
                  summary.maxHrBpm != null ? `${summary.maxHrBpm} bpm` : "—"
                }
              />
              <Stat
                label="Calories"
                value={summary.calories != null ? `${summary.calories}` : "—"}
              />
              <Stat
                label="Elev gain"
                value={
                  summary.elevationGainM != null
                    ? formatElevation(summary.elevationGainM, units)
                    : "—"
                }
              />
              <Stat
                label="Cadence"
                value={summary.avgCadenceSpm != null ? `${summary.avgCadenceSpm} spm` : "—"}
              />
              <Stat
                label="Lap splits"
                value={summary.splitCount > 0 ? `${summary.splitCount}` : "—"}
              />
            </div>
          </Card>

          {alreadyImported ? (
            <Card className="border-amber-400/30 bg-amber-400/5">
              <p className="text-[15px] font-bold text-amber-300">
                Already imported
              </p>
              <p className="mt-1 text-[14px] text-mist">
                This file is already in your training log, so there's nothing
                new to add.
              </p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => navigate("/dashboard")}
                >
                  Back to dashboard
                </Button>
                <Button variant="ghost" className="flex-1" onClick={reset}>
                  Import a different file
                </Button>
              </div>
            </Card>
          ) : (
            <div className="flex flex-col gap-5">
              <Field label="Title">
                <TextInput
                  value={title}
                  maxLength={120}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Morning easy run"
                />
              </Field>

              <Field label="Team" hint="Optional — tag the team this run was for">
                <Select
                  value={teamId}
                  onChange={(e) => setTeamId(e.target.value)}
                >
                  <option value="">No team</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Who can see this?">
                <SegmentedControl<"TEAM" | "PRIVATE">
                  ariaLabel="Activity visibility"
                  value={visibility}
                  onChange={setVisibility}
                  options={[
                    { value: "TEAM", label: "Team" },
                    { value: "PRIVATE", label: "Private" },
                  ]}
                />
              </Field>

              {teamId && visibility === "TEAM" && (
                <Field
                  label="Tag teammates"
                  hint="They'll get a nudge to add this run to their own log."
                >
                  {tagRosterQuery.isLoading ? (
                    <p className="text-[14px] text-mist">Loading teammates…</p>
                  ) : taggableTeammates.length === 0 ? (
                    <p className="text-[14px] text-mist">No teammates to tag.</p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {taggableTeammates.map((m) => (
                        <label
                          key={m.userId}
                          className="flex items-center gap-3 rounded-xl border border-white/10 bg-ink-900 px-4 py-2.5"
                        >
                          <input
                            type="checkbox"
                            checked={taggedUserIds.includes(m.userId)}
                            onChange={() =>
                              setTaggedUserIds((ids) =>
                                ids.includes(m.userId)
                                  ? ids.filter((t) => t !== m.userId)
                                  : [...ids, m.userId],
                              )
                            }
                            className="h-5 w-5 accent-lime-400"
                          />
                          <span className="text-[15px] font-medium">{m.displayName}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </Field>
              )}

              <Button
                onClick={handleConfirm}
                loading={confirmLoading}
                className="w-full"
              >
                Import activity
              </Button>
              <Button variant="ghost" onClick={reset} className="w-full -mt-3">
                Choose a different file
              </Button>
            </div>
          )}
        </div>
      )}

      {phase === "done" && created && (
        <div className="flex flex-col gap-5">
          <Card className="border-volt-400/30 bg-volt-400/5">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-volt-400 text-ink-950">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </span>
              <div>
                <p className="text-[16px] font-extrabold">Imported!</p>
                <p className="text-[14px] text-mist">
                  Your run is now in your training log.
                </p>
              </div>
            </div>
          </Card>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Link to={`/activities/${created.id}`} className="flex-1">
              <Button className="w-full">View activity</Button>
            </Link>
            <Button variant="secondary" className="flex-1" onClick={reset}>
              Import another file
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
