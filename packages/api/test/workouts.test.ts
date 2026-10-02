import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { getApp, registerUser, truncate, cookieHeader, createTeamAs, createWorkoutAs, INTERVAL_WORKOUT } from "./helpers.js";

describe("workouts", () => {
  beforeEach(truncate);

  it("coach creates a structured workout with ordered steps", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "wcoach");
    const teamId = await createTeamAs(coach, "Workout Team");

    const res = await request(app.server)
      .post(`/api/v1/teams/${teamId}/workouts`)
      .set(cookieHeader(coach))
      .send(INTERVAL_WORKOUT);

    expect(res.status).toBe(201);
    const w = res.body.workout;
    expect(w.title).toBe("6x800m Intervals");
    expect(w.steps).toHaveLength(4);
    expect(w.steps.map((s: { order: number }) => s.order)).toEqual([0, 1, 2, 3]);
    expect(w.steps[1]).toMatchObject({ kind: "INTERVAL", distanceM: 800, repetitions: 6 });
    expect(w.createdByName).toBeDefined();
  });

  it("runner cannot create a workout", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "wcoach2");
    const teamId = await createTeamAs(coach, "Workout Team 2");
    const runner = await registerUser("RUNNER", "wrunner");

    // Runner isn't on the team → 404; add them via invite flow in assignments tests.
    const res = await request(app.server)
      .post(`/api/v1/teams/${teamId}/workouts`)
      .set(cookieHeader(runner))
      .send(INTERVAL_WORKOUT);
    expect(res.status).toBe(404);
  });

  it("lists workouts and fetches detail", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "wcoach3");
    const teamId = await createTeamAs(coach, "Workout Team 3");
    const created = await createWorkoutAs(coach, teamId);

    const list = await request(app.server)
      .get(`/api/v1/teams/${teamId}/workouts`)
      .set(cookieHeader(coach));
    expect(list.status).toBe(200);
    expect(list.body.workouts).toHaveLength(1);

    const detail = await request(app.server)
      .get(`/api/v1/workouts/${created.id}`)
      .set(cookieHeader(coach));
    expect(detail.status).toBe(200);
    expect(detail.body.workout.steps).toHaveLength(4);
  });

  it("coach updates a workout, replacing steps", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "wcoach4");
    const teamId = await createTeamAs(coach, "Workout Team 4");
    const created = await createWorkoutAs(coach, teamId);

    const res = await request(app.server)
      .patch(`/api/v1/workouts/${created.id}`)
      .set(cookieHeader(coach))
      .send({
        title: "8x800m Intervals",
        steps: [
          { kind: "WARMUP", distanceM: 1600 },
          { kind: "INTERVAL", distanceM: 800, repetitions: 8 },
          { kind: "COOLDOWN", distanceM: 1600 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.workout.title).toBe("8x800m Intervals");
    expect(res.body.workout.steps).toHaveLength(3);
    expect(res.body.workout.steps[1].repetitions).toBe(8);
  });

  it("rejects a step with no distance or duration", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "wcoach5");
    const teamId = await createTeamAs(coach, "Workout Team 5");

    const res = await request(app.server)
      .post(`/api/v1/teams/${teamId}/workouts`)
      .set(cookieHeader(coach))
      .send({ title: "Bad", steps: [{ kind: "INTERVAL" }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("cannot delete a workout that has assignments", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "wcoach6");
    const teamId = await createTeamAs(coach, "Workout Team 6");
    const workout = await createWorkoutAs(coach, teamId);

    await request(app.server)
      .post(`/api/v1/teams/${teamId}/assignments`)
      .set(cookieHeader(coach))
      .send({ workoutId: workout.id, scheduledDate: "2026-10-15" });

    const del = await request(app.server)
      .delete(`/api/v1/workouts/${workout.id}`)
      .set(cookieHeader(coach));
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe("WORKOUT_HAS_ASSIGNMENTS");
  });

  it("templates are listed separately", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "wcoach7");
    const teamId = await createTeamAs(coach, "Workout Team 7");
    await createWorkoutAs(coach, teamId);
    await createWorkoutAs(coach, teamId, { ...INTERVAL_WORKOUT, title: "Template", isTemplate: true });

    const templates = await request(app.server)
      .get(`/api/v1/teams/${teamId}/workouts?templatesOnly=true`)
      .set(cookieHeader(coach));
    expect(templates.body.workouts).toHaveLength(1);
    expect(templates.body.workouts[0].isTemplate).toBe(true);
  });
});
