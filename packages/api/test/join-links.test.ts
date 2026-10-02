import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { getApp, registerUser, truncate, cookieHeader } from "./helpers.js";

describe("join links — shareable invite links with coach approval", () => {
  beforeEach(truncate);

  async function setupTeam() {
    const app = await getApp();
    const owner = await registerUser("COACH", "linkowner");
    const created = await request(app.server)
      .post("/api/v1/teams")
      .set(cookieHeader(owner))
      .send({ name: "Link Test TC" });
    return { app, owner, teamId: created.body.team.id as string };
  }

  async function makeLink(app: unknown, owner: { id: string }, teamId: string, body = {}) {
    const res = await request((app as { server: unknown }).server)
      .post(`/api/v1/teams/${teamId}/join-links`)
      .set(cookieHeader(owner))
      .send({ expiresInDays: 7, ...body });
    expect(res.status).toBe(201);
    return res.body.link.token as string;
  }

  it("full workflow: create link → preview → request → approve → on roster", async () => {
    const { app, owner, teamId } = await setupTeam();
    const token = await makeLink(app, owner, teamId);

    // Public preview, no auth.
    const preview = await request(app.server).get(`/api/v1/join/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body.link.teamName).toBe("Link Test TC");

    // Runner requests to join.
    const runner = await registerUser("RUNNER", "linkrunner");
    const reqJoin = await request(app.server)
      .post(`/api/v1/join/${token}/request`)
      .set(cookieHeader(runner));
    expect(reqJoin.status).toBe(201);

    // Not on the roster yet — approval required.
    const rosterBefore = await request(app.server)
      .get(`/api/v1/teams/${teamId}/roster`)
      .set(cookieHeader(owner));
    expect(
      rosterBefore.body.roster.map((m: { userId: string }) => m.userId),
    ).not.toContain(runner.id);

    // Coach sees the pending request and approves.
    const pending = await request(app.server)
      .get(`/api/v1/teams/${teamId}/join-requests`)
      .set(cookieHeader(owner));
    expect(pending.status).toBe(200);
    expect(pending.body.requests).toHaveLength(1);
    const requestId = pending.body.requests[0].id as string;

    const approve = await request(app.server)
      .post(`/api/v1/teams/${teamId}/join-requests/${requestId}/approve`)
      .set(cookieHeader(owner))
      .send({ role: "RUNNER" });
    expect(approve.status).toBe(200);

    const rosterAfter = await request(app.server)
      .get(`/api/v1/teams/${teamId}/roster`)
      .set(cookieHeader(owner));
    const member = rosterAfter.body.roster.find(
      (m: { userId: string }) => m.userId === runner.id,
    );
    expect(member).toBeDefined();
    expect(member.role).toBe("RUNNER");
  });

  it("revoked links stop working", async () => {
    const { app, owner, teamId } = await setupTeam();
    const token = await makeLink(app, owner, teamId);

    const links = await request(app.server)
      .get(`/api/v1/teams/${teamId}/join-links`)
      .set(cookieHeader(owner));
    const linkId = links.body.links[0].id as string;

    const revoke = await request(app.server)
      .post(`/api/v1/teams/${teamId}/join-links/${linkId}/revoke`)
      .set(cookieHeader(owner));
    expect(revoke.status).toBe(200);

    const preview = await request(app.server).get(`/api/v1/join/${token}`);
    expect(preview.status).toBe(410);
  });

  it("duplicate requests are rejected", async () => {
    const { app, owner, teamId } = await setupTeam();
    const token = await makeLink(app, owner, teamId);
    const runner = await registerUser("RUNNER", "dupejoiner");

    const first = await request(app.server)
      .post(`/api/v1/join/${token}/request`)
      .set(cookieHeader(runner));
    expect(first.status).toBe(201);

    const second = await request(app.server)
      .post(`/api/v1/join/${token}/request`)
      .set(cookieHeader(runner));
    expect(second.status).toBe(409);
  });

  it("a runner cannot create invite links", async () => {
    const { app, teamId } = await setupTeam();
    const outsider = await registerUser("RUNNER", "nolink");
    const res = await request(app.server)
      .post(`/api/v1/teams/${teamId}/join-links`)
      .set(cookieHeader(outsider))
      .send({ expiresInDays: 7 });
    expect(res.status).toBe(404); // not a member → team not found
  });
});

describe("member management — roles and ownership transfer", () => {
  beforeEach(truncate);

  async function setupTeam() {
    const app = await getApp();
    const owner = await registerUser("COACH", "mgmtowner");
    const created = await request(app.server)
      .post("/api/v1/teams")
      .set(cookieHeader(owner))
      .send({ name: "Mgmt Test TC" });
    const teamId = created.body.team.id as string;

    // Add a runner and a second coach via direct membership through approval flow.
    const runner = await registerUser("RUNNER", "mgmtrunner");
    const coach2 = await registerUser("COACH", "coach2");
    for (const u of [runner, coach2]) {
      const invite = await request(app.server)
        .post(`/api/v1/teams/${teamId}/invitations`)
        .set(cookieHeader(owner))
        .send({ email: `${u.id}@x.com`, role: "RUNNER" });
      const { db } = await import("../src/db.js");
      await db.user.update({ where: { id: u.id }, data: { email: `${u.id}@x.com` } });
      await request(app.server)
        .post(`/api/v1/invitations/${invite.body.invitation.token}/accept`)
        .set(cookieHeader(u));
    }
    return { app, owner, runner, coach2, teamId };
  }

  it("owner can promote a runner to coach; non-owner coach cannot", async () => {
    const { app, owner, runner, coach2, teamId } = await setupTeam();

    // coach2 is currently a RUNNER-role member; owner promotes them to COACH first
    // so we can test the non-owner-coach restriction below.
    const promote = await request(app.server)
      .patch(`/api/v1/teams/${teamId}/members/${runner.id}`)
      .set(cookieHeader(owner))
      .send({ role: "COACH" });
    expect(promote.status).toBe(200);

    // A non-owner coach cannot promote someone else to coach.
    const promote2 = await request(app.server)
      .patch(`/api/v1/teams/${teamId}/members/${coach2.id}`)
      .set(cookieHeader(runner))
      .send({ role: "COACH" });
    expect(promote2.status).toBe(403);

    // Owner can demote back.
    const demote = await request(app.server)
      .patch(`/api/v1/teams/${teamId}/members/${runner.id}`)
      .set(cookieHeader(owner))
      .send({ role: "RUNNER" });
    expect(demote.status).toBe(200);
  });

  it("ownership transfers to another member and old owner stays as coach", async () => {
    const { app, owner, runner, teamId } = await setupTeam();

    const transfer = await request(app.server)
      .post(`/api/v1/teams/${teamId}/transfer`)
      .set(cookieHeader(owner))
      .send({ newOwnerId: runner.id });
    expect(transfer.status).toBe(200);

    const roster = await request(app.server)
      .get(`/api/v1/teams/${teamId}/roster`)
      .set(cookieHeader(runner));
    const newOwner = roster.body.roster.find(
      (m: { userId: string }) => m.userId === runner.id,
    );
    expect(newOwner.role).toBe("COACH");

    // Old owner is no longer owner: cannot transfer again.
    const again = await request(app.server)
      .post(`/api/v1/teams/${teamId}/transfer`)
      .set(cookieHeader(owner))
      .send({ newOwnerId: owner.id });
    expect(again.status).toBe(403);
  });

  it("owner cannot be removed; members can be removed by a manager", async () => {
    const { app, owner, runner, teamId } = await setupTeam();

    const removeOwner = await request(app.server)
      .delete(`/api/v1/teams/${teamId}/members/${owner.id}`)
      .set(cookieHeader(owner));
    expect(removeOwner.status).toBe(403);

    const removeRunner = await request(app.server)
      .delete(`/api/v1/teams/${teamId}/members/${runner.id}`)
      .set(cookieHeader(owner));
    expect(removeRunner.status).toBe(200);

    const roster = await request(app.server)
      .get(`/api/v1/teams/${teamId}/roster`)
      .set(cookieHeader(owner));
    expect(
      roster.body.roster.map((m: { userId: string }) => m.userId),
    ).not.toContain(runner.id);
  });
});
