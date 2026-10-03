import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { getApp, registerUser, truncate, cookieHeader, addRunnerToTeam } from "./helpers.js";

describe("leave team", () => {
  beforeEach(truncate);

  it("member can leave; owner cannot without transferring", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "leave1");
    const runner = await registerUser("RUNNER", "leave2");
    const teamRes = await request(app.server)
      .post("/api/v1/teams")
      .set("Cookie", cookieHeader(coach).Cookie)
      .send({ name: "Leave Team", slug: "leave-team" });
    const teamId = teamRes.body.team.id;
    await addRunnerToTeam(coach, teamId, runner);

    // runner leaves
    const leave = await request(app.server)
      .post(`/api/v1/teams/${teamId}/leave`)
      .set("Cookie", cookieHeader(runner).Cookie);
    expect(leave.status).toBe(200);

    // owner tries to leave -> blocked
    const ownerLeave = await request(app.server)
      .post(`/api/v1/teams/${teamId}/leave`)
      .set("Cookie", cookieHeader(coach).Cookie);
    expect(ownerLeave.status).toBe(403);
  });
});
