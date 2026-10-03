import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CONSENT_TYPES } from "@curvelo/shared";
import { ApiError, api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import {
  Avatar,
  Button,
  Card,
  ErrorBanner,
  FullScreenLoader,
  Logo,
  formatDate,
} from "../../components/ui";
import { BRAND_NAME } from "../../brand";

const CONSENT_COPY: Record<string, { title: string; body: string }> = {
  PARTICIPATION: {
    title: "Participation consent",
    body: "I give permission for this athlete to participate in team activities.",
  },
  DATA_SHARING: {
    title: "Data sharing consent",
    body: "I consent to this athlete's training data being visible to the coaching staff.",
  },
};

function relationshipLabel(relationship: string): string {
  return relationship.charAt(0).toUpperCase() + relationship.slice(1);
}

function InviteHeadline({
  athleteName,
  teamName,
  relationship,
}: {
  athleteName: string;
  teamName: string;
  relationship: string;
}) {
  return (
    <p className="text-[15px] leading-relaxed text-ink-50">
      You've been invited to follow{" "}
      <strong className="font-extrabold">{athleteName}</strong> on{" "}
      <strong className="font-extrabold">{teamName}</strong> as their{" "}
      {relationshipLabel(relationship).toLowerCase()}.
    </p>
  );
}

export function GuardianInviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const { user, loading: authLoading, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [consents, setConsents] = useState<string[]>([]);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const previewQuery = useQuery({
    queryKey: ["guardian-invite", token],
    queryFn: () => api.previewGuardianInvite(token!),
    enabled: !!token,
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () =>
      api.acceptGuardianInvite(token!, { consents: consents as never }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["children"] });
      navigate("/family", { replace: true });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 403) {
        setAcceptError(
          "This invitation was sent to a different email address. Sign in with the account that received it.",
        );
      } else {
        setAcceptError(
          err instanceof ApiError
            ? err.message
            : "Couldn't accept the invitation.",
        );
      }
    },
  });

  if (authLoading || previewQuery.isLoading) return <FullScreenLoader />;

  const invite = previewQuery.data?.invite;

  let invalidTitle = "Invitation not found";
  let invalidBody =
    "This invite link is invalid. Ask the coach for a fresh one.";
  if (previewQuery.isError && previewQuery.error instanceof ApiError) {
    if (previewQuery.error.status === 410) {
      invalidTitle = "Invitation expired";
      invalidBody =
        "This invitation has expired. Ask the coach to send you a new one.";
    } else if (previewQuery.error.status === 409) {
      invalidTitle = "Invitation already used";
      invalidBody =
        "This invitation was already accepted or is no longer active. If you still need access, ask the coach for a new one.";
    }
  }

  const nextParam = encodeURIComponent(`/guardian-invite/${token}`);

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center">
      <div className="mb-8 flex justify-center">
        <Logo />
      </div>

      {previewQuery.isError || !invite || invite.status !== "PENDING" ? (
        <Card>
          <h1 className="text-xl font-black tracking-tight">{invalidTitle}</h1>
          <p className="mt-2 text-[14px] text-mist">{invalidBody}</p>
          <Link to="/dashboard" className="mt-5 block">
            <Button variant="secondary" className="w-full">
              Back to dashboard
            </Button>
          </Link>
        </Card>
      ) : !user ? (
        <Card>
          <div className="flex flex-col items-center text-center">
            <Avatar name={invite.athleteName} size="lg" />
            <p className="mt-4 text-[13px] font-bold uppercase tracking-[0.18em] text-volt-400">
              Guardian invitation
            </p>
            <div className="mt-2 w-full text-left">
              <InviteHeadline
                athleteName={invite.athleteName}
                teamName={invite.teamName}
                relationship={invite.relationship}
              />
            </div>
            <p className="mt-3 w-full text-left text-[13px] text-mist">
              Expires {formatDate(invite.expiresAt)}
            </p>
            <p className="mt-4 text-[14px] text-mist">
              Sign in or create a {BRAND_NAME} account to accept this invitation.
            </p>
            <div className="mt-5 flex w-full flex-col gap-2">
              <Link to={`/signin?next=${nextParam}`} className="w-full">
                <Button className="w-full">Sign in</Button>
              </Link>
              <Link
                to={`/register?next=${nextParam}&role=PARENT`}
                className="w-full"
              >
                <Button variant="secondary" className="w-full">
                  Create account
                </Button>
              </Link>
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="flex flex-col items-center text-center">
            <Avatar name={invite.athleteName} size="lg" />
            <p className="mt-4 text-[13px] font-bold uppercase tracking-[0.18em] text-volt-400">
              Guardian invitation
            </p>
            <div className="mt-2 w-full text-left">
              <InviteHeadline
                athleteName={invite.athleteName}
                teamName={invite.teamName}
                relationship={invite.relationship}
              />
            </div>
            <p className="mt-3 w-full text-left text-[13px] text-mist">
              Expires {formatDate(invite.expiresAt)}
            </p>
          </div>

          <fieldset className="mt-5">
            <legend className="text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
              Consents
            </legend>
            <div className="mt-2 flex flex-col gap-2">
              {CONSENT_TYPES.map((type) => {
                const copy = CONSENT_COPY[type];
                const checked = consents.includes(type);
                return (
                  <label
                    key={type}
                    className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-ink-800 p-3.5"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-5 w-5 shrink-0 accent-lime-400"
                      checked={checked}
                      onChange={() =>
                        setConsents((prev) =>
                          checked
                            ? prev.filter((c) => c !== type)
                            : [...prev, type],
                        )
                      }
                    />
                    <span>
                      <span className="block text-[14px] font-extrabold">
                        {copy.title}
                      </span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-mist">
                        {copy.body.replace(
                          "this athlete",
                          invite.athleteName,
                        )}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {acceptError && (
            <div className="mt-4">
              <ErrorBanner message={acceptError} />
            </div>
          )}

          <Button
            className="mt-5 w-full"
            loading={accept.isPending}
            onClick={() => {
              setAcceptError(null);
              accept.mutate();
            }}
          >
            Accept invitation
          </Button>
          <Button
            variant="secondary"
            className="mt-2 w-full"
            onClick={() => {
              void logout().then(() =>
                navigate(`/signin?next=${nextParam}`, { replace: true }),
              );
            }}
          >
            Sign in with a different account
          </Button>
        </Card>
      )}
    </div>
  );
}
