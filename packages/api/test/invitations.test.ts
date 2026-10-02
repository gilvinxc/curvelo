import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { getApp, registerUser, truncate, cookieHeader } from "./helpers.js";
import { db } from "../src/db.js";

describe("invitations — coach-to-runner workflow", () => {
  beforeEach(truncate);

  async function setupTeam() {
    const app = await getApp();
    const coach = await registerUser("COACH", "invcoach");
    const created = await request(app.server)
      .post("/api/v1/teams")
      .set(cookieHeader(coach))
      .send({ name: "Invite Test TC" });
    return { app, coach, teamId: created.body.team.id as string };
  }

  it("full workflow: invite → preview → register → accept → on roster", async () => {
    const { app, coach, teamId } = await setupTeam();

    const invite = await request(app.server)
      .post(`/api/v1/teams/${teamId}/invitations`)
      .set(cookieHeader(coach))
      .send({ email: "newrunner@example.com", role: "RUNNER" });
    expect(invite.status).toBe(201);
    const token = invite.body.invitation.token as string;
    expect(token).toBeDefined();

    // Public preview, no auth needed.
    const preview = await request(app.server).get(`/api/v1/invitations/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body.invitation.teamName).toBe("Invite Test TC");
    expect(preview.body.invitation.role).toBe("RUNNER");

    // Runner registers with the invited email, then accepts.
    const runner = await registerUser("RUNNER", "newrunner");
    // registerUser generates its own email; align it with the invite.
    await db.user.update({
      where: { id: runner.id },
      data: { email: "newrunner@example.com" },
    });

    const accept = await request(app.server)
      .post(`/api/v1/invitations/${token}/accept`)
      .set(cookieHeader(runner));
    expect(accept.status).toBe(200);
    expect(accept.body).toMatchObject({ teamId, role: "RUNNER" });

    const roster = await request(app.server)
      .get(`/api/v1/teams/${teamId}/roster`)
      .set(cookieHeader(coach));
    expect(roster.body.roster.map((m: { email: string }) => m.email)).toContain(
      "newrunner@example.com",
    );
  });

  it("rejects accept when the logged-in email does not match the invite", async () => {
    const { app, coach, teamId } = await setupTeam();
    const invite = await request(app.server)
      .post(`/api/v1/teams/${teamId}/invitations`)
      .set(cookieHeader(coach))
      .send({ email: "someone@example.com", role: "RUNNER" });
    const token = invite.body.invitation.token as string;

    const impostor = await registerUser("RUNNER", "impostor");
    const res = await request(app.server)
      .post(`/api/v1/invitations/${token}/accept`)
      .set(cookieHeader(impostor));
    expect(res.status).toBe(403);
  });

  it("a runner cannot invite others", async () => {
    const { app, coach, teamId } = await setupTeam();
    const runner = await registerUser("RUNNER", "lowpriv");

    // Get the runner onto the team first.
    const invite = await request(app.server)
      .post(`/api/v1/teams/${teamId}/invitations`)
      .set(cookieHeader(coach))
      .send({ email: runner.email, role: "RUNNER" });
    await request(app.server)
      .post(`/api/v1/invitations/${invite.body.invitation.token}/accept`)
      .set(cookieHeader(runner));

    const attempt = await request(app.server)
      .post(`/api/v1/teams/${teamId}/invitations`)
      .set(cookieHeader(runner))
      .send({ email: "friend@example.com", role: "RUNNER" });
    expect(attempt.status).toBe(403);
  });

  it("expired invitations are rejected", async () => {
    const { app, coach, teamId } = await setupTeam();
    const invite = await request(app.server)
      .post(`/api/v1/teams/${teamId}/invitations`)
      .set(cookieHeader(coach))
      .send({ email: "late@example.com", role: "RUNNER" });
    const token = invite.body.invitation.token as string;

    await db.invitation.update({
      where: { token },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const preview = await request(app.server).get(`/api/v1/invitations/${token}`);
    expect(preview.status).toBe(410);
    expect(preview.body.error.code).toBe("INVITATION_EXPIRED");
  });

  it("re-inviting the same email revokes the old invitation", async () => {
    const { app, coach, teamId } = await setupTeam();
    const first = await request(app.server)
      .post(`/api/v1/teams/${teamId}/invitations`)
      .set(cookieHeader(coach))
      .send({ email: "repeat@example.com", role: "RUNNER" });
    const second = await request(app.server)
      .post(`/api/v1/teams/${teamId}/invitations`)
      .set(cookieHeader(coach))
      .send({ email: "repeat@example.com", role: "RUNNER" });
    expect(second.status).toBe(201);
    expect(second.body.invitation.token).not.toBe(first.body.invitation.token);

    const stale = await request(app.server).get(
      `/api/v1/invitations/${first.body.invitation.token}`,
    );
    expect(stale.status).toBe(410);
  });

  it("cannot invite someone who is already on the team", async () => {
    const { app, coach, teamId } = await setupTeam();
    const res = await request(app.server)
      .post(`/api/v1/teams/${teamId}/invitations`)
      .set(cookieHeader(coach))
      .send({ email: coach.email, role: "COACH" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ALREADY_MEMBER");
  });
});
