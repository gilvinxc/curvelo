import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AssignmentDTO } from "@curvelo/shared";
import { api, ApiError } from "../../lib/api";
import {
  EmptyState,
  ErrorBanner,
  FullScreenLoader,
} from "../../components/ui";
import { AssignmentRow, CalendarMonth, monthRange } from "./CalendarBits";
import { formatYMDLong, toYMD } from "../../lib/workoutFormat";

const CAN_MANAGE = new Set(["COACH", "TEAM_ADMIN"]);

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
  const dayAssignments = (selectedDate
    ? assignments.filter((a) => a.scheduledDate === selectedDate)
    : []
  ).sort((a, b) => a.workoutTitle.localeCompare(b.workoutTitle));

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
            monthOffset={monthOffset}
            selectedDate={selectedDate}
            onSelectDate={(d) => setSelectedDate((prev) => (prev === d ? null : d))}
          />

          <div className="mt-6">
            <h3 className="mb-3 text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
              {selectedDate ? formatYMDLong(selectedDate) : "Pick a day"}
            </h3>
            {!selectedDate ? (
              <p className="text-[14px] text-mist">
                Tap a day to see what's scheduled.
              </p>
            ) : dayAssignments.length === 0 ? (
              <EmptyState
                title="Nothing scheduled"
                body="No workouts assigned for this day yet."
              />
            ) : (
              <div className="flex flex-col gap-2">
                {dayAssignments.map((a: AssignmentDTO) => (
                  <AssignmentRow
                    key={a.id}
                    assignment={a}
                    onDelete={canManage ? () => deleteMutation.mutate(a.id) : undefined}
                    deleting={deletingId === a.id}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
