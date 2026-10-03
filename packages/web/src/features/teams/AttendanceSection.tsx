import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  FullScreenLoader,
  Modal,
  TextInput,
  UserAvatar,} from "../../components/ui";
import { todayYMD } from "../../lib/workoutFormat";

export function AttendanceSection({ teamId }: { teamId: string }) {
  const queryClient = useQueryClient();
  const [taking, setTaking] = useState(false);

  const historyQuery = useQuery({
    queryKey: ["attendance", teamId],
    queryFn: () => api.listAttendance(teamId),
  });

  const history = historyQuery.data?.attendance ?? [];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
          Attendance
        </p>
        <Button className="min-h-[44px] px-4 text-[14px]" onClick={() => setTaking(true)}>
          Take attendance
        </Button>
      </div>

      {historyQuery.isLoading ? (
        <div className="flex justify-center py-8">
          <FullScreenLoader />
        </div>
      ) : historyQuery.isError ? (
        <ErrorBanner message="Couldn't load attendance." />
      ) : history.length === 0 ? (
        <EmptyState
          title="No attendance yet"
          body="Take attendance at practice and the history builds up here."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {history.map((a) => (
            <AttendanceRow key={a.id} teamId={teamId} attendance={a} />
          ))}
        </div>
      )}

      {taking && (
        <TakeAttendanceDialog
          teamId={teamId}
          onClose={() => {
            setTaking(false);
            queryClient.invalidateQueries({ queryKey: ["attendance", teamId] });
          }}
        />
      )}
    </div>
  );
}

function AttendanceRow({
  teamId,
  attendance,
}: {
  teamId: string;
  attendance: {
    id: string;
    date: string;
    eventTitle: string | null;
    presentCount: number;
    absentCount: number;
    presentPct: number;
  };
}) {
  const [expanded, setExpanded] = useState(false);
  const detailQuery = useQuery({
    queryKey: ["attendance", teamId, attendance.id],
    queryFn: () => api.getAttendance(teamId, attendance.id),
    enabled: expanded,
  });
  const members = detailQuery.data?.attendance.members ?? [];
  const total = attendance.presentCount + attendance.absentCount;

  return (
    <Card className="p-4">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-extrabold tracking-tight">
            {formatDate(attendance.date)}
            {attendance.eventTitle ? ` — ${attendance.eventTitle}` : ""}
          </p>
          <p className="text-[13px] text-mist">
            {attendance.presentCount}/{total} present ({attendance.presentPct}%)
          </p>
        </div>
        <div
          className="h-2.5 w-24 shrink-0 overflow-hidden rounded-full bg-white/10"
          aria-hidden
        >
          <div
            className="h-full rounded-full bg-lime-400"
            style={{ width: `${attendance.presentPct}%` }}
          />
        </div>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className={`shrink-0 text-mist transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {expanded && (
        <div className="mt-3 border-t border-white/10 pt-3">
          {detailQuery.isLoading ? (
            <div className="flex justify-center py-4">
              <FullScreenLoader />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {members.map((m) => (
                <div
                  key={m.userId}
                  className="flex items-center gap-2.5 rounded-xl bg-ink-800 px-3 py-2"
                >
                  <UserAvatar userId={m.userId} name={m.displayName} hasAvatar={m.hasAvatar} size="sm" />
                  <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                    {m.displayName}
                  </p>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[12px] font-bold ${
                      m.present
                        ? "bg-lime-400/15 text-lime-300"
                        : "bg-red-400/15 text-red-300"
                    }`}
                  >
                    {m.present ? "Present" : "Absent"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function TakeAttendanceDialog({
  teamId,
  onClose,
}: {
  teamId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayYMD());
  const [present, setPresent] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  const rosterQuery = useQuery({
    queryKey: ["roster", teamId],
    queryFn: () => api.getRoster(teamId),
  });
  const runners = (rosterQuery.data?.roster ?? []).filter((m) => m.role === "RUNNER");

  useEffect(() => {
    if (!initialized && runners.length > 0) {
      setPresent(new Set(runners.map((r) => r.userId)));
      setInitialized(true);
    }
  }, [runners, initialized]);

  const toggle = (userId: string) =>
    setPresent((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  const mutation = useMutation({
    mutationFn: () =>
      api.saveAttendance(teamId, {
        date,
        records: Object.fromEntries(runners.map((r) => [r.userId, present.has(r.userId)])),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance", teamId] });
      onClose();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Couldn't save attendance."),
  });

  return (
    <Modal open onClose={onClose} title="Take attendance">
      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}
      <div className="flex flex-col gap-4">
        <Field label="Date">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[13px] font-semibold uppercase tracking-wide text-mist">
              {present.size}/{runners.length} present
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                className="text-[13px] font-semibold text-lime-300"
                onClick={() => setPresent(new Set(runners.map((r) => r.userId)))}
              >
                All present
              </button>
              <button
                type="button"
                className="text-[13px] font-semibold text-mist"
                onClick={() => setPresent(new Set())}
              >
                Clear
              </button>
            </div>
          </div>
          {rosterQuery.isLoading ? (
            <div className="flex justify-center py-6">
              <FullScreenLoader />
            </div>
          ) : (
            <div className="flex max-h-[45vh] flex-col gap-1.5 overflow-y-auto">
              {runners.map((r) => (
                <button
                  key={r.userId}
                  type="button"
                  onClick={() => toggle(r.userId)}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                    present.has(r.userId)
                      ? "border-lime-400/40 bg-lime-400/5"
                      : "border-white/10 bg-ink-800"
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                      present.has(r.userId) ? "border-lime-400 bg-lime-400" : "border-white/25"
                    }`}
                  >
                    {present.has(r.userId) && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0a0f0a" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </span>
                  <UserAvatar userId={r.userId} name={r.displayName} hasAvatar={r.hasAvatar} size="sm" />
                  <p className="min-w-0 flex-1 truncate text-[15px] font-semibold">
                    {r.displayName}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
        <Button
          className="w-full"
          disabled={runners.length === 0 || date.length !== 10}
          loading={mutation.isPending}
          onClick={() => {
            setError(null);
            mutation.mutate();
          }}
        >
          Save attendance
        </Button>
      </div>
    </Modal>
  );
}

function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
