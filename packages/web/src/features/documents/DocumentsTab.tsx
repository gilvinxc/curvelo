import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AthleteDocumentStatus,
  DocumentDTO,
  DocumentRequirementDTO,
} from "@curvelo/shared";
import { api, ApiError } from "../../lib/api";
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  FullScreenLoader,
  Modal,
  TextInput,
} from "../../components/ui";

export const KIND_LABELS: Record<string, string> = {
  PHYSICAL: "Physical",
  CONCUSSION: "Concussion acknowledgment",
  WAIVER: "Waiver",
  BIRTH_CERTIFICATE: "Birth certificate",
  CERTIFICATION: "Certification",
  BACKGROUND_CHECK: "Background check",
  TEAM_DOC: "Team document",
  OTHER: "Other",
};

const ATHLETE_KINDS = ["PHYSICAL", "CONCUSSION", "WAIVER", "BIRTH_CERTIFICATE", "OTHER"];
const REQUIREABLE = [
  { kind: "PHYSICAL", label: "Annual physical", validDays: 365 },
  { kind: "CONCUSSION", label: "Concussion acknowledgment", validDays: 365 },
  { kind: "WAIVER", label: "Season waiver", validDays: 365 },
  { kind: "BIRTH_CERTIFICATE", label: "Birth certificate (age verification)" },
];

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

function statusColor(s: string): string {
  switch (s) {
    case "current":
      return "text-emerald-300";
    case "expiring":
      return "text-amber-300";
    case "expired":
      return "text-red-300";
    default:
      return "text-mist";
  }
}

function DocRow({
  doc,
  onDeleted,
  showOwner,
  canVerify,
}: {
  doc: DocumentDTO;
  onDeleted?: () => void;
  showOwner?: boolean;
  canVerify?: boolean;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [signName, setSignName] = useState("");
  const [signIntent, setSignIntent] = useState(false);
  const [signing, setSigning] = useState(false);

  const del = useMutation({
    mutationFn: () => api.deleteDocument(doc.id, reason.trim() || "No reason given"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      onDeleted?.();
    },
  });
  const verify = useMutation({
    mutationFn: () => api.verifyDocument(doc.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents"] }),
  });
  const sign = useMutation({
    mutationFn: () => api.signDocument(doc.id, signName.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      setSigning(false);
    },
  });

  return (
    <li className="py-2.5">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-bold text-ink-50">
            {doc.label}
          </span>
          <span className="block text-[12px] text-mist">
            {kindLabel(doc.kind)}
            {showOwner && doc.ownerName ? ` · ${doc.ownerName}` : ""} ·{" "}
            {doc.fileName} · {(doc.sizeBytes / 1024).toFixed(0)} KB
            {doc.expiresAt
              ? ` · expires ${new Date(doc.expiresAt).toLocaleDateString()}`
              : ""}
            {doc.verifiedAt ? " · ✓ verified" : ""}
            {doc.signedAt ? ` · signed by ${doc.signedByName}` : ""}
            {doc.checkResult ? ` · ${doc.checkResult}` : ""}
          </span>
        </span>
        <a
          href={api.documentFileUrl(doc.id)}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-[13px] font-bold text-volt-300"
        >
          Open
        </a>
        {canVerify && !doc.verifiedAt && (
          <button
            type="button"
            onClick={() => verify.mutate()}
            disabled={verify.isPending}
            className="shrink-0 text-[13px] font-bold text-emerald-300"
          >
            {verify.isPending ? "…" : "Verify"}
          </button>
        )}
        {(doc.kind === "WAIVER" || doc.kind === "CONCUSSION") && !doc.signedAt && (
          <button
            type="button"
            onClick={() => setSigning(true)}
            className="shrink-0 text-[13px] font-bold text-volt-300"
          >
            Sign
          </button>
        )}
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="shrink-0 text-[13px] font-semibold text-mist hover:text-red-300"
        >
          Delete
        </button>
      </div>

      {signing && (
        <form
          className="mt-2 flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (signName.trim() && signIntent) sign.mutate();
          }}
        >
          <p className="text-[13px] font-bold text-ink-50">
            Sign “{doc.label}”
          </p>
          <TextInput
            value={signName}
            onChange={(e) => setSignName(e.target.value)}
            placeholder="Full legal name"
            aria-label="Full legal name"
          />
          <label className="flex items-start gap-2 text-[13px] text-mist">
            <input
              type="checkbox"
              checked={signIntent}
              onChange={(e) => setSignIntent(e.target.checked)}
              className="mt-0.5 h-5 w-5 accent-lime-400"
            />
            I intend to sign this document electronically and agree to do
            business electronically.
          </label>
          {sign.isError && (
            <ErrorBanner
              message={
                sign.error instanceof ApiError
                  ? sign.error.message
                  : "Couldn't sign."
              }
            />
          )}
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={sign.isPending || !signName.trim() || !signIntent}
              className="min-h-[44px] px-4 text-[13px]"
            >
              {sign.isPending ? "Signing…" : "Sign document"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setSigning(false)}
              className="min-h-[44px] px-4 text-[13px]"
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {confirming && (
        <div className="mt-2 rounded-xl border border-white/10 bg-white/5 p-3">
          <p className="mb-2 text-[13px] text-mist">
            Delete “{doc.label}”? This is audit-logged.
          </p>
          <div className="flex gap-2">
            <TextInput
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (required)"
              aria-label="Reason for deletion"
            />
            <Button
              onClick={() => del.mutate()}
              disabled={del.isPending || !reason.trim()}
              className="min-h-[44px] shrink-0 px-4 text-[13px]"
            >
              {del.isPending ? "…" : "Delete"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setConfirming(false)}
              className="min-h-[44px] shrink-0 px-4 text-[13px]"
            >
              Keep
            </Button>
          </div>
          {del.isError && (
            <ErrorBanner
              message={
                del.error instanceof ApiError
                  ? del.error.message
                  : "Couldn't delete."
              }
            />
          )}
        </div>
      )}
    </li>
  );
}

function UploadForm({
  teamId,
  kinds,
  requirements,
  onDone,
  teamDocMode,
  ownerId,
}: {
  teamId: string;
  kinds: string[];
  requirements: DocumentRequirementDTO[];
  onDone: () => void;
  teamDocMode?: boolean;
  ownerId?: string;
}) {
  const [kind, setKind] = useState(kinds[0] ?? "OTHER");
  const [label, setLabel] = useState("");
  const [requirementId, setRequirementId] = useState("");
  const [issuedAt, setIssuedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [visibility, setVisibility] = useState("TEAM");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError("Choose a file to upload.");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("teamId", teamId);
      form.append("kind", teamDocMode ? "TEAM_DOC" : kind);
      form.append("label", label.trim() || file.name);
      if (ownerId) form.append("ownerId", ownerId);
      if (requirementId) form.append("requirementId", requirementId);
      if (issuedAt) form.append("issuedAt", new Date(issuedAt).toISOString());
      if (expiresAt) form.append("expiresAt", new Date(expiresAt).toISOString());
      if (teamDocMode) form.append("visibility", visibility);
      form.append("file", file, file.name);
      await api.uploadDocument(form);
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Upload failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {error && <ErrorBanner message={error} />}
      {!teamDocMode && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="min-h-[48px] w-full rounded-xl border border-white/15 bg-ink-900 px-3 text-[15px] text-ink-50"
            >
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Checklist item (optional)">
            <select
              value={requirementId}
              onChange={(e) => setRequirementId(e.target.value)}
              className="min-h-[48px] w-full rounded-xl border border-white/15 bg-ink-900 px-3 text-[15px] text-ink-50"
            >
              <option value="">—</option>
              {requirements
                .filter((r) => r.kind === kind)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
            </select>
          </Field>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Label">
          <TextInput
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={teamDocMode ? "Team handbook" : "e.g. 2026 physical"}
            maxLength={80}
          />
        </Field>
        {teamDocMode ? (
          <Field label="Visible to">
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
              className="min-h-[48px] w-full rounded-xl border border-white/15 bg-ink-900 px-3 text-[15px] text-ink-50"
            >
              <option value="TEAM">Whole team</option>
              <option value="COACH_ONLY">Coaches only</option>
            </select>
          </Field>
        ) : (
          <Field label="Issued date">
            <TextInput
              type="date"
              value={issuedAt}
              onChange={(e) => setIssuedAt(e.target.value)}
            />
          </Field>
        )}
      </div>
      {!teamDocMode && (
        <Field label="Expires (leave blank to use checklist window)">
          <TextInput
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </Field>
      )}
      <Field label="File (PDF or image, 10 MB max)">
        <input
          type="file"
          accept="application/pdf,image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="w-full text-[14px] text-mist file:mr-3 file:rounded-lg file:border-0 file:bg-volt-400 file:px-4 file:py-2 file:text-[14px] file:font-bold file:text-ink-950"
        />
      </Field>
      <Button type="submit" disabled={busy} className="min-h-[48px]">
        {busy ? "Uploading…" : "Upload document"}
      </Button>
    </form>
  );
}

function MyDocumentsSection({ teamId }: { teamId: string }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const reqs = useQuery({
    queryKey: ["documents", "requirements", teamId],
    queryFn: () => api.documentRequirements(teamId),
  });
  const docs = useQuery({
    queryKey: ["documents", "mine", teamId],
    queryFn: () => api.myDocuments(teamId),
  });

  return (
    <Card className="mb-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[16px] font-extrabold text-ink-50">My documents</h3>
        <Button
          variant="secondary"
          onClick={() => setOpen(true)}
          className="min-h-[44px] px-4 text-[13px]"
        >
          + Upload
        </Button>
      </div>
      {docs.isLoading ? (
        <FullScreenLoader />
      ) : docs.isError ? (
        <ErrorBanner message="Couldn't load your documents." />
      ) : docs.data!.documents.length === 0 ? (
        <p className="text-[13px] text-mist">
          Physicals, waivers, concussion forms, and birth certificates you
          upload appear here.
        </p>
      ) : (
        <ul className="divide-y divide-white/5">
          {docs.data!.documents.map((d) => (
            <DocRow key={d.id} doc={d} />
          ))}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Upload document">
        <UploadForm
          teamId={teamId}
          kinds={ATHLETE_KINDS}
          requirements={reqs.data?.requirements ?? []}
          onDone={() => {
            queryClient.invalidateQueries({ queryKey: ["documents"] });
            setOpen(false);
          }}
        />
      </Modal>
    </Card>
  );
}

function TeamDocsSection({
  teamId,
  isCoach,
}: {
  teamId: string;
  isCoach: boolean;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const docs = useQuery({
    queryKey: ["documents", "team", teamId],
    queryFn: () => api.teamDocuments(teamId),
  });

  return (
    <Card className="mb-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[16px] font-extrabold text-ink-50">Team documents</h3>
        {isCoach && (
          <Button
            variant="secondary"
            onClick={() => setOpen(true)}
            className="min-h-[44px] px-4 text-[13px]"
          >
            + Upload
          </Button>
        )}
      </div>
      {docs.isLoading ? (
        <FullScreenLoader />
      ) : docs.isError ? (
        <ErrorBanner message="Couldn't load team documents." />
      ) : docs.data!.documents.length === 0 ? (
        <p className="text-[13px] text-mist">
          Handbooks, schedules, and meet information will appear here.
        </p>
      ) : (
        <ul className="divide-y divide-white/5">
          {docs.data!.documents.map((d) => (
            <DocRow
              key={d.id}
              doc={d}
              showOwner
              canVerify={false}
            />
          ))}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Upload team document">
        <UploadForm
          teamId={teamId}
          kinds={["TEAM_DOC"]}
          requirements={[]}
          teamDocMode
          onDone={() => {
            queryClient.invalidateQueries({ queryKey: ["documents"] });
            setOpen(false);
          }}
        />
      </Modal>
    </Card>
  );
}

function RequirementsManager({ teamId }: { teamId: string }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState("PHYSICAL");
  const [label, setLabel] = useState("");
  const [validDays, setValidDays] = useState("365");
  const reqs = useQuery({
    queryKey: ["documents", "requirements", teamId],
    queryFn: () => api.documentRequirements(teamId),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["documents"] });

  const save = useMutation({
    mutationFn: () =>
      api.upsertRequirement(teamId, {
        kind,
        label: label.trim() || REQUIREABLE.find((r) => r.kind === kind)?.label || kind,
        validDays: validDays.trim() === "" ? undefined : parseInt(validDays, 10),
        required: true,
      }),
    onSuccess: () => {
      setLabel("");
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteRequirement(teamId, id),
    onSuccess: refresh,
  });

  return (
    <Card className="mb-5">
      <h3 className="mb-3 text-[16px] font-extrabold text-ink-50">
        Required paperwork
      </h3>
      {reqs.isLoading ? (
        <FullScreenLoader />
      ) : (
        <ul className="mb-4 divide-y divide-white/5">
          {(reqs.data?.requirements ?? []).map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1 text-[14px] text-ink-50">
                <span className="font-bold">{r.label}</span>{" "}
                <span className="text-mist">
                  ({kindLabel(r.kind)}
                  {r.validDays ? `, valid ${r.validDays} days` : ", no expiry"})
                </span>
              </span>
              <button
                type="button"
                onClick={() => remove.mutate(r.id)}
                className="shrink-0 text-[13px] font-semibold text-mist hover:text-red-300"
              >
                Remove
              </button>
            </li>
          ))}
          {(reqs.data?.requirements ?? []).length === 0 && (
            <p className="py-2 text-[13px] text-mist">
              No requirements yet. Add the paperwork every athlete needs.
            </p>
          )}
        </ul>
      )}
      <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                const preset = REQUIREABLE.find((r) => r.kind === e.target.value);
                setValidDays(preset?.validDays ? String(preset.validDays) : "");
              }}
              className="min-h-[48px] w-full rounded-xl border border-white/15 bg-ink-900 px-3 text-[15px] text-ink-50"
            >
              {REQUIREABLE.map((r) => (
                <option key={r.kind} value={r.kind}>
                  {kindLabel(r.kind)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Valid for (days, blank = no expiry)">
            <TextInput
              value={validDays}
              onChange={(e) => setValidDays(e.target.value)}
              inputMode="numeric"
              placeholder="365"
            />
          </Field>
        </div>
        <Field label="Label">
          <TextInput
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={
              REQUIREABLE.find((r) => r.kind === kind)?.label ?? "Document name"
            }
            maxLength={80}
          />
        </Field>
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="min-h-[48px]"
        >
          {save.isPending ? "Saving…" : "Add requirement"}
        </Button>
        {save.isError && (
          <ErrorBanner
            message={
              save.error instanceof ApiError
                ? save.error.message
                : "Couldn't save."
            }
          />
        )}
      </div>
    </Card>
  );
}

function StatusBoard({ teamId }: { teamId: string }) {
  const q = useQuery({
    queryKey: ["documents", "status", teamId],
    queryFn: () => api.documentStatus(teamId),
  });

  const badge = (a: AthleteDocumentStatus) =>
    a.cleared ? (
      <span className="rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">
        CLEARED
      </span>
    ) : (
      <span className="rounded-full bg-amber-400/15 px-2.5 py-0.5 text-[11px] font-bold text-amber-300">
        MISSING
      </span>
    );

  return (
    <Card className="mb-5">
      <h3 className="mb-3 text-[16px] font-extrabold text-ink-50">
        Paperwork status
      </h3>
      {q.isLoading ? (
        <FullScreenLoader />
      ) : q.isError ? (
        <ErrorBanner message="Couldn't load the status board." />
      ) : q.data!.athletes.length === 0 ? (
        <p className="text-[13px] text-mist">No runners on this team yet.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {q.data!.athletes.map((a) => (
            <li key={a.userId} className="py-2.5">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[14px] font-bold text-ink-50">
                  {a.displayName}
                </span>
                {badge(a)}
              </div>
              {a.requirements.length === 0 ? (
                <p className="text-[12px] text-mist">
                  No required paperwork defined.
                </p>
              ) : (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {a.requirements.map((r) => (
                    <span
                      key={r.requirementId}
                      className={`text-[12px] font-semibold ${statusColor(r.status)}`}
                      title={
                        r.expiresAt
                          ? `Expires ${new Date(r.expiresAt).toLocaleDateString()}`
                          : undefined
                      }
                    >
                      {r.label}: {r.status}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CertificationsSection({ teamId }: { teamId: string }) {
  const [open, setOpen] = useState(false);
  const [bgOpen, setBgOpen] = useState(false);
  const [provider, setProvider] = useState("");
  const [result, setResult] = useState("PASS");
  const queryClient = useQueryClient();
  const docs = useQuery({
    queryKey: ["documents", "certs"],
    queryFn: () => api.myCertifications(),
  });
  const bg = useMutation({
    mutationFn: () =>
      api.recordBackgroundCheck({ checkResult: result as "PASS" | "FAIL", checkProvider: provider.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      setBgOpen(false);
      setProvider("");
    },
  });

  return (
    <Card className="mb-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[16px] font-extrabold text-ink-50">
          My certifications
        </h3>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => setOpen(true)}
            className="min-h-[44px] px-4 text-[13px]"
          >
            + Certification
          </Button>
          <Button
            variant="secondary"
            onClick={() => setBgOpen(true)}
            className="min-h-[44px] px-4 text-[13px]"
          >
            + Background check
          </Button>
        </div>
      </div>
      <p className="mb-3 text-[12px] text-mist">
        CPR, SafeSport, licenses — plus background checks (pass/fail only, the
        report is never stored).
      </p>
      {docs.isLoading ? (
        <FullScreenLoader />
      ) : docs.isError ? (
        <ErrorBanner message="Couldn't load certifications." />
      ) : docs.data!.documents.length === 0 ? (
        <p className="text-[13px] text-mist">No certifications on file.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {docs.data!.documents.map((d) => (
            <DocRow key={d.id} doc={d} />
          ))}
        </ul>
      )}
      <Modal
        open={bgOpen}
        onClose={() => setBgOpen(false)}
        title="Record background check"
      >
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-mist">
            Record the outcome only — never upload or store the full report.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Provider">
              <TextInput
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                placeholder="Checkr"
                maxLength={80}
              />
            </Field>
            <Field label="Result">
              <select
                value={result}
                onChange={(e) => setResult(e.target.value)}
                className="min-h-[48px] w-full rounded-xl border border-white/15 bg-ink-900 px-3 text-[15px] text-ink-50"
              >
                <option value="PASS">Pass</option>
                <option value="FAIL">Fail</option>
              </select>
            </Field>
          </div>
          {bg.isError && (
            <ErrorBanner
              message={
                bg.error instanceof ApiError
                  ? bg.error.message
                  : "Couldn't save."
              }
            />
          )}
          <Button
            onClick={() => bg.mutate()}
            disabled={bg.isPending || !provider.trim()}
            className="min-h-[48px]"
          >
            {bg.isPending ? "Saving…" : "Record check"}
          </Button>
        </div>
      </Modal>
      <Modal open={open} onClose={() => setOpen(false)} title="Upload certification">
        <UploadForm
          teamId={teamId}
          kinds={["CERTIFICATION"]}
          requirements={[]}
          onDone={() => {
            queryClient.invalidateQueries({ queryKey: ["documents"] });
            setOpen(false);
          }}
        />
      </Modal>
    </Card>
  );
}

export function DocumentsTab({
  teamId,
  isCoach,
}: {
  teamId: string;
  isCoach: boolean;
}) {
  return (
    <div>
      {isCoach && <StatusBoard teamId={teamId} />}
      {isCoach && <RequirementsManager teamId={teamId} />}
      {!isCoach && <MyDocumentsSection teamId={teamId} />}
      <TeamDocsSection teamId={teamId} isCoach={isCoach} />
      {isCoach && <CertificationsSection teamId={teamId} />}
    </div>
  );
}

/** Guardian view: upload/list paperwork for one linked child. */
export function GuardianDocumentsSection({
  teamId,
  athleteId,
  athleteName,
}: {
  teamId: string;
  athleteId: string;
  athleteName: string;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();
  const reqs = useQuery({
    queryKey: ["documents", "requirements", teamId],
    queryFn: () => api.documentRequirements(teamId),
    enabled: expanded,
  });
  const docs = useQuery({
    queryKey: ["documents", "athlete", teamId, athleteId],
    queryFn: () => api.athleteDocuments(teamId, athleteId),
    enabled: expanded,
  });

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 text-[14px] font-semibold text-ink-50 transition hover:border-volt-400/40"
      >
        📄 Documents for {athleteName.split(" ")[0]}
        <span className="text-mist">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[13px] font-bold text-ink-50">
              Paperwork for {athleteName}
            </p>
            <Button
              variant="secondary"
              onClick={() => setOpen(true)}
              className="min-h-[40px] px-3 text-[12px]"
            >
              + Upload
            </Button>
          </div>
          {docs.isLoading ? (
            <FullScreenLoader />
          ) : docs.isError ? (
            <ErrorBanner message="Couldn't load documents." />
          ) : docs.data!.documents.length === 0 ? (
            <p className="text-[13px] text-mist">
              Nothing uploaded yet — physicals, waivers, and birth certificates
              go here.
            </p>
          ) : (
            <ul className="divide-y divide-white/5">
              {docs.data!.documents.map((d) => (
                <DocRow key={d.id} doc={d} />
              ))}
            </ul>
          )}
          <Modal
            open={open}
            onClose={() => setOpen(false)}
            title={`Upload for ${athleteName}`}
          >
            <UploadForm
              teamId={teamId}
              kinds={ATHLETE_KINDS}
              requirements={reqs.data?.requirements ?? []}
              ownerId={athleteId}
              onDone={() => {
                queryClient.invalidateQueries({ queryKey: ["documents"] });
                setOpen(false);
              }}
            />
          </Modal>
        </div>
      )}
    </div>
  );
}
