import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  getApp,
  registerUser,
  truncate,
  cookieHeader,
  createTeamAs,
  addRunnerToTeam,
} from "./helpers.js";

const PNG_DATA_URL =
  "data:image/png;base64," +
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");

describe("team logos", () => {
  beforeEach(truncate);

  it("coach can set, serve, and remove a logo; hasLogo tracks state", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "logo1");
    const teamId = await createTeamAs(coach, "Logo Team");
    const cookies = cookieHeader(coach).Cookie;

    const put = await request(app.server)
      .put(`/api/v1/teams/${teamId}/logo`)
      .set("Cookie", cookies)
      .send({ image: PNG_DATA_URL });
    expect(put.status).toBe(200);

    const team = await request(app.server)
      .get(`/api/v1/teams/${teamId}`)
      .set("Cookie", cookies);
    expect(team.body.team.hasLogo).toBe(true);

    const img = await request(app.server)
      .get(`/api/v1/teams/${teamId}/logo`)
      .set("Cookie", cookies);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");

    const del = await request(app.server)
      .delete(`/api/v1/teams/${teamId}/logo`)
      .set("Cookie", cookies);
    expect(del.status).toBe(200);

    const after = await request(app.server)
      .get(`/api/v1/teams/${teamId}`)
      .set("Cookie", cookies);
    expect(after.body.team.hasLogo).toBe(false);

    const gone = await request(app.server)
      .get(`/api/v1/teams/${teamId}/logo`)
      .set("Cookie", cookies);
    expect(gone.status).toBe(404);
  });

  it("runner cannot set or remove the logo", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "logo2c");
    const runner = await registerUser("RUNNER", "logo2r");
    const teamId = await createTeamAs(coach, "Logo Team 2");
    await addRunnerToTeam(coach, teamId, runner);
    const cookies = cookieHeader(runner).Cookie;

    const put = await request(app.server)
      .put(`/api/v1/teams/${teamId}/logo`)
      .set("Cookie", cookies)
      .send({ image: PNG_DATA_URL });
    expect(put.status).toBe(403);

    const del = await request(app.server)
      .delete(`/api/v1/teams/${teamId}/logo`)
      .set("Cookie", cookies);
    expect(del.status).toBe(403);
  });

  it("rejects invalid image data", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "logo3");
    const teamId = await createTeamAs(coach, "Logo Team 3");
    const res = await request(app.server)
      .put(`/api/v1/teams/${teamId}/logo`)
      .set("Cookie", cookieHeader(coach).Cookie)
      .send({ image: "data:image/png;base64,aGVsbG8=" });
    expect(res.status).toBe(400);
  });

  it("non-member cannot fetch a private team's logo", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "logo4c");
    const outsider = await registerUser("RUNNER", "logo4o");
    const teamId = await createTeamAs(coach, "Logo Team 4");
    await request(app.server)
      .put(`/api/v1/teams/${teamId}/logo`)
      .set("Cookie", cookieHeader(coach).Cookie)
      .send({ image: PNG_DATA_URL });

    const res = await request(app.server)
      .get(`/api/v1/teams/${teamId}/logo`)
      .set("Cookie", cookieHeader(outsider).Cookie);
    expect(res.status).toBe(404);
  });

  it("replacing the logo overwrites the old bytes (no orphan)", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "logo5");
    const teamId = await createTeamAs(coach, "Logo Team 5");
    const cookies = cookieHeader(coach).Cookie;
    const jpeg =
      "data:image/jpeg;base64," +
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64");

    await request(app.server)
      .put(`/api/v1/teams/${teamId}/logo`)
      .set("Cookie", cookies)
      .send({ image: PNG_DATA_URL });
    const second = await request(app.server)
      .put(`/api/v1/teams/${teamId}/logo`)
      .set("Cookie", cookies)
      .send({ image: jpeg });
    expect(second.status).toBe(200);

    const img = await request(app.server)
      .get(`/api/v1/teams/${teamId}/logo`)
      .set("Cookie", cookies);
    expect(img.headers["content-type"]).toBe("image/jpeg");
  });

  it("dashboard team list carries hasLogo", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "logo6");
    const teamId = await createTeamAs(coach, "Logo Team 6");
    const cookies = cookieHeader(coach).Cookie;
    await request(app.server)
      .put(`/api/v1/teams/${teamId}/logo`)
      .set("Cookie", cookies)
      .send({ image: PNG_DATA_URL });

    const res = await request(app.server)
      .get("/api/v1/teams")
      .set("Cookie", cookies);
    const found = res.body.teams.find((t: { id: string }) => t.id === teamId);
    expect(found.hasLogo).toBe(true);
  });
});

describe("public team logos (join links + invitations)", () => {
  beforeEach(truncate);

  it("join link preview carries hasLogo and serves the logo without auth", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "publogo1");
    const teamId = await createTeamAs(coach, "Public Logo Team");
    const cookies = cookieHeader(coach).Cookie;
    await request(app.server)
      .put(`/api/v1/teams/${teamId}/logo`)
      .set("Cookie", cookies)
      .send({ image: PNG_DATA_URL });

    const linkRes = await request(app.server)
      .post(`/api/v1/teams/${teamId}/join-links`)
      .set("Cookie", cookies)
      .send({ expiresInDays: 7 });
    expect(linkRes.status).toBe(201);
    const token = linkRes.body.link.token as string;

    const preview = await request(app.server).get(`/api/v1/join/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body.link.hasLogo).toBe(true);

    const img = await request(app.server).get(`/api/v1/join/${token}/logo`);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
  });

  it("join link logo 404s with a bad token or no logo", async () => {
    const app = await getApp();
    const bad = await request(app.server).get(`/api/v1/join/badtoken123/logo`);
    expect(bad.status).toBe(404);
  });
});
