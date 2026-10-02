import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import {
  Avatar,
  Button,
  Card,
  ErrorBanner,
  FullScreenLoader,
  Logo,
} from "../../components/ui";

/**
 * Public team join page. Anyone with the link can request to join;
 * a coach/admin must approve before they become a member.
 */
export function JoinTeamPage() {
  const { token } = useParams<{ token: string }>();
  const { user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);

  const previewQuery = useQuery({
    queryKey: ["join-link", token],
    queryFn: () => api.previewJoinLink(token!),
    enabled: !!token,
    retry: false,
  });

  const requestJoin = useMutation({
    mutationFn: () => api.requestJoin(token!),
    onSuccess: ({ teamId }) => {
      setRequested(true);
      void queryClient.invalidateQueries({ queryKey: ["teams"] });
      void queryClient.invalidateQueries({ queryKey: ["team", teamId] });
    },
    onError: (err) => {
      setRequestError(
        err instanceof ApiError ? err.message : "Couldn't send the request.",
      );
    },
  });

  if (authLoading || previewQuery.isLoading) return <FullScreenLoader />;

  const link = previewQuery.data?.link;
  const next = encodeURIComponent(`/join/${token}`);

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center">
      <div className="mb-8 flex justify-center">
        <Logo />
      </div>

      {previewQuery.isError || !link ? (
        <Card>
          <h1 className="text-xl font-black tracking-tight">
            Invite link not found
          </h1>
          <p className="mt-2 text-[14px] text-mist">
            This link is invalid, expired, or was revoked. Ask the coach for a
            fresh one.
          </p>
          <Link to="/dashboard" className="mt-5 block">
            <Button variant="secondary" className="w-full">
              Back to dashboard
            </Button>
          </Link>
        </Card>
      ) : !user ? (
        <Card>
          <div className="flex flex-col items-center text-center">
            <Avatar name={link.teamName} size="lg" />
            <p className="mt-4 text-[13px] font-bold uppercase tracking-[0.18em] text-volt-400">
              You're invited to join
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight">
              {link.teamName}
            </h1>
            {link.teamDescription && (
              <p className="mt-3 text-[14px] text-mist">{link.teamDescription}</p>
            )}
            <p className="mt-4 text-[14px] text-mist">
              Sign in or create a Curvelo account to request to join. A coach
              will approve your request.
            </p>
            <div className="mt-5 flex w-full flex-col gap-2">
              <Link to={`/signin?next=${next}`} className="w-full">
                <Button className="w-full">Sign in</Button>
              </Link>
              <Link to={`/register?next=${next}`} className="w-full">
                <Button variant="secondary" className="w-full">
                  Create account
                </Button>
              </Link>
            </div>
          </div>
        </Card>
      ) : requested ? (
        <Card>
          <div className="flex flex-col items-center text-center">
            <Avatar name={link.teamName} size="lg" />
            <h1 className="mt-4 text-xl font-black tracking-tight">
              Request sent
            </h1>
            <p className="mt-2 text-[14px] text-mist">
              A coach from {link.teamName} will review your request. You'll see
              the team on your dashboard once you're approved.
            </p>
            <Link to="/dashboard" className="mt-5 block w-full">
              <Button variant="secondary" className="w-full">
                Back to dashboard
              </Button>
            </Link>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="flex flex-col items-center text-center">
            <Avatar name={link.teamName} size="lg" />
            <p className="mt-4 text-[13px] font-bold uppercase tracking-[0.18em] text-volt-400">
              You're invited to join
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight">
              {link.teamName}
            </h1>
            {link.teamDescription && (
              <p className="mt-3 text-[14px] text-mist">{link.teamDescription}</p>
            )}
            <p className="mt-4 text-[14px] text-mist">
              A coach will approve your request before you can see the team.
            </p>
            {requestError && (
              <div className="mt-4 w-full">
                <ErrorBanner message={requestError} />
              </div>
            )}
            <Button
              className="mt-5 w-full"
              disabled={requestJoin.isPending}
              onClick={() => {
                setRequestError(null);
                requestJoin.mutate();
              }}
            >
              {requestJoin.isPending ? "Sending…" : "Request to join"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
