import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ActivityDTO, AssignmentDTO } from "@curvelo/shared";
import { api } from "../../lib/api";
import {
  ErrorBanner,
  FullScreenLoader,
  PageHeader,
} from "../../components/ui";
import { AssignmentRow, CalendarMonth, monthRange } from "./CalendarBits";
import { ActivityRow } from "../activities/ActivityRow";
import { PersonalPlansSection } from "./PersonalPlansSection";
import { activityYMD } from "../../lib/activityFormat";
import { addDaysYMD, formatYMDLong, todayYMD } from "../../lib/workoutFormat";

function logCompletionHref(a: AssignmentDTO): string {
  const params = new URLSearchParams({
    assignmentId: a.id,
    workoutTitle: a.workoutTitle,
    scheduledDate: a.scheduledDate,
    teamId: a.teamId,
  });
  return `/activities/new?${params.toString()}`;
}

export function PersonalCalendarPage() {
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(todayYMD());

  const range = monthRange(monthOffset);
  const calQuery = useQuery({
    queryKey: ["myCalendar", range.from, range.to],
    queryFn: () => api.myCalendar(range.from, range.to),
  });

  const assignments = calQuery.data?.assignments ?? [];
  const activities = calQuery.data?.activities ?? [];
  const planDaysQuery = useQuery({
    queryKey: ["personalPlanDays", range.from, range.to],
    queryFn: () => api.personalPlanDays(range.from, range.to),
  });
  const teamEventsQuery = useQuery({
    queryKey: ["myTeamEvents", range.from, range.to],
    queryFn: () => api.myTeamEvents(range.from, range.to),
  });
  const teamEvents = teamEventsQuery.data?.events ?? [];
  const dayTeamEvents = selectedDate
    ? teamEvents.filter((e) => e.startAt.slice(0, 10) === selectedDate)
    : [];
  const planDays = planDaysQuery.data?.days ?? [];
  const dayPlanItems = (selectedDate
    ? planDays.filter((d) => d.date === selectedDate)
    : []
  ).sort((a, b) => a.title.localeCompare(b.title));
  const dayAssignments = (selectedDate
    ? assignments.filter((a) => a.scheduledDate === selectedDate)
    : []
  ).sort((a, b) => a.workoutTitle.localeCompare(b.workoutTitle));
  const dayActivities = (selectedDate
    ? activities.filter((a) => activityYMD(a.startedAt) === selectedDate)
    : []
  ).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));

  return (
    <div>
      <PageHeader
        title="My calendar"
        subtitle="Everything in one place — your plans, workouts, and team events"
        backTo="/dashboard"
      />

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

      {calQuery.isLoading ? (
        <div className="flex justify-center py-10">
          <FullScreenLoader />
        </div>
      ) : calQuery.isError ? (
        <ErrorBanner message="Couldn't load your calendar." />
      ) : (
        <>
          <CalendarMonth
            assignments={assignments}
            activities={activities}
            planDays={planDays}
            events={teamEvents}
            monthOffset={monthOffset}
            selectedDate={selectedDate}
            onSelectDate={(d) => setSelectedDate((prev) => (prev === d ? null : d))}
          />
          <div className="mt-6">
            <h3 className="mb-3 text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
              {selectedDate ? formatYMDLong(selectedDate) : "Pick a day"}
            </h3>
            {selectedDate &&
            dayAssignments.length === 0 &&
            dayActivities.length === 0 &&
            dayPlanItems.length === 0 &&
            dayTeamEvents.length === 0 ? (
              <p className="text-[14px] text-mist">Nothing scheduled that day.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {dayTeamEvents.map((e) => (
                  <div
                    key={e.id}
                    className="rounded-2xl border border-sky-400/25 bg-sky-400/[0.06] p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-sky-400/20 px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-sky-200">
                        {e.eventType === "RACE" ? "Race day" : e.eventType.toLowerCase()}
                      </span>
                      <span className="text-[11px] font-semibold text-mist">
                        {e.teamName ?? "Team event"}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[15px] font-bold text-ink-50">
                      {e.title}
                    </p>
                    <p className="mt-0.5 text-[13px] text-mist">
                      {e.location && `${e.location} · `}
                      {new Date(e.startAt).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                ))}
                {dayPlanItems.map((d) => (
                  <div
                    key={d.id}
                    className="rounded-2xl border border-volt-400/25 bg-volt-400/[0.06] p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-volt-400/20 px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-volt-200">
                        My plan
                      </span>
                      <span className="text-[11px] font-semibold text-mist">
                        {d.planName}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[15px] font-bold text-ink-50">
                      {d.title}
                    </p>
                    {d.notes && (
                      <p className="mt-0.5 text-[13px] text-mist">{d.notes}</p>
                    )}
                  </div>
                ))}
                {dayAssignments.map((a) => (
                  <AssignmentRow
                    key={a.id}
                    assignment={a}
                    showTeam
                    logHref={logCompletionHref(a)}
                  />
                ))}
                {dayActivities.map((a: ActivityDTO) => (
                  <ActivityRow key={a.id} activity={a} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
      <PersonalPlansSection />
    </div>
  );
}

/** Next-14-days snapshot for the dashboard. Renders nothing when empty. */
export function UpcomingWorkouts() {
  const from = todayYMD();
  const to = addDaysYMD(from, 13);
  const calQuery = useQuery({
    queryKey: ["myCalendar", from, to],
    queryFn: () => api.myCalendar(from, to),
  });

  if (calQuery.isLoading) {
    return (
      <section className="mb-8">
        <div className="flex justify-center py-6">
          <FullScreenLoader />
        </div>
      </section>
    );
  }
  if (calQuery.isError) return null;

  const assignments = [...(calQuery.data?.assignments ?? [])]
    .filter((a) => a.scheduledDate >= from)
    .sort((a, b) =>
      a.scheduledDate === b.scheduledDate
        ? a.workoutTitle.localeCompare(b.workoutTitle)
        : a.scheduledDate < b.scheduledDate
          ? -1
          : 1,
    );

  if (assignments.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
          Upcoming workouts
        </h2>
        <a
          href="/calendar"
          className="text-[14px] font-bold text-volt-300 hover:text-volt-400"
        >
          View calendar →
        </a>
      </div>
      <div className="flex flex-col gap-2">
        {assignments.slice(0, 8).map((a) => (
          <AssignmentRow
            key={a.id}
            assignment={a}
            showTeam
            logHref={logCompletionHref(a)}
          />
        ))}
      </div>
    </section>
  );
}
