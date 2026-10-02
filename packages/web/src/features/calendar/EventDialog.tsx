import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";
import {
  Button,
  ErrorBanner,
  Field,
  Modal,
  Select,
  TextArea,
  TextInput,
} from "../../components/ui";
import type { CreateTeamEventInput, TeamEventDTO } from "@curvelo/shared";

const EVENT_TYPES = [
  { value: "PRACTICE", label: "Practice" },
  { value: "MEETING", label: "Meeting" },
  { value: "RACE", label: "Race day" },
  { value: "SOCIAL", label: "Social" },
  { value: "OTHER", label: "Other" },
] as const;

const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function EventDialog({
  teamId,
  open,
  onClose,
  initialDate,
  existing,
}: {
  teamId: string;
  open: boolean;
  onClose: () => void;
  initialDate: string;
  existing?: TeamEventDTO | null;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(existing?.title ?? "");
  const [eventType, setEventType] = useState<string>(
    existing?.eventType ?? "PRACTICE",
  );
  const [date, setDate] = useState(
    existing ? existing.startAt.slice(0, 10) : initialDate,
  );
  const [startTime, setStartTime] = useState(
    existing ? existing.startAt.slice(11, 16) : "17:00",
  );
  const [endTime, setEndTime] = useState(
    existing?.endAt ? existing.endAt.slice(11, 16) : "",
  );
  const [location, setLocation] = useState(existing?.location ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [itinerary, setItinerary] = useState(existing?.itinerary ?? "");
  const [repeat, setRepeat] = useState(!!existing?.recurring);
  const [repeatDays, setRepeatDays] = useState<number[]>(
    existing?.recurrence?.days ?? [],
  );
  const [repeatUntil, setRepeatUntil] = useState(
    existing?.recurrence?.until ?? "",
  );
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["teamCalendar", teamId] });
    queryClient.invalidateQueries({ queryKey: ["myCalendar"] });
  };

  const mutation = useMutation({
    mutationFn: () => {
      const input: CreateTeamEventInput = {
        title: title.trim(),
        eventType: eventType as CreateTeamEventInput["eventType"],
        date,
        startTime,
        ...(endTime ? { endTime } : {}),
        ...(location.trim() ? { location: location.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(itinerary.trim() ? { itinerary: itinerary.trim() } : {}),
        ...(repeat && repeatDays.length > 0 && repeatUntil
          ? {
              recurrence: {
                freq: "WEEKLY" as const,
                days: [...repeatDays].sort((a, b) => a - b),
                until: repeatUntil,
              },
            }
          : {}),
      };
      return existing
        ? api.updateTeamEvent(teamId, existing.id, input)
        : api.createTeamEvent(teamId, input);
    },
    onSuccess: () => {
      setError(null);
      invalidate();
      onClose();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Couldn't save the event."),
  });

  const toggleDay = (d: number) =>
    setRepeatDays((ds) =>
      ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d],
    );

  const canSave =
    title.trim().length > 0 &&
    date.length === 10 &&
    /^\d{2}:\d{2}$/.test(startTime) &&
    (!endTime || /^\d{2}:\d{2}$/.test(endTime)) &&
    (!repeat || (repeatDays.length > 0 && repeatUntil.length === 10)) &&
    !mutation.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? "Edit event" : "Add team event"}
    >
      <div className="flex flex-col gap-3">
        {error && <ErrorBanner message={error} />}
        <Field label="Title">
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="Tuesday practice"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
            >
              {EVENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date">
            <TextInput
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start time">
            <TextInput
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </Field>
          <Field label="End time (optional)">
            <TextInput
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Location (optional)">
          <TextInput
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={200}
            placeholder="Track, 123 Main St"
          />
        </Field>
        <Field label="Details (optional)">
          <TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
        </Field>
        {eventType === "RACE" && (
          <Field label="Race-day itinerary (optional)">
            <TextArea
              value={itinerary}
              onChange={(e) => setItinerary(e.target.value)}
              rows={4}
              placeholder={"7:00 — Arrive & check in\n7:30 — Warmup\n8:00 — Race start"}
            />
          </Field>
        )}
        {!existing && (
          <label className="flex items-center gap-2 text-[14px] font-semibold text-ink-50">
            <input
              type="checkbox"
              checked={repeat}
              onChange={(e) => setRepeat(e.target.checked)}
              className="h-5 w-5 accent-lime-400"
            />
            Repeat weekly
          </label>
        )}
        {repeat && !existing && (
          <div className="flex flex-col gap-2 rounded-xl border border-white/10 p-3">
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_SHORT.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(i)}
                  className={
                    repeatDays.includes(i)
                      ? "rounded-lg bg-volt-400 px-3 py-2 text-[13px] font-bold text-ink-950"
                      : "rounded-lg border border-white/15 px-3 py-2 text-[13px] text-mist"
                  }
                >
                  {d}
                </button>
              ))}
            </div>
            <Field label="Repeat until">
              <TextInput
                type="date"
                value={repeatUntil}
                onChange={(e) => setRepeatUntil(e.target.value)}
              />
            </Field>
          </div>
        )}
        <Button
          onClick={() => mutation.mutate()}
          disabled={!canSave}
          className="min-h-[48px]"
        >
          {mutation.isPending ? "Saving…" : existing ? "Save changes" : "Add event"}
        </Button>
      </div>
    </Modal>
  );
}
