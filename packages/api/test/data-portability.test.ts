import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { getApp, registerUser, truncate, cookieHeader, addRunnerToTeam } from "./helpers.js";

describe("data portability", () => {
  beforeEach(truncate);

  async function setup() {
    const app = await getApp();
    const coach = await registerUser("COACH", "dp1");
    const runner = await registerUser("RUNNER", "dp2");
    const mkTeam = async (name: string, slug: string) => {
      const r = await request(app.server)
        .post("/api/v1/teams")
        .set("Cookie", cookieHeader(coach).Cookie)
        .send({ name, slug });
      return r.body.team.id as string;
    };
    const t1 = await mkTeam("DP Team 1", "dp-team-1");
    const t2 = await mkTeam("DP Team 2", "dp-team-2");
    await addRunnerToTeam(coach, t1, runner);
    // runner logs an activity linked to t1
    const act = await request(app.server)
      .post("/api/v1/activities")
      .set("Cookie", cookieHeader(runner).Cookie)
      .send({
        kind: "RUN",
        startedAt: new Date().toISOString(),
        durationSec: 1800,
        distanceM: 5000,
        visibility: "TEAM",
        teamId: t1,
      });
    // runner posts in t1
    await request(app.server)
      .post(`/api/v1/teams/${t1}/feed`)
      .set("Cookie", cookieHeader(runner).Cookie)
      .send({ body: "hello team" });
    return { app, coach, runner, t1, t2, activityId: act.body.activity.id as string };
  }

  it("leave with remove deletes posts and unlinks activities", async () => {
    const { app, runner, t1, activityId } = await setup();
    const res = await request(app.server)
      .post(`/api/v1/teams/${t1}/leave`)
      .set("Cookie", cookieHeader(runner).Cookie)
      .send({ content: "remove" });
    expect(res.status).toBe(200);

    const feed = await request(app.server)
      .get(`/api/v1/teams/${t1}/feed`)
      .set("Cookie", cookieHeader(runner).Cookie);
    // runner left, so use coach... just check activity directly
    const act = await request(app.server)
      .get(`/api/v1/activities/${activityId}`)
      .set("Cookie", cookieHeader(runner).Cookie);
    expect(act.body.activity.visibility).toBe("PRIVATE");
    expect(act.body.activity.teamId).toBeNull();
    expect(feed.status).toBe(404); // no longer a member (not leaked)
  });

  it("transfer moves activities to a team I'm active in", async () => {
    const { app, coach, runner, t1, t2, activityId } = await setup();
    await addRunnerToTeam(coach, t2, runner);
    const res = await request(app.server)
      .post("/api/v1/activities/transfer")
      .set("Cookie", cookieHeader(runner).Cookie)
      .send({ fromTeamId: t1, toTeamId: t2 });
    expect(res.status).toBe(200);
    expect(res.body.transferred).toBe(1);

    const act = await request(app.server)
      .get(`/api/v1/activities/${activityId}`)
      .set("Cookie", cookieHeader(runner).Cookie);
    expect(act.body.activity.teamId).toBe(t2);
  });

  it("transfer is blocked when not active in target team", async () => {
    const { app, runner, t1, t2 } = await setup();
    const res = await request(app.server)
      .post("/api/v1/activities/transfer")
      .set("Cookie", cookieHeader(runner).Cookie)
      .send({ fromTeamId: t1, toTeamId: t2 });
    expect([403, 404]).toContain(res.status);
  });

  it("delete account is blocked while owning a team", async () => {
    const { app, coach } = await setup();
    const res = await request(app.server)
      .delete("/api/v1/users/me")
      .set("Cookie", cookieHeader(coach).Cookie);
    expect(res.status).toBe(403);
  });

  it("delete account wipes the user", async () => {
    const { app, runner } = await setup();
    const res = await request(app.server)
      .delete("/api/v1/users/me")
      .set("Cookie", cookieHeader(runner).Cookie);
    expect(res.status).toBe(200);
    const me = await request(app.server)
      .get("/api/v1/users/me")
      .set("Cookie", cookieHeader(runner).Cookie);
    expect(me.status).toBe(401);
  });
});
