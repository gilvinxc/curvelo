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

const RUN_BODY = {
  kind: "RUN",
  startedAt: new Date().toISOString(),
  distanceM: 5000,
  durationS: 1500,
  visibility: "TEAM",
};

async function setup() {
  const app = await getApp();
  const coach = await registerUser("COACH", "goalcoach");
  const runner = await registerUser("RUNNER", "goalrunner");
  const teamId = await createTeamAs(coach, "Goal Getters");
  await addRunnerToTeam(coach, teamId, runner);
  return { app, coach, runner, teamId };
}

describe("goals + leaderboard + analytics", () => {
  beforeEach(truncate);

  it("runner creates a personal distance goal (imperial units) and sees progress", async () => {
    const { app, runner } = await setup();
    const created = await request(app.server)
      .post("/api/v1/goals")
      .set(cookieHeader(runner))
      .send({ kind: "DISTANCE", period: "WEEK", target: 10 }); // 10 miles
    expect(created.status).toBe(201);
    // 10 mi = 16093 m
    expect(created.body.goal.targetMeters).toBe(16093);

    const list = await request(app.server)
      .get("/api/v1/goals")
      .set(cookieHeader(runner));
    expect(list.status).toBe(200);
    expect(list.body.goals).toHaveLength(1);
    expect(list.body.goals[0].progress).toBe(0);
  });

  it("logging a run advances the goal and completes it at the target", async () => {
    const { app, runner, teamId } = await setup();
    await request(app.server)
      .post("/api/v1/goals")
      .set(cookieHeader(runner))
      .send({ kind: "DISTANCE", period: "WEEK", target: 3 }); // ~3 mi

    // Two 2-mile runs exceed the 3-mile goal.
    for (let i = 0; i < 2; i++) {
      const res = await request(app.server)
        .post("/api/v1/activities")
        .set(cookieHeader(runner))
        .send({ ...RUN_BODY, teamId, distanceM: 3219 });
      expect(res.status).toBe(201);
    }
    // Give the fire-and-forget completion check a tick.
    await new Promise((r) => setTimeout(r, 300));

    const list = await request(app.server)
      .get("/api/v1/goals")
      .set(cookieHeader(runner));
    const goal = list.body.goals[0];
    expect(goal.progress).toBe(6438);
    expect(goal.status).toBe("COMPLETED");
  });

  it("coach creates a team goal; runner cannot", async () => {
    const { app, coach, runner, teamId } = await setup();
    const body = {
      kind: "DISTANCE",
      title: "October miles",
      target: 100,
      startAt: new Date().toISOString(),
      endAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    };
    const ok = await request(app.server)
      .post(`/api/v1/teams/${teamId}/goals`)
      .set(cookieHeader(coach))
      .send(body);
    expect(ok.status).toBe(201);
    expect(ok.body.goal.title).toBe("October miles");

    const denied = await request(app.server)
      .post(`/api/v1/teams/${teamId}/goals`)
      .set(cookieHeader(runner))
      .send(body);
    expect(denied.status).toBe(403);

    const list = await request(app.server)
      .get(`/api/v1/teams/${teamId}/goals`)
      .set(cookieHeader(runner));
    expect(list.body.goals).toHaveLength(1);
  });

  it("leaderboard ranks team-visible runs only", async () => {
    const { app, coach, runner, teamId } = await setup();
    const other = await registerUser("RUNNER", "goalother");
    await addRunnerToTeam(coach, teamId, other);

    const post = (user: { cookies: string[] }, distanceM: number, visibility = "TEAM") =>
      request(app.server)
        .post("/api/v1/activities")
        .set(cookieHeader(user))
        .send({ ...RUN_BODY, teamId, distanceM, visibility });

    await post(runner, 5000);
    await post(other, 8000);
    await post(other, 20000, "PRIVATE"); // must not count

    const board = await request(app.server)
      .get(`/api/v1/teams/${teamId}/leaderboard?metric=distance&days=7`)
      .set(cookieHeader(runner));
    expect(board.status).toBe(200);
    const entries = board.body.leaderboard.entries;
    expect(entries).toHaveLength(2);
    expect(entries[0].value).toBe(8000);
    expect(entries[0].rank).toBe(1);
    expect(entries[1].value).toBe(5000);
    expect(board.body.leaderboard.myRank).toBe(2);
  });

  it("coach sets and removes a team logo; members can fetch it", async () => {
    const { app, coach, runner, teamId } = await setup();
    // 1x1 PNG data URL
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    const set = await request(app.server)
      .put(`/api/v1/teams/${teamId}/logo`)
      .set(cookieHeader(coach))
      .send({ image: png });
    expect(set.status).toBe(200);

    const denied = await request(app.server)
      .put(`/api/v1/teams/${teamId}/logo`)
      .set(cookieHeader(runner))
      .send({ image: png });
    expect(denied.status).toBe(403);

    const team = await request(app.server)
      .get(`/api/v1/teams/${teamId}`)
      .set(cookieHeader(runner));
    expect(team.body.team.hasLogo).toBe(true);

    const logo = await request(app.server)
      .get(`/api/v1/teams/${teamId}/logo`)
      .set(cookieHeader(runner));
    expect(logo.status).toBe(200);
    expect(logo.headers["content-type"]).toBe("image/png");

    const removed = await request(app.server)
      .delete(`/api/v1/teams/${teamId}/logo`)
      .set(cookieHeader(coach));
    expect(removed.status).toBe(200);

    const gone = await request(app.server)
      .get(`/api/v1/teams/${teamId}/logo`)
      .set(cookieHeader(runner));
    expect(gone.status).toBe(404);
  });

  it("progress analytics bucket weekly runs", async () => {
    const { app, runner, teamId } = await setup();
    await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(runner))
      .send({ ...RUN_BODY, teamId });

    const res = await request(app.server)
      .get("/api/v1/users/me/progress?weeks=4")
      .set(cookieHeader(runner));
    expect(res.status).toBe(200);
    expect(res.body.progress.weeks).toHaveLength(4);
    expect(res.body.progress.totalSessions).toBe(1);
    expect(res.body.progress.totalDistanceM).toBe(5000);
  });

  it("athlete can fetch their own insight", async () => {
    const { app, runner } = await setup();
    const res = await request(app.server)
      .get("/api/v1/users/me/insights")
      .set(cookieHeader(runner));
    expect(res.status).toBe(200);
    expect(res.body.insight.athleteId).toBe(runner.id);
    expect(res.body.insight.periodDays).toBe(28);
  });
});
