import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { getApp, registerUser, truncate, cookieHeader, addRunnerToTeam } from "./helpers.js";

const planBody = {
  name: "Off-season base",
  description: "Easy miles",
  days: [
    { date: "2026-11-02", title: "Easy 4 miles", notes: "Conversational pace" },
    { date: "2026-11-04", title: "Tempo 3 miles" },
  ],
};

describe("personal training plans", () => {
  beforeEach(truncate);

  it("creates, applies, lists days, and deletes a plan", async () => {
    const app = await getApp();
    const me = await registerUser("RUNNER", "plan1");
    const cookies = cookieHeader(me).Cookie;

    const create = await request(app.server)
      .post("/api/v1/personal-plans")
      .set("Cookie", cookies)
      .send(planBody);
    expect(create.status).toBe(201);
    expect(create.body.plan.days).toHaveLength(2);
    const planId = create.body.plan.id;

    // not applied -> no days on the calendar feed
    const empty = await request(app.server)
      .get("/api/v1/personal-plans/days?from=2026-11-01&to=2026-11-30")
      .set("Cookie", cookies);
    expect(empty.body.days).toHaveLength(0);

    // apply -> days appear
    const apply = await request(app.server)
      .post(`/api/v1/personal-plans/${planId}/apply`)
      .set("Cookie", cookies);
    expect(apply.body.plan.applied).toBe(true);

    const days = await request(app.server)
      .get("/api/v1/personal-plans/days?from=2026-11-01&to=2026-11-30")
      .set("Cookie", cookies);
    expect(days.body.days).toHaveLength(2);
    expect(days.body.days[0].title).toBe("Easy 4 miles");
    expect(days.body.days[0].planName).toBe("Off-season base");

    // unapply hides them again
    await request(app.server)
      .post(`/api/v1/personal-plans/${planId}/unapply`)
      .set("Cookie", cookies);
    const hidden = await request(app.server)
      .get("/api/v1/personal-plans/days?from=2026-11-01&to=2026-11-30")
      .set("Cookie", cookies);
    expect(hidden.body.days).toHaveLength(0);

    // delete
    const del = await request(app.server)
      .delete(`/api/v1/personal-plans/${planId}`)
      .set("Cookie", cookies);
    expect(del.body.ok).toBe(true);
  });

  it("is private: another user cannot touch my plan", async () => {
    const app = await getApp();
    const me = await registerUser("RUNNER", "plan2");
    const other = await registerUser("RUNNER", "plan3");
    const create = await request(app.server)
      .post("/api/v1/personal-plans")
      .set("Cookie", cookieHeader(me).Cookie)
      .send(planBody);
    const planId = create.body.plan.id;
    const res = await request(app.server)
      .get("/api/v1/personal-plans")
      .set("Cookie", cookieHeader(other).Cookie);
    expect(res.body.plans).toHaveLength(0);
    const patch = await request(app.server)
      .patch(`/api/v1/personal-plans/${planId}`)
      .set("Cookie", cookieHeader(other).Cookie)
      .send({ name: "Hacked" });
    expect(patch.status).toBe(404);
  });

  it("coach can view an athlete's planned days; runner cannot", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "plan4");
    const athlete = await registerUser("RUNNER", "plan5");
    const stranger = await registerUser("RUNNER", "plan6");
    // team with coach + athlete
    const teamRes = await request(app.server)
      .post("/api/v1/teams")
      .set("Cookie", cookieHeader(coach).Cookie)
      .send({ name: "Plan Team", slug: "plan-team" });
    const teamId = teamRes.body.team.id;
    await addRunnerToTeam(coach, teamId, athlete);
    // athlete creates + applies a plan
    const create = await request(app.server)
      .post("/api/v1/personal-plans")
      .set("Cookie", cookieHeader(athlete).Cookie)
      .send(planBody);
    await request(app.server)
      .post(`/api/v1/personal-plans/${create.body.plan.id}/apply`)
      .set("Cookie", cookieHeader(athlete).Cookie);

    const url = `/api/v1/teams/${teamId}/athletes/${athlete.id}/planned?from=2026-11-01&to=2026-11-30`;
    const coachView = await request(app.server)
      .get(url)
      .set("Cookie", cookieHeader(coach).Cookie);
    expect(coachView.status).toBe(200);
    expect(coachView.body.days).toHaveLength(2);
    expect(coachView.body.days[0].title).toBe("Easy 4 miles");

    const strangerView = await request(app.server)
      .get(url)
      .set("Cookie", cookieHeader(stranger).Cookie);
    expect([403, 404]).toContain(strangerView.status);
  });
});
