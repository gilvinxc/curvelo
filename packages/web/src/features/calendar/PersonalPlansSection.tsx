import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PersonalPlanDTO } from "@curvelo/shared";
import { ApiError, api } from "../../lib/api";
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  TextArea,
  TextInput,
} from "../../components/ui";
import { todayYMD } from "../../lib/workoutFormat";

interface DayDraft {
  date: string;
  title: string;
  notes: string;
}

const blankDay = (): DayDraft => ({ date: todayYMD(), title: "", notes: "" });

export function PersonalPlansSection() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PersonalPlanDTO | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const plansQuery = useQuery({
    queryKey: ["personalPlans"],
    queryFn: () => api.listPersonalPlans(),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["personalPlans"] });
    queryClient.invalidateQueries({ queryKey: ["personalPlanDays"] });
    queryClient.invalidateQueries({ queryKey: ["myCalendar"] });
  };

  const applyMutation = useMutation({
    mutationFn: ({ id, applied }: { id: string; applied: boolean }) =>
      applied ? api.unapplyPersonalPlan(id) : api.applyPersonalPlan(id),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deletePersonalPlan(id),
    onSuccess: () => {
      setConfirmDelete(null);
      invalidate();
    },
  });

  const plans = plansQuery.data?.plans ?? [];

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
          My training plans
        </h3>
        <Button
          variant="secondary"
          className="min-h-[44px] px-4 text-[14px]"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          + New plan
        </Button>
      </div>
      <p className="-mt-1 mb-3 text-[13px] text-mist">
        Your own dated workout lists. Apply one to show it on your calendar —
        your coaches can see your planned workouts too.
      </p>

      {plansQuery.isError && (
        <ErrorBanner message="Couldn't load your training plans." />
      )}
      {plans.length === 0 && !plansQuery.isLoading ? (
        <Card>
          <p className="text-[14px] text-mist">
            No personal plans yet. Create one for off-season training or any
            stretch without a team plan.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {plans.map((plan) => (
            <Card key={plan.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-[15px] font-extrabold tracking-tight">
                      {plan.name}
                    </h4>
                    {plan.applied && (
                      <span className="rounded-md bg-volt-400/20 px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-volt-200">
                        On calendar
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[13px] text-mist">
                    {plan.days.length} {plan.days.length === 1 ? "day" : "days"}
                    {plan.days.length > 0 &&
                      ` · ${plan.days[0].date} → ${plan.days[plan.days.length - 1].date}`}
                  </p>
                </div>
              </div>
              {confirmDelete === plan.id ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-mist">
                    Delete this plan?
                  </span>
                  <Button
                    variant="secondary"
                    className="min-h-[40px] px-3 text-[13px]"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(plan.id)}
                  >
                    Yes, delete
                  </Button>
                  <Button
                    variant="secondary"
                    className="min-h-[40px] px-3 text-[13px]"
                    onClick={() => setConfirmDelete(null)}
                  >
                    Keep
                  </Button>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    className="min-h-[40px] px-3 text-[13px]"
                    disabled={applyMutation.isPending}
                    onClick={() =>
                      applyMutation.mutate({ id: plan.id, applied: plan.applied })
                    }
                  >
                    {plan.applied ? "Remove from calendar" : "Apply to calendar"}
                  </Button>
                  <Button
                    variant="secondary"
                    className="min-h-[40px] px-3 text-[13px]"
                    onClick={() => {
                      setEditing(plan);
                      setDialogOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="secondary"
                    className="min-h-[40px] px-3 text-[13px]"
                    onClick={() => setConfirmDelete(plan.id)}
                  >
                    Delete
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {dialogOpen && (
        <PlanDialog
          existing={editing}
          onClose={() => {
            setDialogOpen(false);
            setEditing(null);
          }}
          onSaved={invalidate}
        />
      )}
    </section>
  );
}

function PlanDialog({
  existing,
  onClose,
  onSaved,
}: {
  existing: PersonalPlanDTO | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [days, setDays] = useState<DayDraft[]>(
    existing?.days.map((d) => ({
      date: d.date,
      title: d.title,
      notes: d.notes ?? "",
    })) ?? [blankDay()],
  );
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        days: days
          .filter((d) => d.title.trim())
          .map((d) => ({
            date: d.date,
            title: d.title.trim(),
            notes: d.notes.trim() || undefined,
          })),
      };
      if (existing) return api.updatePersonalPlan(existing.id, payload);
      return api.createPersonalPlan(payload);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err) => {
      setError(
        err instanceof ApiError ? err.message : "Couldn't save the plan.",
      );
    },
  });

  const setDay = (i: number, patch: Partial<DayDraft>) =>
    setDays((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const valid = name.trim().length > 0 && days.some((d) => d.title.trim());

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/10 bg-ink-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[18px] font-extrabold tracking-tight">
          {existing ? "Edit training plan" : "New training plan"}
        </h3>
        <p className="mt-1 text-[13px] text-mist">
          A dated list of workouts in plain language.
        </p>
        {error && (
          <div className="mt-3">
            <ErrorBanner message={error} />
          </div>
        )}
        <div className="mt-4 flex flex-col gap-4">
          <Field label="Plan name">
            <TextInput
              value={name}
              maxLength={120}
              placeholder="Off-season base"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Description" hint="Optional">
            <TextArea
              value={description}
              maxLength={2000}
              rows={2}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <div>
            <p className="mb-2 text-[13px] font-bold uppercase tracking-[0.14em] text-mist">
              Days
            </p>
            <div className="flex flex-col gap-3">
              {days.map((d, i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
                >
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={d.date}
                      onChange={(e) => setDay(i, { date: e.target.value })}
                      className="min-h-[44px] w-[150px] shrink-0 rounded-xl border border-white/10 bg-ink-950 px-3 text-[14px] text-ink-50"
                    />
                    <TextInput
                      value={d.title}
                      maxLength={200}
                      placeholder="Easy 4 miles"
                      onChange={(e) => setDay(i, { title: e.target.value })}
                    />
                    {days.length > 1 && (
                      <button
                        type="button"
                        aria-label="Remove day"
                        onClick={() =>
                          setDays((ds) => ds.filter((_, j) => j !== i))
                        }
                        className="shrink-0 rounded-xl px-3 text-[16px] text-mist hover:text-red-300"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <div className="mt-2">
                    <TextInput
                      value={d.notes}
                      maxLength={2000}
                      placeholder="Notes (optional)"
                      onChange={(e) => setDay(i, { notes: e.target.value })}
                    />
                  </div>
                </div>
              ))}
            </div>
            <Button
              variant="secondary"
              className="mt-2 min-h-[44px] px-4 text-[14px]"
              onClick={() => setDays((ds) => [...ds, blankDay()])}
            >
              + Add day
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              className="min-h-[48px] flex-1"
              disabled={!valid || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? "Saving…" : existing ? "Save changes" : "Create plan"}
            </Button>
            <Button
              variant="secondary"
              className="min-h-[48px] px-5"
              onClick={onClose}
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
