import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  getApp,
  registerUser,
  truncate,
  cookieHeader,
  createTeamAs,
  createWorkoutAs,
  addRunnerToTeam,
} from "./helpers.js";

async function setup() {
  const app = await getApp();
  const coach = await registerUser("COACH", "pcoach");
  const teamId = await createTeamAs(coach, "Planner Team");
  const workout = await createWorkoutAs(coach, teamId);
  const workout2 = await createWorkoutAs(coach, teamId);
  const r1 = await registerUser("RUNNER", "pr1");
  await addRunnerToTeam(coach, teamId, r1);
  return { app, coach, teamId, workout, workout2, r1 };
}

describe("practice planner", () => {
  beforeEach(truncate);

  it("coach schedules a single session, with and without feed announce", async () => {
    const { app, coach, teamId, workout } = await setup();

    const quiet = await request(app.server)
      .post(`/api/v1/teams/${teamId}/practice-plans`)
      .set(cookieHeader(coach))
      .send({ workoutId: workout.id, scheduledDate: "2026-11-02" });
    expect(quiet.status).toBe(201);
    expect(quiet.body.assignment.workoutTitle).toBeDefined();
    expect(quiet.body.postId).toBeNull();

    const loud = await request(app.server)
      .post(`/api/v1/teams/${teamId}/practice-plans`)
      .set(cookieHeader(coach))
      .send({
        workoutId: workout.id,
        scheduledDate: "2026-11-03",
        notes: "Bring spikes",
        announce: true,
      });
    expect(loud.status).toBe(201);
    expect(loud.body.postId).toBeTruthy();

    const feed = await request(app.server)
      .get(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(coach));
    expect(feed.status).toBe(200);
    const bodies = (feed.body.posts as Array<{ body: string | null }>).map(
      (p) => p.body ?? "",
    );
    expect(bodies.some((b) => b.includes("Practice plan"))).toBe(true);
  });

  it("runner cannot use the planner", async () => {
    const { app, teamId, workout, r1 } = await setup();
    const res = await request(app.server)
      .post(`/api/v1/teams/${teamId}/practice-plans`)
      .set(cookieHeader(r1))
      .send({ workoutId: workout.id, scheduledDate: "2026-11-02" });
    expect(res.status).toBe(403);
  });

  it("coach creates a week template and applies it to a Monday", async () => {
    const { app, coach, teamId, workout, workout2, r1 } = await setup();

    const created = await request(app.server)
      .post(`/api/v1/teams/${teamId}/training-plans`)
      .set(cookieHeader(coach))
      .send({
        name: "Base week",
        days: [
          { dayOfWeek: 0, workoutId: workout.id },
          {
            dayOfWeek: 2,
            workoutId: workout2.id,
            assignedToUserId: r1.id,
            notes: "Easy effort",
          },
        ],
      });
    expect(created.status).toBe(201);
    const planId = created.body.plan.id as string;
    expect(created.body.plan.days).toHaveLength(2);

    const listed = await request(app.server)
      .get(`/api/v1/teams/${teamId}/training-plans`)
      .set(cookieHeader(coach));
    expect(listed.status).toBe(200);
    expect(listed.body.plans).toHaveLength(1);

    const applied = await request(app.server)
      .post(`/api/v1/teams/${teamId}/training-plans/${planId}/apply`)
      .set(cookieHeader(coach))
      .send({ weekStart: "2026-11-02", announce: true });
    expect(applied.status).toBe(201);
    expect(applied.body.assignments).toHaveLength(2);
    const dates = (applied.body.assignments as Array<{ scheduledDate: string }>)
      .map((a) => a.scheduledDate)
      .sort();
    expect(dates).toEqual(["2026-11-02", "2026-11-04"]);
    expect(applied.body.postId).toBeTruthy();
  });

  it("apply rejects a non-Monday week start; runner cannot manage templates", async () => {
    const { app, coach, teamId, workout, r1 } = await setup();

    const created = await request(app.server)
      .post(`/api/v1/teams/${teamId}/training-plans`)
      .set(cookieHeader(coach))
      .send({ name: "Base week", days: [{ dayOfWeek: 0, workoutId: workout.id }] });
    const planId = created.body.plan.id as string;

    const badDay = await request(app.server)
      .post(`/api/v1/teams/${teamId}/training-plans/${planId}/apply`)
      .set(cookieHeader(coach))
      .send({ weekStart: "2026-11-04" });
    expect(badDay.status).toBe(409);

    const runnerCreate = await request(app.server)
      .post(`/api/v1/teams/${teamId}/training-plans`)
      .set(cookieHeader(r1))
      .send({ name: "Nope", days: [{ dayOfWeek: 0, workoutId: workout.id }] });
    expect(runnerCreate.status).toBe(403);
  });

  it("coach deletes a template", async () => {
    const { app, coach, teamId, workout } = await setup();
    const created = await request(app.server)
      .post(`/api/v1/teams/${teamId}/training-plans`)
      .set(cookieHeader(coach))
      .send({ name: "Temp", days: [{ dayOfWeek: 0, workoutId: workout.id }] });
    const planId = created.body.plan.id as string;

    const del = await request(app.server)
      .delete(`/api/v1/teams/${teamId}/training-plans/${planId}`)
      .set(cookieHeader(coach));
    expect(del.status).toBe(200);

    const listed = await request(app.server)
      .get(`/api/v1/teams/${teamId}/training-plans`)
      .set(cookieHeader(coach));
    expect(listed.body.plans).toHaveLength(0);
  });
});
