import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  addRunnerToTeam,
  cookieHeader,
  createTeamAs,
  getApp,
  registerUser,
  truncate,
} from "./helpers.js";

async function setup() {
  const app = await getApp();
  const coach = await registerUser("COACH", "tlcoach");
  const teamId = await createTeamAs(coach, "Team Log Squad");
  const r1 = await registerUser("RUNNER", "tlr1");
  const r2 = await registerUser("RUNNER", "tlr2");
  await addRunnerToTeam(coach, teamId, r1);
  await addRunnerToTeam(coach, teamId, r2);
  return { app, coach, teamId, r1, r2 };
}

const TEAM_RUN = {
  kind: "RUN",
  title: "Tuesday practice",
  startedAt: new Date().toISOString(),
  distanceM: 8000,
  durationS: 2400,
};

describe("coach team run logging", () => {
  beforeEach(truncate);

  it("coach logs one run for the whole team; each athlete owns their copy", async () => {
    const { app, coach, teamId, r1, r2 } = await setup();
    const res = await request(app.server)
      .post("/api/v1/activities/team-log")
      .set(cookieHeader(coach))
      .send({ teamId, ...TEAM_RUN });
    expect(res.status).toBe(201);
    expect(res.body.count).toBe(2);

    for (const runner of [r1, r2]) {
      const mine = await request(app.server)
        .get("/api/v1/activities?from=2020-01-01&to=2030-01-01")
        .set(cookieHeader(runner));
      expect(mine.body.activities).toHaveLength(1);
      const a = mine.body.activities[0];
      expect(a.userId).toBe(runner.id);
      expect(a.loggedByUserId).toBe(coach.id);
      expect(typeof a.loggedByName).toBe("string");
      expect(a.loggedByName.length).toBeGreaterThan(0);
      expect(a.visibility).toBe("TEAM");
      expect(a.distanceM).toBe(8000);
    }
  });

  it("coach selects a subset; non-members are rejected; runners are forbidden", async () => {
    const { app, coach, teamId, r1, r2 } = await setup();

    const subset = await request(app.server)
      .post("/api/v1/activities/team-log")
      .set(cookieHeader(coach))
      .send({ teamId, userIds: [r1.id], ...TEAM_RUN });
    expect(subset.status).toBe(201);
    expect(subset.body.count).toBe(1);

    const r2mine = await request(app.server)
      .get("/api/v1/activities?from=2020-01-01&to=2030-01-01")
      .set(cookieHeader(r2));
    expect(r2mine.body.activities).toHaveLength(0);

    const outsider = await registerUser("RUNNER", "tloutsider");
    const bad = await request(app.server)
      .post("/api/v1/activities/team-log")
      .set(cookieHeader(coach))
      .send({ teamId, userIds: [outsider.id], ...TEAM_RUN });
    expect(bad.status).toBe(403);

    const runnerTry = await request(app.server)
      .post("/api/v1/activities/team-log")
      .set(cookieHeader(r1))
      .send({ teamId, ...TEAM_RUN });
    expect(runnerTry.status).toBe(403);
  });

  it("coach can edit and delete runs they logged, but not athletes' own runs", async () => {
    const { app, coach, teamId, r1 } = await setup();
    const logged = await request(app.server)
      .post("/api/v1/activities/team-log")
      .set(cookieHeader(coach))
      .send({ teamId, userIds: [r1.id], ...TEAM_RUN });
    const activityId = logged.body.activityIds[0];

    const edit = await request(app.server)
      .patch(`/api/v1/activities/${activityId}`)
      .set(cookieHeader(coach))
      .send({ distanceM: 9000 });
    expect(edit.status).toBe(200);
    expect(edit.body.activity.distanceM).toBe(9000);

    // Athlete's own run: coach cannot touch it.
    const own = await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(r1))
      .send({
        kind: "RUN",
        startedAt: new Date().toISOString(),
        distanceM: 5000,
        durationS: 1500,
      });
    const noEdit = await request(app.server)
      .patch(`/api/v1/activities/${own.body.activity.id}`)
      .set(cookieHeader(coach))
      .send({ distanceM: 1 });
    expect(noEdit.status).toBe(404);
    const noDelete = await request(app.server)
      .delete(`/api/v1/activities/${own.body.activity.id}`)
      .set(cookieHeader(coach));
    expect(noDelete.status).toBe(404);

    // Athlete can still edit the coach-logged run (it's their run).
    const athleteEdit = await request(app.server)
      .patch(`/api/v1/activities/${activityId}`)
      .set(cookieHeader(r1))
      .send({ notes: "Felt good" });
    expect(athleteEdit.status).toBe(200);

    // Coach can delete what they logged.
    const del = await request(app.server)
      .delete(`/api/v1/activities/${activityId}`)
      .set(cookieHeader(coach));
    expect(del.status).toBe(200);
  });

  it("coach-logged runs pick up each athlete's default shoe", async () => {
    const { app, coach, teamId, r1 } = await setup();
    const shoe = await request(app.server)
      .post("/api/v1/shoes")
      .set(cookieHeader(r1))
      .send({ name: "Trainers" });
    await request(app.server)
      .post(`/api/v1/shoes/${shoe.body.shoe.id}/default`)
      .set(cookieHeader(r1))
      .expect(200);

    const logged = await request(app.server)
      .post("/api/v1/activities/team-log")
      .set(cookieHeader(coach))
      .send({ teamId, userIds: [r1.id], ...TEAM_RUN });
    const activityId = logged.body.activityIds[0];
    const got = await request(app.server)
      .get(`/api/v1/activities/${activityId}`)
      .set(cookieHeader(coach));
    expect(got.body.activity.shoeId).toBe(shoe.body.shoe.id);
  });

  it("per-athlete overrides win over team values; bad overrides rejected", async () => {
    const { app, coach, teamId, r1, r2 } = await setup();

    const res = await request(app.server)
      .post("/api/v1/activities/team-log")
      .set(cookieHeader(coach))
      .send({
        teamId,
        ...TEAM_RUN,
        overrides: [{ userId: r1.id, durationS: 2100 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.count).toBe(2);

    const r1mine = await request(app.server)
      .get("/api/v1/activities?from=2020-01-01&to=2030-01-01")
      .set(cookieHeader(r1));
    expect(r1mine.body.activities[0].durationS).toBe(2100);
    expect(r1mine.body.activities[0].distanceM).toBe(8000);

    const r2mine = await request(app.server)
      .get("/api/v1/activities?from=2020-01-01&to=2030-01-01")
      .set(cookieHeader(r2));
    expect(r2mine.body.activities[0].durationS).toBe(2400);

    // Override for someone not selected is rejected.
    const outsider = await registerUser("RUNNER", "tloutsider2");
    const bad = await request(app.server)
      .post("/api/v1/activities/team-log")
      .set(cookieHeader(coach))
      .send({
        teamId,
        userIds: [r1.id],
        ...TEAM_RUN,
        overrides: [{ userId: outsider.id, durationS: 2000 }],
      });
    expect(bad.status).toBe(400);
  });
});
