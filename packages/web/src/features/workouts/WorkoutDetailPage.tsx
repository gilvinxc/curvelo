import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";
import {
  Button,
  Card,
  ErrorBanner,
  FullScreenLoader,
  PageHeader,
  formatDate,
} from "../../components/ui";
import { WorkoutKindBadge, WorkoutSteps } from "./WorkoutBits";
import { AssignDialog } from "./AssignDialog";

const CAN_MANAGE = new Set(["COACH", "TEAM_ADMIN"]);

export function WorkoutDetailPage() {
  const { workoutId } = useParams<{ workoutId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [assignOpen, setAssignOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const workoutQuery = useQuery({
    queryKey: ["workout", workoutId],
    queryFn: () => api.getWorkout(workoutId!),
    enabled: !!workoutId,
  });

  const teamId = workoutQuery.data?.workout.teamId;
  const teamQuery = useQuery({
    queryKey: ["team", teamId],
    queryFn: () => api.getTeam(teamId!),
    enabled: !!teamId,
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteWorkout(workoutId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workouts"] });
      navigate(`/teams/${teamId}/workouts`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "WORKOUT_HAS_ASSIGNMENTS") {
        setDeleteError(
          "This workout is scheduled on the team calendar. Remove its assignments before deleting it.",
        );
      } else {
        setDeleteError(err instanceof Error ? err.message : "Couldn't delete the workout.");
      }
      setConfirmingDelete(false);
    },
  });

  if (workoutQuery.isLoading) return <FullScreenLoader />;

  if (workoutQuery.isError || !workoutQuery.data) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Workout" backTo="/dashboard" />
        <ErrorBanner message="Couldn't load this workout. You may not have access." />
      </div>
    );
  }

  const { workout } = workoutQuery.data;
  const myRole = teamQuery.data?.team.myRole ?? null;
  const canManage = myRole !== null && CAN_MANAGE.has(myRole);

  return (
    <div>
      <PageHeader
        title={workout.title}
        subtitle={`By ${workout.createdByName} · ${formatDate(workout.createdAt)}`}
        backTo={`/teams/${workout.teamId}/workouts`}
      />

      {deleteError && (
        <div className="mb-4">
          <ErrorBanner message={deleteError} />
        </div>
      )}

      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <WorkoutKindBadge kind={workout.kind} />
          {workout.isTemplate && (
            <span className="rounded-full border border-volt-400/40 bg-volt-400/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-volt-300">
              Template
            </span>
          )}
        </div>
        {workout.description && (
          <p className="mt-3 text-[15px] leading-relaxed text-ink-50/90">
            {workout.description}
          </p>
        )}
      </Card>

      <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
        Steps ({workout.steps.length})
      </h2>
      <WorkoutSteps workout={workout} />

      <div className="mt-6 flex flex-col gap-2">
        {canManage && (
          <Button onClick={() => setAssignOpen(true)}>Assign workout</Button>
        )}
        {canManage && (
          <div className="flex gap-2">
            <Link to={`/workouts/${workout.id}/edit`} className="flex-1">
              <Button variant="secondary" className="w-full">
                Edit
              </Button>
            </Link>
            {confirmingDelete ? (
              <Button
                variant="danger"
                className="flex-1"
                loading={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
              >
                Confirm delete
              </Button>
            ) : (
              <Button
                variant="danger"
                className="flex-1"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete
              </Button>
            )}
          </div>
        )}
      </div>

      <AssignDialog
        teamId={workout.teamId}
        workoutId={workout.id}
        workoutTitle={workout.title}
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
      />
    </div>
  );
}
