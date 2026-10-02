import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import {
  Button,
  EmptyState,
  ErrorBanner,
  FullScreenLoader,
  SegmentedControl,
} from "../../components/ui";
import { WorkoutCard } from "./WorkoutBits";

const CAN_MANAGE = new Set(["COACH", "TEAM_ADMIN"]);

export function WorkoutList({ teamId, myRole }: { teamId: string; myRole: string | null }) {
  const [filter, setFilter] = useState<"all" | "templates">("all");

  const workoutsQuery = useQuery({
    queryKey: ["workouts", teamId, filter],
    queryFn: () => api.listWorkouts(teamId, filter === "templates"),
  });

  const canManage = myRole !== null && CAN_MANAGE.has(myRole);
  const workouts = workoutsQuery.data?.workouts ?? [];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          ariaLabel="Workout filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All workouts" },
            { value: "templates", label: "Templates" },
          ]}
        />
        {canManage && (
          <Link to={`/teams/${teamId}/workouts/new`}>
            <Button className="min-h-[44px] px-4 text-[14px]">
              + New workout
            </Button>
          </Link>
        )}
      </div>

      {workoutsQuery.isLoading ? (
        <div className="flex justify-center py-10">
          <FullScreenLoader />
        </div>
      ) : workoutsQuery.isError ? (
        <ErrorBanner message="Couldn't load workouts." />
      ) : workouts.length === 0 ? (
        <EmptyState
          title={filter === "templates" ? "No templates yet" : "No workouts yet"}
          body={
            canManage
              ? "Build the team's first workout — intervals, tempo runs, long runs and more."
              : "Your coach hasn't added any workouts yet."
          }
          action={
            canManage ? (
              <Link to={`/teams/${teamId}/workouts/new`}>
                <Button>+ New workout</Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {workouts.map((w) => (
            <WorkoutCard key={w.id} workout={w} />
          ))}
        </div>
      )}
    </div>
  );
}
