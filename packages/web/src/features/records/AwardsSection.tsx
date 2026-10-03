import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";
import type { AwardDTO, AwardType } from "@curvelo/shared";
import {
  Button,
  EmptyState,
  ErrorBanner,
  Field,
  Modal,
  Select,
  TextArea,
  TextInput,
} from "../../components/ui";

const TYPE_OPTIONS: Array<{ value: AwardType; label: string; emoji: string }> = [
  { value: "MEDAL", label: "Medal", emoji: "🥇" },
  { value: "TROPHY", label: "Trophy", emoji: "🏆" },
  { value: "RIBBON", label: "Ribbon", emoji: "🎗️" },
  { value: "PLAQUE", label: "Plaque", emoji: "🏅" },
  { value: "OTHER", label: "Other", emoji: "⭐" },
];

function typeEmoji(t: string): string {
  return TYPE_OPTIONS.find((o) => o.value === t)?.emoji ?? "🏆";
}

function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AwardDialog({
  teamId,
  athleteId,
  athleteName,
  existing,
  prefill,
  open,
  onClose,
}: {
  teamId: string;
  athleteId: string;
  athleteName: string;
  existing?: AwardDTO | null;
  prefill?: Partial<{
    type: AwardType;
    place: number;
    eventName: string;
    eventDate: string;
  }>;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<AwardType>(
    existing?.type ?? prefill?.type ?? "MEDAL",
  );
  const [place, setPlace] = useState(
    existing?.place != null
      ? String(existing.place)
      : prefill?.place != null
        ? String(prefill.place)
        : "",
  );
  const [eventName, setEventName] = useState(
    existing?.eventName ?? prefill?.eventName ?? "",
  );
  const [eventDate, setEventDate] = useState(
    existing?.eventDate ?? prefill?.eventDate ?? todayInput(),
  );
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [postToFeed, setPostToFeed] = useState(!existing);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const p = place.trim() === "" ? undefined : parseInt(place, 10);
      if (p !== undefined && !(p > 0)) throw new Error("Place must be positive.");
      if (!eventName.trim()) throw new Error("Event name is required.");
      const base = {
        type,
        place: p ?? null,
        eventName: eventName.trim(),
        eventDate,
        notes: notes.trim() || null,
      };
      return existing
        ? api.updateAward(existing.id, base)
        : api.createAward(teamId, {
            athleteId,
            ...base,
            place: p,
            notes: notes.trim() || undefined,
            postToFeed,
          });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["athleteAwards", teamId, athleteId] });
      queryClient.invalidateQueries({ queryKey: ["teamAwards", teamId] });
      queryClient.invalidateQueries({ queryKey: ["awardCount", teamId] });
      onClose();
    },
    onError: (err) => {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Couldn't save the award.",
      );
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? "Edit award" : `Award for ${athleteName}`}
    >
      <div className="flex flex-col gap-4">
        {error && <ErrorBanner message={error} />}
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value as AwardType)}>
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.emoji} {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Place (optional)">
            <TextInput
              inputMode="numeric"
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              placeholder="1"
            />
          </Field>
          <Field label="Date">
            <TextInput
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Event">
          <TextInput
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            placeholder="Winchester 5K Classic"
            maxLength={160}
          />
        </Field>
        <Field label="Notes (optional)">
          <TextArea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Anything worth remembering"
          />
        </Field>
        {!existing && (
          <label className="flex items-center gap-2 text-[14px] text-ink-100">
            <input
              type="checkbox"
              checked={postToFeed}
              onChange={(e) => setPostToFeed(e.target.checked)}
              className="h-5 w-5 accent-volt-400"
            />
            Share to the team feed
          </label>
        )}
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="min-h-[48px]"
        >
          {save.isPending ? "Saving…" : existing ? "Save changes" : "Add award"}
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Awards shelf on the athlete page (coach view). Coaches can add, edit,
 * and delete; the shelf itself is visible to whoever can see the page.
 */
export function AwardsSection({
  teamId,
  athleteId,
  athleteName,
}: {
  teamId: string;
  athleteId: string;
  athleteName: string;
}) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AwardDTO | null>(null);

  const awardsQuery = useQuery({
    queryKey: ["athleteAwards", teamId, athleteId],
    queryFn: () => api.listAthleteAwards(teamId, athleteId),
  });

  const del = useMutation({
    mutationFn: (awardId: string) => api.deleteAward(awardId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["athleteAwards", teamId, athleteId] });
      queryClient.invalidateQueries({ queryKey: ["teamAwards", teamId] });
      queryClient.invalidateQueries({ queryKey: ["awardCount", teamId] });
    },
  });

  const awards = awardsQuery.data?.awards ?? [];

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
          🏆 Awards
        </h2>
        <Button
          variant="secondary"
          className="min-h-[40px] px-3 text-[13px]"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          + Add award
        </Button>
      </div>
      {awardsQuery.isLoading ? (
        <p className="text-[14px] text-mist">Loading…</p>
      ) : awards.length === 0 ? (
        <EmptyState
          title="No awards yet"
          body="Medals, trophies, and ribbons will show up here."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {awards.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-ink-900 px-4 py-3"
            >
              <span className="text-2xl">{typeEmoji(a.type)}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold">
                  {a.eventName}
                  {a.place != null && (
                    <span className="text-mist"> · #{a.place}</span>
                  )}
                </p>
                <p className="text-[13px] text-mist">
                  {a.eventDate}
                  {a.notes ? ` · ${a.notes}` : ""}
                </p>
              </div>
              <button
                className="min-h-[44px] px-2 text-[13px] font-bold text-volt-300"
                onClick={() => {
                  setEditing(a);
                  setDialogOpen(true);
                }}
              >
                Edit
              </button>
              <button
                className="min-h-[44px] px-2 text-[13px] font-bold text-red-300"
                onClick={() => {
                  if (window.confirm(`Remove this award from ${a.eventName}?`)) {
                    del.mutate(a.id);
                  }
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
      {dialogOpen && (
        <AwardDialog
          teamId={teamId}
          athleteId={athleteId}
          athleteName={athleteName}
          existing={editing}
          open={dialogOpen}
          onClose={() => {
            setDialogOpen(false);
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}
