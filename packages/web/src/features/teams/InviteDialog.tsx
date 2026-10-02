import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { INVITABLE_ROLES, type TeamRole } from "@curvelo/shared";
import { ApiError, api } from "../../lib/api";
import {
  Button,
  CopyButton,
  ErrorBanner,
  Field,
  Modal,
  RoleBadge,
  Select,
  TextInput,
} from "../../components/ui";

export function InviteDialog({
  teamId,
  teamName,
  open,
  onClose,
}: {
  teamId: string;
  teamName: string;
  open: boolean;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("RUNNER");
  const [error, setError] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: () => api.createInvitation(teamId, { email: email.trim(), role }),
    onError: (err) => {
      setError(
        err instanceof ApiError ? err.message : "Couldn't send the invitation.",
      );
    },
  });

  const reset = () => {
    setEmail("");
    setRole("RUNNER");
    setError(null);
    invite.reset();
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    invite.mutate();
  };

  const token = invite.data?.invitation.token;
  const inviteLink = token ? `${window.location.origin}/invite/${token}` : "";

  return (
    <Modal open={open} onClose={close} title={`Invite to ${teamName}`}>
      {token ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-volt-400/30 bg-volt-400/10 p-4">
            <p className="text-[13px] font-bold uppercase tracking-wider text-volt-300">
              Invitation ready
            </p>
            <p className="mt-1 text-[14px] text-ink-50">
              Share this link with <strong>{invite.data?.invitation.email}</strong>.
              It expires in 72 hours and can only be used once.
            </p>
          </div>
          <div className="break-all rounded-xl border border-white/10 bg-ink-800 p-3 font-mono text-[13px] text-mist">
            {inviteLink}
          </div>
          <div className="flex gap-2">
            <CopyButton text={inviteLink} label="Copy invite link" />
            <Button variant="secondary" onClick={close} className="flex-1">
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          {error && <ErrorBanner message={error} />}
          <Field label="Email">
            <TextInput
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="athlete@example.com"
              autoFocus
            />
          </Field>
          <Field label="Role" hint="What should they be able to do on the team?">
            <Select
              value={role}
              onChange={(e) => setRole(e.target.value as TeamRole)}
            >
              {INVITABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.charAt(0) + r.slice(1).toLowerCase().replace("_", " ")}
                </option>
              ))}
            </Select>
          </Field>
          <div className="mt-1 flex items-center gap-2 text-[13px] text-mist">
            <span>They'll join as</span>
            <RoleBadge role={role} />
          </div>
          <Button type="submit" loading={invite.isPending} className="w-full">
            Create invitation
          </Button>
        </form>
      )}
    </Modal>
  );
}
