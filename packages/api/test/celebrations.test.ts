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
import { db } from "../src/db.js";

async function setup() {
  const app = await getApp();
  const coach = await registerUser("COACH", "celcoach");
  const runner = await registerUser("RUNNER", "celrunner");
  const teamId = await createTeamAs(coach, "Celebration TC");
  await addRunnerToTeam(coach, teamId, runner);
  return { app, coach, runner, teamId };
}

async function feedKinds(app: any, teamId: string, user: any): Promise<string[]> {
  const res = await request(app.server)
    .get(`/api/v1/teams/${teamId}/feed`)
    .set(cookieHeader(user));
  expect(res.status).toBe(200);
  return res.body.posts.map((p: any) => p.kind);
}

describe("celebrations", () => {
  beforeEach(truncate);

  it("posts a MILESTONE for the first workout", async () => {
    const { app, runner, teamId } = await setup();
    const res = await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(runner))
      .send({
        kind: "RUN",
        startedAt: new Date(Date.now() - 3600000).toISOString(),
        distanceM: 3000,
        durationS: 1000,
        teamId,
        visibility: "TEAM",
      });
    expect(res.status).toBe(201);

    const kinds = await feedKinds(app, teamId, runner);
    expect(kinds).toContain("MILESTONE");
    const feed = await request(app.server)
      .get(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(runner));
    const milestone = feed.body.posts.find((p: any) => p.kind === "MILESTONE");
    expect(milestone.body).toContain("first workout");
  });

  it("posts a MILESTONE for the first 5K and longest run", async () => {
    const { app, runner, teamId } = await setup();
    // First a short run (first workout milestone).
    await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(runner))
      .send({
        kind: "RUN",
        startedAt: new Date(Date.now() - 7200000).toISOString(),
        distanceM: 2000,
        durationS: 700,
        teamId,
        visibility: "TEAM",
      });
    // Then a 5K (first 5K + longest run).
    const res = await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(runner))
      .send({
        kind: "RUN",
        startedAt: new Date(Date.now() - 3600000).toISOString(),
        distanceM: 5000,
        durationS: 1500,
        teamId,
        visibility: "TEAM",
      });
    expect(res.status).toBe(201);

    const feed = await request(app.server)
      .get(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(runner));
    const milestones = feed.body.posts.filter((p: any) => p.kind === "MILESTONE");
    const bodies = milestones.map((p: any) => p.body).join(" | ");
    expect(bodies).toContain("first 5K");
    expect(bodies).toContain("longest run");
  });

  it("does not post milestones for private activities", async () => {
    const { app, runner, teamId } = await setup();
    await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(runner))
      .send({
        kind: "RUN",
        startedAt: new Date(Date.now() - 3600000).toISOString(),
        distanceM: 5000,
        durationS: 1500,
        visibility: "PRIVATE",
      });
    const kinds = await feedKinds(app, teamId, runner);
    expect(kinds).not.toContain("MILESTONE");
  });

  it("creates SHOUTOUT posts via the API", async () => {
    const { app, coach, runner, teamId } = await setup();
    const res = await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(coach))
      .send({ body: `@${runner.email} thanks for pacing me!`, kind: "SHOUTOUT" });
    // Note: mentions match on display name; the post kind is what we assert.
    expect(res.status).toBe(201);
    expect(res.body.post.kind).toBe("SHOUTOUT");
  });

  it("rejects invalid shoutout kinds", async () => {
    const { app, coach, teamId } = await setup();
    const res = await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(coach))
      .send({ body: "hello", kind: "MILESTONE" });
    expect(res.status).toBe(400);
  });

  it("posts a WELCOME when an invitation is accepted", async () => {
    const { app, coach, teamId } = await setup();
    const invite = await request(app.server)
      .post(`/api/v1/teams/${teamId}/invitations`)
      .set(cookieHeader(coach))
      .send({ email: "welcomed@example.com", role: "RUNNER" });
    expect(invite.status).toBe(201);
    const token = invite.body.invitation.token as string;

    const newcomer = await registerUser("RUNNER", "welcomed");
    await db.user.update({
      where: { id: newcomer.id },
      data: { email: "welcomed@example.com" },
    });
    const accept = await request(app.server)
      .post(`/api/v1/invitations/${token}/accept`)
      .set(cookieHeader(newcomer));
    expect(accept.status).toBe(200);

    const kinds = await feedKinds(app, teamId, coach);
    expect(kinds).toContain("WELCOME");
  });
});
