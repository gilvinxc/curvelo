import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { EmptyState } from "../../components/ui";

/**
 * Coaching tab: athletes with expired, expiring, or missing required
 * documents. Read-only surfacing — each row links to the athlete's page
 * where the coach manages documents.
 */
export function EligibilitySection({ teamId }: { teamId: string }) {
  const statusQuery = useQuery({
    queryKey: ["documentStatus", teamId],
    queryFn: () => api.documentStatus(teamId),
  });

  const needsAttention = (statusQuery.data?.athletes ?? []).filter(
    (a) => !a.cleared,
  );

  return (
    <section className="mt-6">
      <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
        ⚠️ Needs attention — eligibility
      </h2>
      {statusQuery.isLoading ? (
        <p className="text-[14px] text-mist">Checking documents…</p>
      ) : statusQuery.isError ? (
        <p className="text-[14px] text-mist">Couldn't load document status.</p>
      ) : needsAttention.length === 0 ? (
        <EmptyState
          title="Everyone's cleared"
          body="No expired, expiring, or missing required documents."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {needsAttention.map((a) => {
            const bad = a.requirements.filter((r) => r.status !== "current");
            return (
              <Link
                key={a.userId}
                to={`/teams/${teamId}/documents`}
                className="flex items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/5 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-bold">
                    {a.displayName}
                  </p>
                  <p className="truncate text-[13px] text-mist">
                    {bad
                      .map(
                        (r) =>
                          `${r.label}: ${r.status === "missing" ? "missing" : r.status}`,
                      )
                      .join(" · ")}
                  </p>
                </div>
                <span className="shrink-0 text-[13px] font-bold text-volt-300">
                  Review →
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
