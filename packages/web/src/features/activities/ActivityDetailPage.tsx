import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  FullScreenLoader,
  PageHeader,
} from "../../components/ui";
import { cn } from "../../components/cx";
import { ShareToFeedDialog } from "../feed/ShareToFeedDialog";
import { downloadIcs } from "../../lib/ics";
import { RichText } from "../../components/RichText";
import { AddRaceResultDialog } from "../records/RecordsSection";
import { formatElevation, useUnits } from "../../lib/units";
import {
  activityKindLabel,
  activityTitle,
  activityYMD,
  formatActivityDateTime,
} from "../../lib/activityFormat";
import {
  addDaysYMD,
  formatDistanceM,
  formatDurationS,
  formatPaceSec,
} from "../../lib/workoutFormat";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-ink-800 px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-mist">
        {label}
      </p>
      <p className="mt-1 text-xl font-extrabold tracking-tight">{value}</p>
    </div>
  );
}

export function ActivityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const units = useUnits();

  const detailQuery = useQuery({
    queryKey: ["activity", id],
    queryFn: () => api.getActivity(id!),
    enabled: !!id,
  });

  const activity = detailQuery.data?.activity;
  const isOwner = !!activity && !!user && activity.userId === user.id;
  const canEdit =
    isOwner || (!!activity && !!user && activity.loggedByUserId === user.id);
  const [shareOpen, setShareOpen] = useState(false);
  const [raceOpen, setRaceOpen] = useState(false);
  const canShare = isOwner && activity?.visibility === "TEAM";

  // Resolve the linked workout (for the "completed workout" link) by finding
  // the assignment on the team calendar around the activity date.
  const day = activity ? activityYMD(activity.startedAt) : null;
  const linkQuery = useQuery({
    queryKey: ["activityAssignmentLink", activity?.teamId, activity?.assignmentId, day],
    queryFn: () =>
      api.teamCalendar(activity!.teamId!, addDaysYMD(day!, -1), addDaysYMD(day!, 1)),
    enabled: !!activity?.teamId && !!activity?.assignmentId && !!day,
  });
  const linkedWorkout = useMemo(() => {
    if (!activity?.assignmentId || !linkQuery.data) return null;
    return (
      linkQuery.data.assignments.find((a) => a.id === activity.assignmentId) ??
      null
    );
  }, [activity?.assignmentId, linkQuery.data]);

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteActivity(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      queryClient.invalidateQueries({ queryKey: ["myStats"] });
      queryClient.invalidateQueries({ queryKey: ["teamCalendar"] });
      queryClient.invalidateQueries({ queryKey: ["myCalendar"] });
      navigate("/dashboard");
    },
    onError: (err) => {
      setError(
        err instanceof ApiError ? err.message : "Couldn't delete this activity.",
      );
    },
  });

  if (detailQuery.isLoading) return <FullScreenLoader />;
  if (detailQuery.isError || !activity) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Activity" backTo="/dashboard" />
        <ErrorBanner message="Couldn't load this activity. It may be private or deleted." />
      </div>
    );
  }

  const metrics: { label: string; value: string }[] = [];
  if (activity.distanceM != null)
    metrics.push({ label: "Distance", value: formatDistanceM(activity.distanceM, units) });
  if (activity.durationS != null)
    metrics.push({ label: "Time", value: formatDurationS(activity.durationS) });
  if (activity.avgPaceS != null)
    metrics.push({ label: "Avg pace", value: formatPaceSec(activity.avgPaceS, units) });
  if (activity.avgHrBpm != null)
    metrics.push({ label: "Avg HR", value: `${activity.avgHrBpm} bpm` });
  if (activity.maxHrBpm != null)
    metrics.push({ label: "Max HR", value: `${activity.maxHrBpm} bpm` });
  if (activity.effortRpe != null)
    metrics.push({ label: "Effort", value: `RPE ${activity.effortRpe}` });
  if (activity.calories != null)
    metrics.push({ label: "Calories", value: `${activity.calories}` });
  if (activity.elevationGainM != null)
    metrics.push({ label: "Elev gain", value: formatElevation(activity.elevationGainM, units) });

  return (
    <div>
      <PageHeader
        title={activityTitle(activity)}
        subtitle={formatActivityDateTime(activity.startedAt)}
        backTo="/dashboard"
        action={
          canEdit ? (
            <div className="flex flex-wrap gap-2">
              {isOwner && canShare && (
                <Button
                  variant="secondary"
                  onClick={() => setShareOpen(true)}
                  className="min-h-[44px] px-4 text-[14px]"
                >
                  Share
                </Button>
              )}
              {activity && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    downloadIcs({
                      title: activityTitle(activity),
                      description: activity.notes,
                      startAt: activity.startedAt,
                      endAt: new Date(
                        new Date(activity.startedAt).getTime() +
                          (activity.durationS ?? 0) * 1000,
                      ).toISOString(),
                      location: activity.city,
                    })
                  }
                  className="min-h-[44px] px-4 text-[14px]"
                  title="Download a calendar file to add this to your phone's calendar"
                >
                  📅 Add
                </Button>
              )}
              {isOwner && (
                <Button
                  variant="secondary"
                  onClick={() => setRaceOpen(true)}
                  className="min-h-[44px] px-4 text-[14px]"
                >
                  🏁 Race
                </Button>
              )}
              <Link to={`/activities/${activity.id}/edit`}>
                <Button variant="secondary" className="min-h-[44px] px-4 text-[14px]">
                  Edit
                </Button>
              </Link>
            </div>
          ) : undefined
        }
      />

      {activity.loggedByName && (
        <p className="mb-4 text-[13px] text-mist">
          Logged by {activity.loggedByName}
        </p>
      )}

      {activity && isOwner && (
        <AddRaceResultDialog
          open={raceOpen}
          onClose={() => setRaceOpen(false)}
          defaults={{
            activityId: activity.id,
            racedAt: activity.startedAt,
            durationS: activity.durationS,
          }}
        />
      )}

      {activity && canShare && (
        <ShareToFeedDialog
          activity={activity}
          open={shareOpen}
          onClose={() => setShareOpen(false)}
        />
      )}

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider",
            "border-volt-400/30 bg-volt-400/10 text-volt-300",
          )}
        >
          {activityKindLabel(activity.kind)}
        </span>
        <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-mist">
          {activity.visibility === "PRIVATE" ? "Private" : "Team"}
        </span>
        {activity.terrain && (
          <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-mist">
            {activity.terrain.charAt(0) + activity.terrain.slice(1).toLowerCase()}
          </span>
        )}
        {activity.source !== "MANUAL" && (
          <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-mist">
            {activity.source.replace(/_/g, " ")}
          </span>
        )}
      </div>

      {!isOwner && (
        <Card className="mb-5 flex items-center gap-3 p-4">
          <div className="min-w-0">
            <p className="text-[13px] font-bold uppercase tracking-[0.15em] text-mist">
              Athlete
            </p>
            <p className="mt-0.5 truncate text-[15px] font-bold">
              {activity.userName}
            </p>
          </div>
        </Card>
      )}

      {linkedWorkout && (
        <Link
          to={`/workouts/${linkedWorkout.workoutId}`}
          className="mb-5 flex items-center gap-3 rounded-2xl border border-volt-400/30 bg-volt-400/5 p-4 transition hover:border-volt-400/60"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c8f542" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 6 9 17l-5-5" />
          </svg>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-mist">
              Completed workout
            </p>
            <p className="truncate text-[15px] font-extrabold text-volt-300">
              {linkedWorkout.workoutTitle}
            </p>
          </div>
        </Link>
      )}

      {metrics.length > 0 ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {metrics.map((m) => (
            <Metric key={m.label} label={m.label} value={m.value} />
          ))}
        </div>
      ) : (
        <EmptyState title="No metrics" body="This activity has no recorded metrics." />
      )}

      {activity.notes && (
        <Card className="mt-5">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.15em] text-mist">
            Notes
          </p>
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
            <RichText
              text={activity.notes}
              mentions={activity.mentions}
              teamId={activity.teamId ?? ""}
            />
          </p>
        </Card>
      )}

      {activity.teamName && (
        <p className="mt-5 text-[13px] text-mist">
          Tagged to team <span className="font-bold text-ink-50">{activity.teamName}</span>
        </p>
      )}

      {isOwner && (
        <div className="mt-8">
          {confirmingDelete ? (
            <Card className="border-red-500/30">
              <p className="text-[15px] font-bold">
                Delete this activity for good?
              </p>
              <p className="mt-1 text-[14px] text-mist">
                This can't be undone.
              </p>
              <div className="mt-4 flex gap-2">
                <Button
                  variant="danger"
                  loading={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate()}
                  className="flex-1"
                >
                  Yes, delete it
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setConfirmingDelete(false)}
                  className="flex-1"
                >
                  Keep it
                </Button>
              </div>
            </Card>
          ) : (
            <Button
              variant="danger"
              onClick={() => setConfirmingDelete(true)}
              className="w-full"
            >
              Delete activity
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
