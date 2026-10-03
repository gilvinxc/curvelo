import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { getApp, registerUser, truncate, cookieHeader, addRunnerToTeam } from "./helpers.js";

describe("alumni outer tier", () => {
  beforeEach(truncate);

  it("alumni see only celebratory feed kinds and cannot post", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "alum1");
    const alum = await registerUser("RUNNER", "alum2");
    const teamRes = await request(app.server)
      .post("/api/v1/teams")
      .set("Cookie", cookieHeader(coach).Cookie)
      .send({ name: "Alum Team", slug: "alum-team" });
    const teamId = teamRes.body.team.id;
    await addRunnerToTeam(coach, teamId, alum);

    // coach posts a text post and shares an activity
    await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set("Cookie", cookieHeader(coach).Cookie)
      .send({ body: "Regular team post" });
    await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set("Cookie", cookieHeader(coach).Cookie)
      .send({ kind: "SHOUTOUT", body: "Great season, team!" });

    // demote to alumni
    await request(app.server)
      .patch(`/api/v1/teams/${teamId}/members/${alum.id}`)
      .set("Cookie", cookieHeader(coach).Cookie)
      .send({ role: "ALUMNI" });

    const feed = await request(app.server)
      .get(`/api/v1/teams/${teamId}/feed`)
      .set("Cookie", cookieHeader(alum).Cookie);
    const kinds = feed.body.posts.map((p: { kind: string }) => p.kind);
    expect(kinds).not.toContain("TEXT");
    expect(kinds).toContain("SHOUTOUT");

    // alumni cannot post
    const post = await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set("Cookie", cookieHeader(alum).Cookie)
      .send({ body: "Trying to post" });
    expect(post.status).toBe(403);
  });

  it("alumni see announcements but not team chat", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "alum3");
    const alum = await registerUser("RUNNER", "alum4");
    const teamRes = await request(app.server)
      .post("/api/v1/teams")
      .set("Cookie", cookieHeader(coach).Cookie)
      .send({ name: "Alum Team 2", slug: "alum-team-2" });
    const teamId = teamRes.body.team.id;
    await addRunnerToTeam(coach, teamId, alum);
    await request(app.server)
      .patch(`/api/v1/teams/${teamId}/members/${alum.id}`)
      .set("Cookie", cookieHeader(coach).Cookie)
      .send({ role: "ALUMNI" });

    const convs = await request(app.server)
      .get(`/api/v1/teams/${teamId}/conversations`)
      .set("Cookie", cookieHeader(alum).Cookie);
    const kinds = convs.body.conversations.map((c: { kind: string }) => c.kind);
    expect(kinds).toContain("ANNOUNCEMENT");
    expect(kinds).not.toContain("TEAM_CHAT");
    expect(kinds).not.toContain("GROUP_CHAT");
  });

  it("alumni cannot view photos", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "alum5");
    const alum = await registerUser("RUNNER", "alum6");
    const teamRes = await request(app.server)
      .post("/api/v1/teams")
      .set("Cookie", cookieHeader(coach).Cookie)
      .send({ name: "Alum Team 3", slug: "alum-team-3" });
    const teamId = teamRes.body.team.id;
    await addRunnerToTeam(coach, teamId, alum);
    await request(app.server)
      .patch(`/api/v1/teams/${teamId}/members/${alum.id}`)
      .set("Cookie", cookieHeader(coach).Cookie)
      .send({ role: "ALUMNI" });

    const albums = await request(app.server)
      .get(`/api/v1/teams/${teamId}/albums`)
      .set("Cookie", cookieHeader(alum).Cookie);
    expect(albums.status).toBe(403);
  });
});
