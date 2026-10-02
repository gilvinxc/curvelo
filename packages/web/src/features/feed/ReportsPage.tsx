import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  FullScreenLoader,
  PageHeader,
} from "../../components/ui";
import { formatRelativeTime } from "./feedFormat";

const STATUS_FILTERS = ["OPEN", "RESOLVED", "DISMISSED"] as const;
const CAN_MODERATE = new Set(["COACH", "TEAM_ADMIN"]);

/** Route guard: only coaches/admins can view the moderation queue. */
export function ReportsRoute() {
  const { id } = useParams<{ id: string }>();
  const teamQuery = useQuery({
    queryKey: ["team", id],
    queryFn: () => api.getTeam(id!),
    enabled: !!id,
  });

  if (teamQuery.isLoading) return <FullScreenLoader />;
  if (teamQuery.isError || !teamQuery.data) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Reports" backTo="/dashboard" />
        <ErrorBanner message="Couldn't load this team." />
      </div>
    );
  }
  const { team } = teamQuery.data;
  if (team.myRole === null || !CAN_MODERATE.has(team.myRole)) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Reports" backTo={`/teams/${team.id}`} />
        <ErrorBanner message="Only coaches and team admins can review reports." />
      </div>
    );
  }
  return <ReportsPage teamId={team.id} />;
}

/** Coach moderation queue: reported posts with dismiss / delete-post actions. */
export function ReportsPage({ teamId }: { teamId: string }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("OPEN");
  const [error, setError] = useState<string | null>(null);

  const reportsQuery = useQuery({
    queryKey: ["reports", teamId, status],
    queryFn: () => api.listReports(teamId, status),
  });

  const resolveMutation = useMutation({
    mutationFn: ({
      reportId,
      next,
    }: {
      reportId: string;
      next: "RESOLVED" | "DISMISSED";
    }) => api.resolveReport(reportId, next),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["reports", teamId] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Couldn't update the report.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (postId: string) => api.deletePost(postId),
    onSuccess: () => {
      setError(null);
      // Reports against the post cascade-delete server-side.
      queryClient.invalidateQueries({ queryKey: ["reports", teamId] });
      queryClient.invalidateQueries({ queryKey: ["feed", teamId] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Couldn't delete the post.");
    },
  });

  const reports = reportsQuery.data?.reports ?? [];

  return (
    <div>
      <PageHeader
        title="Reported posts"
        subtitle="Review flags from the team"
        backTo={`/teams/${teamId}`}
      />

      <div
        role="radiogroup"
        aria-label="Report status"
        className="mb-5 grid auto-cols-fr grid-flow-col gap-1 rounded-xl border border-white/10 bg-ink-900 p-1"
      >
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={status === s}
            onClick={() => setStatus(s)}
            className={`min-h-[44px] rounded-lg px-3 text-[14px] font-semibold capitalize transition ${
              status === s
                ? "bg-volt-400 text-ink-950"
                : "text-mist hover:text-ink-50"
            }`}
          >
            {s.toLowerCase()}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      {reportsQuery.isLoading ? (
        <FullScreenLoader />
      ) : reportsQuery.isError ? (
        <ErrorBanner message="Couldn't load reports." />
      ) : reports.length === 0 ? (
        <EmptyState
          title={status === "OPEN" ? "All clear" : `No ${status.toLowerCase()} reports`}
          body={
            status === "OPEN"
              ? "Nobody has flagged anything. Nice team."
              : "Nothing to show here."
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {reports.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex items-start gap-3">
                <Avatar name={r.reporterName} size="sm" className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px]">
                    <span className="font-bold">{r.reporterName}</span>{" "}
                    <span className="text-mist/70">
                      reported {formatRelativeTime(r.createdAt)}
                    </span>
                  </p>
                  <p className="mt-1 inline-flex items-center rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-amber-300">
                    {r.reason}
                  </p>
                  <blockquote className="mt-2.5 rounded-xl border-l-2 border-volt-400/50 bg-ink-800 px-3.5 py-2.5 text-[14px] italic leading-relaxed text-mist">
                    “{r.postExcerpt}”
                  </blockquote>
                </div>
              </div>
              {r.status === "OPEN" && (
                <div className="mt-4 flex gap-2">
                  <Button
                    variant="secondary"
                    loading={resolveMutation.isPending}
                    onClick={() =>
                      resolveMutation.mutate({ reportId: r.id, next: "DISMISSED" })
                    }
                    className="min-h-[44px] flex-1 text-[14px]"
                  >
                    Dismiss
                  </Button>
                  <Button
                    variant="danger"
                    loading={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(r.postId)}
                    className="min-h-[44px] flex-1 text-[14px]"
                  >
                    Delete post
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
