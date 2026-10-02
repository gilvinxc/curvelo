import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  GUARDIAN_RELATIONSHIPS,
  type GuardianLinkDTO,
} from "@curvelo/shared";
import { ApiError, api } from "../../lib/api";
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  Modal,
  Select,
  TextInput,
  formatDate,
} from "../../components/ui";
import { cn } from "../../components/cx";

function relationshipLabel(relationship: string): string {
  return relationship.charAt(0).toUpperCase() + relationship.slice(1);
}

function consentLabel(type: string): string {
  return type
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

function GuardianRow({
  guardian,
  onRevoke,
  revoking,
}: {
  guardian: GuardianLinkDTO;
  onRevoke: () => void;
  revoking: boolean;
}) {
  const verified = guardian.status === "VERIFIED";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-ink-800 p-3.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-extrabold">
          {guardian.guardianName}
        </p>
        <p className="mt-0.5 truncate text-[13px] text-mist">
          {guardian.guardianEmail}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-ink-50">
            {relationshipLabel(guardian.relationship)}
          </span>
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider",
              verified
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                : "border-amber-400/30 bg-amber-400/10 text-amber-300",
            )}
          >
            {verified ? "Verified" : "Pending"}
          </span>
        </div>
        {verified && guardian.verifiedAt && (
          <p className="mt-1 text-[12px] text-mist">
            Verified {formatDate(guardian.verifiedAt)}
          </p>
        )}
      </div>
      <Button
        variant="secondary"
        className="shrink-0 px-3 text-[13px]"
        disabled={revoking}
        onClick={onRevoke}
      >
        Revoke
      </Button>
    </div>
  );
}

export function AthleteGuardians({
  teamId,
  athleteId,
  athleteName,
}: {
  teamId: string;
  athleteId: string;
  athleteName: string;
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [relationship, setRelationship] =
    useState<(typeof GUARDIAN_RELATIONSHIPS)[number]>("parent");
  const [formError, setFormError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<GuardianLinkDTO | null>(null);

  const guardiansQuery = useQuery({
    queryKey: ["athlete-guardians", teamId, athleteId],
    queryFn: () => api.getAthleteGuardians(teamId, athleteId),
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({
      queryKey: ["athlete-guardians", teamId, athleteId],
    });

  const invite = useMutation({
    mutationFn: (input: {
      email: string;
      relationship: (typeof GUARDIAN_RELATIONSHIPS)[number];
    }) => api.inviteGuardian(teamId, athleteId, input),
    onSuccess: ({ invite: created }) => {
      setEmail("");
      setFormError(null);
      setCopied(false);
      if (created.token) {
        setInviteUrl(
          `${window.location.origin}/guardian-invite/${created.token}`,
        );
      } else {
        setInviteUrl(null);
        invalidate();
      }
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setFormError(
            "There's already an active guardian link or a pending invitation for that email.",
          );
        } else if (err.status === 422) {
          setFormError(err.message);
        } else {
          setFormError(err.message);
        }
      } else {
        setFormError("Couldn't send the invitation.");
      }
    },
  });

  const revoke = useMutation({
    mutationFn: (linkId: string) => api.revokeGuardianLink(linkId),
    onSuccess: () => {
      setRevokeTarget(null);
      invalidate();
    },
    onError: (err) => {
      setFormError(
        err instanceof ApiError ? err.message : "Couldn't revoke the link.",
      );
      setRevokeTarget(null);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setInviteUrl(null);
    invite.mutate({ email: email.trim(), relationship });
  };

  const guardians = guardiansQuery.data?.guardians ?? [];
  const consents = guardiansQuery.data?.consents ?? [];

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
        Guardians
      </h2>

      {guardiansQuery.isError && (
        <ErrorBanner message="Couldn't load guardians for this athlete." />
      )}

      {guardians.length === 0 && !guardiansQuery.isLoading ? (
        <p className="text-[14px] text-mist">
          No guardians linked yet. Invite one below to give a parent visibility
          into {athleteName.split(" ")[0]}'s training.
        </p>
      ) : (
        <div className="mb-4 flex flex-col gap-2">
          {guardians.map((g) => (
            <GuardianRow
              key={g.id}
              guardian={g}
              revoking={revoke.isPending}
              onRevoke={() => setRevokeTarget(g)}
            />
          ))}
        </div>
      )}

      {consents.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 text-[12px] font-bold uppercase tracking-[0.14em] text-mist">
            Consents
          </h3>
          <div className="flex flex-col gap-1.5">
            {consents.map((c, i) => (
              <div
                key={`${c.type}-${i}`}
                className="flex items-center justify-between rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-[13px]"
              >
                <span className="font-semibold">
                  {consentLabel(c.type)}
                  <span className="font-normal text-mist">
                    {" "}
                    · by {c.guardianName}
                  </span>
                </span>
                <span
                  className={cn(
                    "text-[11px] font-bold uppercase tracking-wider",
                    c.status === "GRANTED"
                      ? "text-emerald-300"
                      : "text-amber-300",
                  )}
                >
                  {c.status === "GRANTED"
                    ? `Granted ${formatDate(c.grantedAt)}`
                    : c.status.toLowerCase()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Card>
        <h3 className="text-[15px] font-extrabold tracking-tight">
          Invite a guardian
        </h3>
        {formError && (
          <div className="mt-3">
            <ErrorBanner message={formError} />
          </div>
        )}
        <form onSubmit={submit} className="mt-3 flex flex-col gap-3">
          <Field label="Email">
            <TextInput
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="parent@example.com"
            />
          </Field>
          <Field label="Relationship">
            <Select
              value={relationship}
              onChange={(e) =>
                setRelationship(
                  e.target.value as (typeof GUARDIAN_RELATIONSHIPS)[number],
                )
              }
            >
              {GUARDIAN_RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>
                  {relationshipLabel(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" loading={invite.isPending} className="w-full">
            Send invitation
          </Button>
        </form>

        {inviteUrl && (
          <div className="mt-4 rounded-xl border border-volt-400/30 bg-volt-400/10 p-3.5">
            <p className="text-[13px] font-bold text-volt-300">
              Invitation sent
            </p>
            <p className="mt-1 text-[13px] text-mist">
              Share this link with the guardian — it expires in 72 hours:
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-black/40 px-2.5 py-2 text-[12px] text-ink-50">
                {inviteUrl}
              </code>
              <Button
                variant="secondary"
                className="shrink-0 px-3 text-[13px]"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(inviteUrl)
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false));
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Modal
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        title="Revoke guardian access"
      >
        <p className="text-[14px] text-mist">
          Remove{" "}
          <strong className="text-ink-50">
            {revokeTarget?.guardianName}
          </strong>{" "}
          as a guardian of {athleteName}? They'll lose visibility into their
          training and feed activity.
        </p>
        <div className="mt-5 flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => setRevokeTarget(null)}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            loading={revoke.isPending}
            onClick={() => revokeTarget && revoke.mutate(revokeTarget.id)}
          >
            Revoke
          </Button>
        </div>
      </Modal>
    </section>
  );
}
