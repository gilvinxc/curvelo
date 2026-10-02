import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ShoeDTO } from "@curvelo/shared";
import { api, ApiError } from "../../lib/api";
import { formatDistance, useUnits } from "../../lib/units";
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

const RETIRE_MILES = 400;

function AddShoeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      api.createShoe({
        name,
        brand: brand || undefined,
        model: model || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["myShoes"] });
      onClose();
      setName("");
      setBrand("");
      setModel("");
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Add shoes">
      <div className="space-y-4">
        {mutation.isError && (
          <ErrorBanner
            message={
              mutation.error instanceof ApiError ? mutation.error.message : "Couldn't add the shoes."
            }
          />
        )}
        <Field label="Name">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Daily trainers"
            maxLength={80}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Brand (optional)">
            <TextInput value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={60} />
          </Field>
          <Field label="Model (optional)">
            <TextInput value={model} onChange={(e) => setModel(e.target.value)} maxLength={60} />
          </Field>
        </div>
        <Button
          className="w-full"
          disabled={mutation.isPending || !name.trim()}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "Adding…" : "Add shoes"}
        </Button>
      </div>
    </Modal>
  );
}

function ShoeCard({ shoe }: { shoe: ShoeDTO }) {
  const queryClient = useQueryClient();
  const units = useUnits();
  const retireMutation = useMutation({
    mutationFn: () => api.updateShoe(shoe.id, { retired: !shoe.retired }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["myShoes"] }),
  });
  const defaultMutation = useMutation({
    mutationFn: () => api.setDefaultShoe(shoe.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["myShoes"] }),
  });
  const miles = shoe.mileageM / (units === "metric" ? 1000 : 1609.344);
  const warn = !shoe.retired && miles >= RETIRE_MILES;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-bold text-ink-50">
            {shoe.retired ? "🪦 " : "👟 "}
            {shoe.name}
            {shoe.isDefault && !shoe.retired && (
              <span className="ml-1 rounded-full bg-volt-400/20 px-2 py-0.5 text-[11px] font-bold text-volt-300">
                DEFAULT
              </span>
            )}
          </p>
          {(shoe.brand || shoe.model) && (
            <p className="text-[13px] text-mist">
              {[shoe.brand, shoe.model].filter(Boolean).join(" ")}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          {!shoe.retired && !shoe.isDefault && (
            <button
              onClick={() => defaultMutation.mutate()}
              disabled={defaultMutation.isPending}
              className="rounded-lg px-2 py-1 text-[13px] font-semibold text-volt-300 hover:text-volt-200"
              title="Use this shoe for new runs until you change it"
            >
              Set default
            </button>
          )}
          <button
            onClick={() => retireMutation.mutate()}
            disabled={retireMutation.isPending}
            className="rounded-lg px-2 py-1 text-[13px] font-semibold text-mist hover:text-ink-50"
          >
            {shoe.retired ? "Un-retire" : "Retire"}
          </button>
        </div>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-valuenow={Math.min(100, Math.round((miles / 500) * 100))}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-full ${warn ? "bg-amber-400" : "bg-volt-400/70"}`}
          style={{ width: `${Math.min(100, (miles / 500) * 100)}%` }}
        />
      </div>
      <p className="mt-1 text-[13px] font-semibold text-mist">
        {formatDistance(shoe.mileageM, units)}
        {warn && <span className="text-amber-300"> · time to replace soon</span>}
        {shoe.retired && <span> · retired</span>}
      </p>
    </div>
  );
}

export function ShoesSection() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const shoesQuery = useQuery({
    queryKey: ["myShoes"],
    queryFn: () => api.myShoes(),
  });
  const shoes: ShoeDTO[] = shoesQuery.data?.shoes ?? [];

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[16px] font-extrabold text-ink-50">My shoes</h3>
        <Button onClick={() => setDialogOpen(true)}>+ Add shoes</Button>
      </div>
      {shoesQuery.isLoading ? (
        <FullScreenLoader />
      ) : shoesQuery.isError ? (
        <ErrorBanner message="Couldn't load your shoes." />
      ) : shoes.length === 0 ? (
        <EmptyState
          title="No shoes tracked"
          body="Add your running shoes and pick them when you log a run — mileage adds up automatically."
        />
      ) : (
        <div className="space-y-2">
          {shoes.map((s) => (
            <ShoeCard key={s.id} shoe={s} />
          ))}
        </div>
      )}
      <AddShoeDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </Card>
  );
}

/** Compact shoe picker for the activity form. */
export function ShoePicker({
  value,
  onChange,
  applyDefault = false,
}: {
  value: string | null;
  onChange: (shoeId: string | null) => void;
  /** When true (new activities), pre-select the runner's default shoe. */
  applyDefault?: boolean;
}) {
  const shoesQuery = useQuery({
    queryKey: ["myShoes"],
    queryFn: () => api.myShoes(),
  });
  const active = (shoesQuery.data?.shoes ?? []).filter((s) => !s.retired);
  const defaultShoe = active.find((s) => s.isDefault) ?? null;
  useEffect(() => {
    if (applyDefault && value === null && defaultShoe) {
      onChange(defaultShoe.id);
    }
    // Only auto-apply once when the shoe list first loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyDefault, defaultShoe?.id]);
  if (active.length === 0) return null;
  return (
    <div>
      <label className="mb-1 block text-[13px] font-bold text-mist">Shoes</label>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="min-h-[48px] w-full rounded-xl border border-white/15 bg-ink-900 px-3 text-[15px] text-ink-50"
      >
        <option value="">No shoes</option>
        {active.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.isDefault ? " (default)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
