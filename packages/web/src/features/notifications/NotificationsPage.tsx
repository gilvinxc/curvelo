import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { Button, EmptyState, Spinner } from "../../components/ui";

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.listNotifications(),
  });

  const readAll = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unread-count"] });
    },
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unread-count"] });
    },
  });

  // Opening the page clears the badge.
  useEffect(() => {
    if (data && data.notifications.some((n) => !n.readAt)) {
      readAll.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const notifications = data?.notifications ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Notifications</h1>
      {isLoading ? (
        <Spinner />
      ) : notifications.length === 0 ? (
        <EmptyState
          title="Nothing yet"
          body="When a teammate tags you with @yourname, you'll see it here."
        />
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`rounded-2xl border p-4 ${
                n.readAt
                  ? "border-white/10 bg-ink-900"
                  : "border-volt-400/40 bg-ink-900"
              }`}
            >
              {n.link ? (
                <Link
                  to={n.link}
                  onClick={() => !n.readAt && markRead.mutate(n.id)}
                  className="block"
                >
                  <p className="font-semibold text-white">{n.title}</p>
                  {n.body && (
                    <p className="mt-1 line-clamp-2 text-sm text-white/70">
                      {n.body}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-white/40">
                    {timeAgo(n.createdAt)}
                  </p>
                </Link>
              ) : (
                <>
                  <p className="font-semibold text-white">{n.title}</p>
                  {n.body && (
                    <p className="mt-1 line-clamp-2 text-sm text-white/70">
                      {n.body}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-white/40">
                    {timeAgo(n.createdAt)}
                  </p>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {notifications.length > 0 && (
        <Button
          variant="ghost"
          onClick={() => readAll.mutate()}
          disabled={readAll.isPending}
        >
          Mark all as read
        </Button>
      )}
    </div>
  );
}
