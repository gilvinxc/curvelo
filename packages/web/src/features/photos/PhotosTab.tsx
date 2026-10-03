import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";
import {
  Button,
  EmptyState,
  ErrorBanner,
  Field,
  Modal,
  Spinner,
  TextInput,
} from "../../components/ui";
import { PhotoImg } from "../../components/PhotoImg";

export function PhotosTab({
  teamId,
  isCoach,
}: {
  teamId: string;
  isCoach: boolean;
}) {
  const queryClient = useQueryClient();
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [albumOpen, setAlbumOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const albumsQuery = useQuery({
    queryKey: ["albums", teamId],
    queryFn: () => api.listAlbums(teamId),
  });
  const photosQuery = useQuery({
    queryKey: ["photos", teamId, albumId],
    queryFn: () =>
      api.listPhotos(teamId, {
        ...(albumId ? { albumId } : {}),
        ...(isCoach ? { includePending: true } : {}),
      }),
  });
  const pendingQuery = useQuery({
    queryKey: ["pending-photos", teamId],
    queryFn: () => api.pendingPhotos(teamId),
    enabled: isCoach,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["photos", teamId] });
    queryClient.invalidateQueries({ queryKey: ["albums", teamId] });
    queryClient.invalidateQueries({ queryKey: ["pending-photos", teamId] });
  };

  const pendingCount = pendingQuery.data?.photos.length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setUploadOpen(true)}>Upload photo</Button>
        {isCoach && (
          <>
            <Button variant="secondary" onClick={() => setAlbumOpen(true)}>
              New album
            </Button>
            <Button variant="secondary" onClick={() => setReviewOpen(true)}>
              Review queue{pendingCount > 0 ? ` (${pendingCount})` : ""}
            </Button>
          </>
        )}
      </div>
      {error && <ErrorBanner message={error} />}

      {/* Album picker */}
      <div>
        <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setAlbumId(null)}
            className={`shrink-0 rounded-full px-4 py-2 text-[14px] font-semibold ${
              albumId === null
                ? "bg-volt-400 text-ink-950"
                : "border border-white/10 bg-ink-900 text-white/70"
            }`}
          >
            All photos
          </button>
          {(albumsQuery.data?.albums ?? []).map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setAlbumId(a.id)}
              className={`shrink-0 rounded-full px-4 py-2 text-[14px] font-semibold ${
                albumId === a.id
                  ? "bg-volt-400 text-ink-950"
                  : "border border-white/10 bg-ink-900 text-white/70"
              }`}
            >
              {a.title} ({a.photoCount})
            </button>
          ))}
        </div>

        {photosQuery.isLoading ? (
          <Spinner />
        ) : (photosQuery.data?.photos.length ?? 0) === 0 ? (
          <EmptyState
            title="No photos yet"
            body="Upload the first one — a coach will review it before it goes live."
          />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {photosQuery.data!.photos.map((p) => (
              <PhotoCard
                key={p.id}
                photoId={p.id}
                caption={p.caption}
                status={p.status}
                uploaderName={p.uploaderName}
              />
            ))}
          </div>
        )}
      </div>

      {uploadOpen && (
        <UploadDialog
          teamId={teamId}
          albums={albumsQuery.data?.albums ?? []}
          defaultAlbumId={albumId}
          onClose={() => setUploadOpen(false)}
          onDone={() => {
            setUploadOpen(false);
            invalidate();
          }}
          onError={setError}
        />
      )}
      {albumOpen && (
        <NewAlbumDialog
          teamId={teamId}
          onClose={() => setAlbumOpen(false)}
          onDone={() => {
            setAlbumOpen(false);
            invalidate();
          }}
        />
      )}
      {reviewOpen && (
        <ReviewDialog
          teamId={teamId}
          onClose={() => setReviewOpen(false)}
          onDone={invalidate}
        />
      )}
    </div>
  );
}

function PhotoCard({
  photoId,
  caption,
  status,
  uploaderName,
}: {
  photoId: string;
  caption: string | null;
  status: string;
  uploaderName: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-white/10 bg-ink-900">
      <PhotoImg photoId={photoId} alt={caption ?? "Team photo"} className="aspect-square w-full object-cover" />
      {status === "PENDING" && (
        <span className="absolute left-2 top-2 rounded-full bg-amber-400/90 px-2 py-0.5 text-[11px] font-bold text-ink-950">
          In review
        </span>
      )}
      {(caption || uploaderName) && (
        <div className="px-2.5 py-1.5">
          {caption && <p className="truncate text-[13px] text-white/90">{caption}</p>}
          <p className="text-[11px] text-mist/60">{uploaderName}</p>
        </div>
      )}
    </div>
  );
}

function UploadDialog({
  teamId,
  albums,
  defaultAlbumId,
  onClose,
  onDone,
  onError,
}: {
  teamId: string;
  albums: { id: string; title: string }[];
  defaultAlbumId: string | null;
  onClose: () => void;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [caption, setCaption] = useState("");
  const [albumId, setAlbumId] = useState(defaultAlbumId ?? "");
  const [uploading, setUploading] = useState(false);
  const [pictured, setPictured] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const rosterQuery = useQuery({
    queryKey: ["roster", teamId],
    queryFn: () => api.getRoster(teamId),
  });
  const roster = (rosterQuery.data?.roster ?? []).filter((m) => m.role !== "PARENT");

  async function submit() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (caption.trim()) form.append("caption", caption.trim());
      if (albumId) form.append("albumId", albumId);
      if (pictured.length > 0) form.append("picturedAthleteIds", JSON.stringify(pictured));
      await api.uploadPhoto(teamId, form);
      onDone();
    } catch (err) {
      onError(
        err instanceof ApiError ? err.message : "Upload failed. Try again.",
      );
      setUploading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Upload photo">
      <div className="space-y-4">
        <p className="text-[14px] text-mist">
          Photos go to a coach for review before anyone else can see them.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="block w-full text-[14px] text-white/80 file:mr-3 file:rounded-xl file:border-0 file:bg-volt-400 file:px-4 file:py-2 file:text-[14px] file:font-bold file:text-ink-950"
        />
        <Field label="Caption" hint="Optional">
          <TextInput
            value={caption}
            maxLength={200}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Race day finish line…"
          />
        </Field>
        <Field label="Who's in this photo?" hint="Tag pictured athletes — minors need guardian photo consent before sharing">
          <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">
            {roster.map((m) => {
              const on = pictured.includes(m.userId);
              return (
                <button
                  key={m.userId}
                  type="button"
                  onClick={() =>
                    setPictured((prev) =>
                      prev.includes(m.userId)
                        ? prev.filter((x) => x !== m.userId)
                        : [...prev, m.userId],
                    )
                  }
                  aria-pressed={on}
                  className={`min-h-[36px] rounded-full border px-3 text-[13px] font-semibold transition ${
                    on
                      ? "border-volt-400 bg-volt-400/15 text-ink-50"
                      : "border-white/15 bg-white/5 text-mist hover:text-ink-50"
                  }`}
                >
                  {m.displayName}
                </button>
              );
            })}
          </div>
        </Field>
        {albums.length > 0 && (
          <Field label="Album" hint="Optional">
            <select
              value={albumId}
              onChange={(e) => setAlbumId(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-ink-800 px-4 py-3 text-[15px]"
            >
              <option value="">No album</option>
              {albums.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={uploading}>
            Upload
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function NewAlbumDialog({
  teamId,
  onClose,
  onDone,
}: {
  teamId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () =>
      api.createAlbum(teamId, {
        title: title.trim(),
        description: description.trim() || undefined,
      }),
    onSuccess: onDone,
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Couldn't create the album."),
  });

  return (
    <Modal open onClose={onClose} title="New album">
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}
        <Field label="Title">
          <TextInput
            value={title}
            maxLength={80}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="2026 Season"
            autoFocus
          />
        </Field>
        <Field label="Description" hint="Optional">
          <TextInput
            value={description}
            maxLength={500}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Races, practices, team events…"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!title.trim()}
          >
            Create album
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ReviewDialog({
  teamId,
  onClose,
  onDone,
}: {
  teamId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["pending-photos", teamId],
    queryFn: () => api.pendingPhotos(teamId),
  });
  const review = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      api.reviewPhoto(id, approve),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-photos", teamId] });
      onDone();
    },
  });

  const photos = data?.photos ?? [];

  return (
    <Modal open onClose={onClose} title="Review photos">
      {isLoading ? (
        <Spinner />
      ) : photos.length === 0 ? (
        <EmptyState title="All caught up" body="No photos waiting for review." />
      ) : (
        <div className="space-y-4">
          {photos.map((p) => (
            <div key={p.id} className="rounded-xl border border-white/10 p-3">
              <PhotoImg
                photoId={p.id}
                alt={p.caption ?? "Photo pending review"}
                className="max-h-64 w-full rounded-lg object-contain bg-black/30"
              />
              <p className="mt-2 text-[13px] text-mist">
                {p.uploaderName}
                {p.caption ? ` — ${p.caption}` : ""}
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  onClick={() => review.mutate({ id: p.id, approve: true })}
                  loading={review.isPending}
                  className="flex-1"
                >
                  Approve
                </Button>
                <Button
                  variant="danger"
                  onClick={() => review.mutate({ id: p.id, approve: false })}
                  loading={review.isPending}
                  className="flex-1"
                >
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
