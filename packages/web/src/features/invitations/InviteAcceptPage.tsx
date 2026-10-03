import { useState } from "react";
import { BRAND_NAME } from "../../brand";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import {
  Button,
  Card,
  ErrorBanner,
  FullScreenLoader,
  Logo,
  RoleBadge,
  formatDate,
} from "../../components/ui";
import { TeamLogo } from "../teams/TeamLogo";

export function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const { user, loading: authLoading, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const previewQuery = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => api.previewInvitation(token!),
    enabled: !!token,
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () => api.acceptInvitation(token!),
    onSuccess: ({ teamId }) => {
      void queryClient.invalidateQueries({ queryKey: ["teams"] });
      void queryClient.invalidateQueries({ queryKey: ["team", teamId] });
      void queryClient.invalidateQueries({ queryKey: ["roster", teamId] });
      navigate(`/teams/${teamId}`, { replace: true });
    },
    onError: (err) => {
      setAcceptError(
        err instanceof ApiError ? err.message : "Couldn't accept the invitation.",
      );
    },
  });

  if (authLoading || previewQuery.isLoading) return <FullScreenLoader />;

  const invitation = previewQuery.data?.invitation;

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center">
      <div className="mb-8 flex justify-center">
        <Logo />
      </div>

      {previewQuery.isError || !invitation ? (
        <Card>
          <h1 className="text-xl font-black tracking-tight">
            Invitation not found
          </h1>
          <p className="mt-2 text-[14px] text-mist">
            This invite link is invalid, expired, or was already used. Ask your
            coach for a fresh one.
          </p>
          <Link to="/dashboard" className="mt-5 block">
            <Button variant="secondary" className="w-full">
              Back to dashboard
            </Button>
          </Link>
        </Card>
      ) : invitation.status !== "PENDING" ? (
        <Card>
          <h1 className="text-xl font-black tracking-tight">
            Invitation {invitation.status.toLowerCase()}
          </h1>
          <p className="mt-2 text-[14px] text-mist">
            This invitation is no longer active. Ask your coach for a new one
            if you still need to join {invitation.teamName}.
          </p>
        </Card>
      ) : !user ? (
        <Card>
          <div className="flex flex-col items-center text-center">
            <TeamLogo teamId="" teamName={invitation.teamName} hasLogo={invitation.hasLogo ?? false} size={72} src={api.invitationLogoUrl(token!)} />
            <p className="mt-4 text-[13px] font-bold uppercase tracking-[0.18em] text-volt-400">
              You're invited
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight">
              {invitation.teamName}
            </h1>
            <div className="mt-3">
              <RoleBadge role={invitation.role} />
            </div>
            <p className="mt-3 text-[14px] text-mist">
              Invited as <strong className="text-ink-50">{invitation.invitedEmail}</strong>
              {" · "}expires {formatDate(invitation.expiresAt)}
            </p>
            <p className="mt-4 text-[14px] text-mist">
              Sign in or create a {BRAND_NAME} account to accept this invitation.
            </p>
            <div className="mt-5 flex w-full flex-col gap-2">
              <Link
                to={`/signin?next=${encodeURIComponent(`/invite/${token}`)}`}
                className="w-full"
              >
                <Button className="w-full">Sign in</Button>
              </Link>
              <Link
                to={`/register?next=${encodeURIComponent(`/invite/${token}`)}`}
                className="w-full"
              >
                <Button variant="secondary" className="w-full">
                  Create account
                </Button>
              </Link>
            </div>
          </div>
        </Card>
      ) : user.email.toLowerCase() !== invitation.invitedEmail.toLowerCase() ? (
        <Card>
          <h1 className="text-xl font-black tracking-tight">Wrong account</h1>
          <p className="mt-2 text-[14px] text-mist">
            This invitation was sent to{" "}
            <strong className="text-ink-50">{invitation.invitedEmail}</strong>,
            but you're signed in as{" "}
            <strong className="text-ink-50">{user.email}</strong>.
          </p>
          <Button
            variant="secondary"
            className="mt-5 w-full"
            onClick={() => {
              void logout().then(() =>
                navigate(`/signin?next=${encodeURIComponent(`/invite/${token}`)}`),
              );
            }}
          >
            Switch accounts
          </Button>
        </Card>
      ) : (
        <Card>
          <div className="flex flex-col items-center text-center">
            <TeamLogo teamId="" teamName={invitation.teamName} hasLogo={invitation.hasLogo ?? false} size={72} src={api.invitationLogoUrl(token!)} />
            <p className="mt-4 text-[13px] font-bold uppercase tracking-[0.18em] text-volt-400">
              You're invited
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight">
              {invitation.teamName}
            </h1>
            <div className="mt-3">
              <RoleBadge role={invitation.role} />
            </div>
            <p className="mt-3 text-[14px] text-mist">
              Joining as <strong className="text-ink-50">{user.displayName}</strong>
              {" · "}expires {formatDate(invitation.expiresAt)}
            </p>
            {acceptError && (
              <div className="mt-4 w-full">
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
          </div>
        </Card>
      )}
    </div>
  );
}
