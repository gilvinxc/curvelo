import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActivityDTO, AssignmentDTO } from "@curvelo/shared";
import { api, ApiError } from "../../lib/api";
import {
  Button,
  EmptyState,
  ErrorBanner,
  FullScreenLoader,
  Modal,
} from "../../components/ui";
import { AssignmentRow, CalendarMonth, monthRange } from "./CalendarBits";
import { ActivityRow } from "../activities/ActivityRow";
import { EventDialog } from "./EventDialog";
import { downloadIcs } from "../../lib/ics";
import type { TeamEventDTO } from "@curvelo/shared";
import { activityYMD } from "../../lib/activityFormat";
import { formatYMDLong, toYMD } from "../../lib/workoutFormat";

const CAN_MANAGE = new Set(["COACH", "TEAM_ADMIN"]);

function logCompletionHref(a: AssignmentDTO): string {
  const params = new URLSearchParams({
    assignmentId: a.id,
    workoutTitle: a.workoutTitle,
    scheduledDate: a.scheduledDate,
    teamId: a.teamId,
  });
  return `/activities/new?${params.toString()}`;
}

function formatTime(iso: string): string {
  return iso.slice(11, 16);
}

const EVENT_TYPE_STYLE: Record<string, string> = {
  PRACTICE: "bg-volt-400/15 text-volt-200",
  MEETING: "bg-sky-400/15 text-sky-200",
  RACE: "bg-amber-400/15 text-amber-200",
  SOCIAL: "bg-fuchsia-400/15 text-fuchsia-200",
  OTHER: "bg-white/10 text-mist",
};

function EventRow({
  event,
  canManage,
  onEdit,
  onDelete,
  deleting,
}: {
  event: TeamEventDTO;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = event.description || event.itinerary || event.location;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-md px-2 py-0.5 text-[11px] font-black uppercase tracking-wider ${EVENT_TYPE_STYLE[event.eventType] ?? EVENT_TYPE_STYLE.OTHER}`}
            >
              {event.eventType === "RACE" ? "Race day" : event.eventType.toLowerCase()}
            </span>
            {event.recurring && (
              <span className="text-[11px] font-semibold text-mist">↻ weekly</span>
            )}
          </div>
          <p className="mt-1.5 text-[15px] font-bold text-ink-50">{event.title}</p>
          <p className="mt-0.5 text-[13px] text-mist">
            {formatTime(event.startAt)}
            {event.endAt && ` – ${formatTime(event.endAt)}`}
            {event.location && ` · ${event.location}`}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() =>
              downloadIcs({
                title: event.title,
                description: [event.description, event.itinerary].filter(Boolean).join("\n\n"),
                startAt: event.startAt,
                endAt: event.endAt,
                location: event.location,
              })
            }
            className="rounded-lg px-3 py-2 text-[13px] font-semibold text-mist hover:text-ink-50"
            title="Download a calendar file to add this to your phone's calendar"
          >
            📅 Add
          </button>
          {canManage && (
            <>
              <button
                type="button"
                onClick={onEdit}
                className="rounded-lg px-3 py-2 text-[13px] font-semibold text-mist hover:text-ink-50"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={deleting}
                className="rounded-lg px-3 py-2 text-[13px] font-semibold text-mist hover:text-red-300"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>
      {hasDetails && (
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          className="mt-2 text-[13px] font-semibold text-volt-200"
        >
          {expanded ? "Hide details" : "Show details"}
        </button>
      )}
      {expanded && (
        <div className="mt-2 flex flex-col gap-2 text-[13px] leading-relaxed text-mist">
          {event.description && <p>{event.description}</p>}
          {event.itinerary && (
            <p className="whitespace-pre-line rounded-xl bg-white/5 p-3 text-ink-100">
              {event.itinerary}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function TeamCalendar({
  teamId,
  myRole,
}: {
  teamId: string;
  myRole: string | null;
}) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(toYMD(new Date()));
  const queryClient = useQueryClient();

  const range = monthRange(monthOffset);
  const calQuery = useQuery({
    queryKey: ["teamCalendar", teamId, range.from, range.to],
    queryFn: () => api.teamCalendar(teamId, range.from, range.to),
  });

  const canManage = myRole !== null && CAN_MANAGE.has(myRole);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TeamEventDTO | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportEventIds, setExportEventIds] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: (assignmentId: string) => api.deleteAssignment(assignmentId),
    onMutate: (assignmentId) => setDeletingId(assignmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teamCalendar", teamId] });
      queryClient.invalidateQueries({ queryKey: ["myCalendar"] });
    },
    onError: (err) => {
      setError(
        err instanceof ApiError ? err.message : "Couldn't delete that assignment.",
      );
    },
    onSettled: () => setDeletingId(null),
  });

  const assignments = calQuery.data?.assignments ?? [];
  const activities = calQuery.data?.activities ?? [];
  const events = calQuery.data?.events ?? [];
  const dayAssignments = (selectedDate
    ? assignments.filter((a) => a.scheduledDate === selectedDate)
    : []
  ).sort((a, b) => a.workoutTitle.localeCompare(b.workoutTitle));
  const dayActivities = (selectedDate
    ? activities.filter((a) => activityYMD(a.startedAt) === selectedDate)
    : []
  ).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const dayEvents = (selectedDate
    ? events.filter((e) => e.startAt.slice(0, 10) === selectedDate)
    : []
  ).sort((a, b) => a.startAt.localeCompare(b.startAt));

  const deleteEventMutation = useMutation({
    mutationFn: (eventId: string) => api.deleteTeamEvent(teamId, eventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teamCalendar", teamId] });
      queryClient.invalidateQueries({ queryKey: ["myCalendar"] });
    },
    onError: (err) => {
      setError(
        err instanceof ApiError ? err.message : "Couldn't delete that event.",
      );
    },
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setMonthOffset((o) => o - 1)}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-ink-900 text-mist hover:text-ink-50"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <h2 className="text-[17px] font-extrabold tracking-tight">{range.label}</h2>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setMonthOffset((o) => o + 1)}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-ink-900 text-mist hover:text-ink-50"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m9 18 6-6-6-6" /></svg>
        </button>
      </div>

      {canManage && (
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={() => {
              setExportEventIds(
                events.filter((e) => e.eventType === "RACE").map((e) => e.id),
              );
              setExportOpen(true);
            }}
            className="min-h-[40px] rounded-xl border border-white/15 bg-white/5 px-4 text-[13px] font-semibold text-ink-50"
          >
            ⭳ Entries CSV
          </button>
        </div>
      )}

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      {calQuery.isLoading ? (
        <div className="flex justify-center py-10">
          <FullScreenLoader />
        </div>
      ) : calQuery.isError ? (
        <ErrorBanner message="Couldn't load the calendar." />
      ) : (
        <>
          <CalendarMonth
            assignments={assignments}
            activities={activities}
            events={events}
            monthOffset={monthOffset}
            selectedDate={selectedDate}
            onSelectDate={(d) => setSelectedDate((prev) => (prev === d ? null : d))}
          />

          <div className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
                {selectedDate ? formatYMDLong(selectedDate) : "Pick a day"}
              </h3>
              {canManage && selectedDate && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingEvent(null);
                    setEventDialogOpen(true);
                  }}
                  className="min-h-[44px] rounded-xl border border-white/15 bg-white/5 px-4 text-[13px] font-semibold text-ink-50"
                >
                  ＋ Event
                </button>
              )}
            </div>
            {!selectedDate ? (
              <p className="text-[14px] text-mist">
                Tap a day to see what's scheduled.
              </p>
            ) : dayAssignments.length === 0 &&
              dayActivities.length === 0 &&
              dayEvents.length === 0 ? (
              <EmptyState
                title="Nothing scheduled"
                body="No workouts, events, or logged runs for this day yet."
              />
            ) : (
              <div className="flex flex-col gap-2">
                {dayEvents.map((e) => (
                  <EventRow
                    key={`${e.id}-${e.startAt}`}
                    event={e}
                    canManage={canManage}
                    onEdit={() => {
                      setEditingEvent(e);
                      setEventDialogOpen(true);
                    }}
                    onDelete={() => deleteEventMutation.mutate(e.id)}
                    deleting={deleteEventMutation.isPending}
                  />
                ))}
                {dayAssignments.map((a: AssignmentDTO) => (
                  <AssignmentRow
                    key={a.id}
                    assignment={a}
                    onDelete={canManage ? () => deleteMutation.mutate(a.id) : undefined}
                    deleting={deletingId === a.id}
                    logHref={logCompletionHref(a)}
                  />
                ))}
                {dayActivities.map((a: ActivityDTO) => (
                  <ActivityRow key={a.id} activity={a} showAthlete />
                ))}
              </div>
            )}
          </div>
          {eventDialogOpen && (
            <EventDialog
              teamId={teamId}
              open={eventDialogOpen}
              onClose={() => {
                setEventDialogOpen(false);
                setEditingEvent(null);
              }}
              initialDate={selectedDate ?? toYMD(new Date())}
              existing={editingEvent}
            />
          )}
          <Modal
            open={exportOpen}
            onClose={() => setExportOpen(false)}
            title="Export meet entries"
          >
            <ExportEntriesBody
              events={events}
              selectedIds={exportEventIds}
              onToggle={(id) =>
                setExportEventIds((prev) =>
                  prev.includes(id)
                    ? prev.filter((x) => x !== id)
                    : [...prev, id],
                )
              }
              exporting={exporting}
              onExport={async () => {
                setExporting(true);
                setError(null);
                try {
                  await api.exportEntries(teamId, exportEventIds);
                  setExportOpen(false);
                } catch (err) {
                  setError(
                    err instanceof ApiError
                      ? err.message
                      : "Couldn't export entries.",
                  );
                } finally {
                  setExporting(false);
                }
              }}
            />
          </Modal>
        </>
      )}
    </div>
  );
}


/** Checkbox list of meets + download button for the entries CSV export. */
function ExportEntriesBody({
  events,
  selectedIds,
  onToggle,
  exporting,
  onExport,
}: {
  events: TeamEventDTO[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  exporting: boolean;
  onExport: () => void;
}) {
  const races = events.filter((e) => e.eventType === "RACE");
  const list = races.length > 0 ? races : events;
  if (list.length === 0) {
    return (
      <p className="text-[14px] text-mist">
        No events in this month. Add a race to the calendar first.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14px] text-mist">
        One row per runner per selected meet. Upload the CSV to MileSplit,
        Athletic.net, or your meet entry site.
      </p>
      <div className="flex max-h-[40vh] flex-col gap-1.5 overflow-y-auto">
        {list.map((e) => (
          <label
            key={e.id}
            className="flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2.5 text-[14px]"
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(e.id)}
              onChange={() => onToggle(e.id)}
              className="h-5 w-5"
            />
            <span className="flex-1">
              <span className="font-bold">{e.title}</span>
              <span className="text-mist">
                {" "}
                · {e.startAt.slice(0, 10)}
              </span>
            </span>
          </label>
        ))}
      </div>
      <Button
        disabled={selectedIds.length === 0 || exporting}
        onClick={onExport}
        className="min-h-[48px]"
      >
        {exporting
          ? "Exporting…"
          : `Download CSV (${selectedIds.length} ${selectedIds.length === 1 ? "meet" : "meets"})`}
      </Button>
    </div>
  );
}
