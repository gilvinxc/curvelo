import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PostDTO } from "@curvelo/shared";
import { api, ApiError } from "../../lib/api";
import { Button, ErrorBanner, Modal, Spinner } from "../../components/ui";
import { MentionTextarea } from "../../components/MentionTextarea";
import { PhotoPicker } from "../photos/PhotoPicker";
import { PhotoImg } from "../../components/PhotoImg";

type ConsentCheck = { athleteId: string; displayName: string; hasConsent: boolean };

/**
 * Photo-only composer for PARENT members. Parents share photos to the team
 * feed: pick approved photos, tag who's pictured, and the per-share photo
 * consent gate runs on publish. A 🍀 reaction is one tap away on race posts.
 */
export function PhotoShareComposer({
  teamId,
  onPosted,
}: {
  teamId: string;
  onPosted: (post: PostDTO) => void;
}) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pictured, setPictured] = useState<string[]>([]);
  const [grantFor, setGrantFor] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const rosterQuery = useQuery({
    queryKey: ["roster", teamId],
    queryFn: () => api.getRoster(teamId),
  });
  const childrenQuery = useQuery({
    queryKey: ["children"],
    queryFn: () => api.myChildren(),
  });
  const roster = (rosterQuery.data?.roster ?? []).filter((m) => m.role !== "PARENT");
  const myKidIds = new Set(
    (childrenQuery.data?.children ?? []).map((c) => c.athleteId),
  );

  const consentQuery = useQuery({
    queryKey: ["photo-consent-status", teamId, pictured],
    queryFn: () => api.teamPhotoConsentStatus(teamId, pictured),
    enabled: pictured.length > 0,
  });
  const checks: ConsentCheck[] = consentQuery.data?.checks ?? [];
  const missing = checks.filter((c) => !c.hasConsent);
  const missingOthers = missing.filter((c) => !myKidIds.has(c.athleteId));
  const missingMine = missing.filter((c) => myKidIds.has(c.athleteId));
  const blocked = missingOthers.length > 0;

  // Drop grants for athletes no longer missing/tagged.
  useEffect(() => {
    setGrantFor((prev) => prev.filter((id) => missingMine.some((m) => m.athleteId === id)));
  }, [pictured.join(","), checks.map((c) => c.athleteId + c.hasConsent).join(",")]);

  function togglePictured(id: string) {
    setPictured((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const canPost = photoIds.length > 0 && !blocked;

  const postMutation = useMutation({
    mutationFn: () =>
      api.createPost(teamId, {
        body: body.trim() || undefined,
        photoIds,
        picturedAthleteIds: pictured.length > 0 ? pictured : undefined,
        grantPhotoConsentFor: grantFor.length > 0 ? grantFor : undefined,
      }),
    onSuccess: (data) => {
      setBody("");
      setPhotoIds([]);
      setPictured([]);
      setGrantFor([]);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["feed", teamId] });
      onPosted(data.post);
    },
    onError: (err) => {
      setError(
        err instanceof ApiError ? err.message : "Couldn't share. Try again.",
      );
    },
  });

  return (
    <div className="rounded-2xl border border-white/10 bg-ink-900 p-4 shadow-card">
      <p className="mb-3 text-[13px] font-bold uppercase tracking-[0.14em] text-mist">
        Share photos with the team
      </p>
      <MentionTextarea
        teamId={teamId}
        value={body}
        onChange={setBody}
        placeholder="Say something about the photos… (optional)"
        rows={2}
      />

      {photoIds.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {photoIds.map((id) => (
            <div key={id} className="relative">
              <PhotoImg photoId={id} alt="Attached photo" className="aspect-square w-full rounded-xl object-cover" />
              <button
                type="button"
                aria-label="Remove photo"
                onClick={() => setPhotoIds((ids) => ids.filter((x) => x !== id))}
                className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3">
        <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.14em] text-mist">
          Who's in these photos?
        </p>
        {rosterQuery.isLoading ? (
          <Spinner />
        ) : (
          <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
            {roster.map((m) => {
              const on = pictured.includes(m.userId);
              return (
                <button
                  key={m.userId}
                  type="button"
                  onClick={() => togglePictured(m.userId)}
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
        )}
      </div>

      {pictured.length > 0 && (
        <div className="mt-3 space-y-2">
          {consentQuery.isLoading && <Spinner />}
          {missingMine.map((c) => (
            <label
              key={c.athleteId}
              className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border border-amber-400/25 bg-amber-400/10 p-3 text-[13px]"
            >
              <input
                type="checkbox"
                checked={grantFor.includes(c.athleteId)}
                onChange={(e) =>
                  setGrantFor((prev) =>
                    e.target.checked
                      ? [...prev, c.athleteId]
                      : prev.filter((x) => x !== c.athleteId),
                  )
                }
                className="h-5 w-5 accent-amber-400"
              />
              <span>
                <span className="font-bold">{c.displayName}</span> doesn't have photo
                consent yet. Check to allow team photo sharing for them.
              </span>
            </label>
          ))}
          {missingOthers.length > 0 && (
            <div className="rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-[13px] text-red-200">
              Can't share yet — photo consent is missing for{" "}
              {missingOthers.map((c) => c.displayName).join(", ")}. Their guardian
              needs to grant it first.
            </div>
          )}
          {missing.length === 0 && !consentQuery.isLoading && (
            <p className="text-[13px] font-semibold text-emerald-300">
              ✓ Photo consent is in place for everyone pictured.
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="mt-3">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => setPickerOpen(true)}
          className="min-h-[44px] px-4 text-[14px]"
        >
          Photos
        </Button>
        <Button
          type="button"
          disabled={!canPost}
          loading={postMutation.isPending}
          onClick={() => postMutation.mutate()}
          className="min-h-[44px] px-6 text-[14px]"
        >
          Share
        </Button>
      </div>
      <p className="mt-2 text-[12px] text-mist">
        New uploads? Add them on the Photos tab first — a coach reviews them, then
        you can share them here.
      </p>

      <PhotoPicker
        teamId={teamId}
        open={pickerOpen}
        selected={photoIds}
        max={5}
        onClose={() => setPickerOpen(false)}
        onDone={setPhotoIds}
      />
    </div>
  );
}

/** Upload dialog with "who's pictured" tagging. Used on the Photos tab. */
export function PhotoUploadDialog({
  teamId,
  onClose,
  onDone,
  onError,
}: {
  teamId: string;
  onClose: () => void;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [caption, setCaption] = useState("");
  const [pictured, setPictured] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const rosterQuery = useQuery({
    queryKey: ["roster", teamId],
    queryFn: () => api.getRoster(teamId),
  });
  const roster = (rosterQuery.data?.roster ?? []).filter((m) => m.role !== "PARENT");

  async function submit() {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (caption.trim()) form.append("caption", caption.trim());
      if (pictured.length > 0) form.append("picturedAthleteIds", JSON.stringify(pictured));
      await api.uploadPhoto(teamId, form);
      onDone();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Upload failed. Try again.");
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
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="w-full text-[14px]"
        />
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Caption (optional)"
          maxLength={200}
          className="min-h-[44px] w-full rounded-xl border border-white/10 bg-ink-900 px-3 text-[14px]"
        />
        <div>
          <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.14em] text-mist">
            Who's in this photo?
          </p>
          <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
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
          <p className="mt-2 text-[12px] text-mist">
            Every pictured athlete under 18 needs photo consent from their guardian
            before the photo can be shared.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!file || uploading} loading={uploading} onClick={submit}>
            Upload
          </Button>
        </div>
      </div>
    </Modal>
  );
}
