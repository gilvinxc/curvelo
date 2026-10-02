import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { Button, EmptyState, Modal, Spinner } from "../../components/ui";
import { PhotoImg } from "../../components/PhotoImg";

/** Pick approved team photos to attach to a post. */
export function PhotoPicker({
  teamId,
  open,
  selected,
  max,
  onClose,
  onDone,
}: {
  teamId: string;
  open: boolean;
  selected: string[];
  max: number;
  onClose: () => void;
  onDone: (ids: string[]) => void;
}) {
  const [ids, setIds] = useState<string[]>(selected);
  const { data, isLoading } = useQuery({
    queryKey: ["photos", teamId, "approved"],
    queryFn: () => api.listPhotos(teamId),
    enabled: open,
  });

  function toggle(id: string) {
    setIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= max
          ? prev
          : [...prev, id],
    );
  }

  const photos = data?.photos ?? [];

  return (
    <Modal open={open} onClose={onClose} title="Add photos">
      {isLoading ? (
        <Spinner />
      ) : photos.length === 0 ? (
        <EmptyState
          title="No approved photos yet"
          body="Upload photos on the Photos tab — a coach reviews them first."
        />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p) => {
              const on = ids.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p.id)}
                  className={`relative overflow-hidden rounded-xl border-2 ${
                    on ? "border-volt-400" : "border-transparent"
                  }`}
                  aria-pressed={on}
                >
                  <PhotoImg
                    photoId={p.id}
                    alt={p.caption ?? "Team photo"}
                    className="aspect-square w-full object-cover"
                  />
                  {on && (
                    <span className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-volt-400 text-[13px] font-bold text-ink-950">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                onDone(ids);
                onClose();
              }}
            >
              Add{ids.length > 0 ? ` (${ids.length})` : ""}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
