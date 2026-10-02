import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ApiError, api } from "../../lib/api";
import { Button, Card, ErrorBanner } from "../../components/ui";

const API_BASE =
  import.meta.env.VITE_API_URL ?? "http://localhost:4000/api/v1";

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function TrackerSection() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [notice, setNotice] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ["trackerStatus"],
    queryFn: () => api.trackerStatus(),
  });
  const coros = statusQuery.data?.trackers.find((t) => t.provider === "COROS");


  useEffect(() => {
    if (searchParams.get("tracker") === "coros") {
      if (searchParams.get("connected") === "1") {
        setNotice("COROS connected. Workouts will sync from your watch.");
        void queryClient.invalidateQueries({ queryKey: ["trackerStatus"] });
      } else if (searchParams.get("error")) {
        setNotice("Couldn't connect COROS. Please try again.");
      }
      searchParams.delete("tracker");
      searchParams.delete("connected");
      searchParams.delete("error");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, queryClient]);

  const syncMutation = useMutation({
    mutationFn: () => api.syncCoros(),
    onSuccess: (data) => {
      const r = data.result;
      setNotice(
        r.imported > 0
          ? `Synced ${r.imported} new workout${r.imported === 1 ? "" : "s"} from COROS.`
          : "Checked COROS — no new workouts.",
      );
      void queryClient.invalidateQueries({ queryKey: ["trackerStatus"] });
      void queryClient.invalidateQueries({ queryKey: ["activities"] });
    },
    onError: (e) =>
      setNotice(
        e instanceof ApiError ? e.message : "COROS sync failed. Try again.",
      ),
  });


  // Auto-sync in the background when the connection is stale (>6h). This
  // gives us hands-free syncing without webhooks or a server scheduler.
  useEffect(() => {
    if (!coros?.connected || syncMutation.isPending) return;
    const last = coros.lastSyncAt ? new Date(coros.lastSyncAt).getTime() : 0;
    if (Date.now() - last > 6 * 3600 * 1000) {
      syncMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coros?.connected]);

  const disconnectMutation = useMutation({
    mutationFn: () => api.disconnectCoros(),
    onSuccess: () => {
      setNotice("COROS disconnected.");
      void queryClient.invalidateQueries({ queryKey: ["trackerStatus"] });
    },
  });

  return (
    <Card className="mt-4">
      <h3 className="text-[15px] font-extrabold">Connected apps</h3>
      <p className="mt-1 text-[14px] text-mist">
        Sync workouts automatically from your watch.
      </p>
      {notice && (
        <div className="mt-3">
          <ErrorBanner message={notice} />
        </div>
      )}
      <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-bold text-ink-50">
              ⌚ COROS
              {coros?.connected && (
                <span className="ml-2 rounded-full bg-volt-400/20 px-2 py-0.5 text-[11px] font-bold text-volt-300">
                  CONNECTED
                </span>
              )}
            </p>
            <p className="mt-0.5 text-[13px] text-mist">
              {coros?.connected
                ? `Last synced ${timeAgo(coros.lastSyncAt)}`
                : "Connect your COROS account to auto-import runs."}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {!coros?.connected ? (
            <Button
              onClick={() => {
                window.location.href = `${API_BASE}/trackers/coros/connect`;
              }}
            >
              Connect COROS
            </Button>
          ) : (
            <>
              <Button
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
              >
                {syncMutation.isPending ? "Syncing…" : "Sync now"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
              >
                Disconnect
              </Button>
            </>
          )}
        </div>
      </div>
      <p className="mt-2 text-[12px] text-mist">
        Free connection. Each athlete connects their own COROS account; synced
        runs appear as normal activities and can be shared to the team feed.
      </p>
    </Card>
  );
}
