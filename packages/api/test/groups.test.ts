import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { getApp, registerUser, truncate, cookieHeader, TestUser } from "./helpers.js";
import { createTeamAs } from "./workouts.test.js";

async function addRunnerToTeam(coach: TestUser, teamId: string, runner: TestUser) {
  const app = await getApp();
  const invite = await request(app.server)
    .post(`/api/v1/teams/${teamId}/invitations`)
    .set(cookieHeader(coach))
    .send({ email: runner.email, role: "RUNNER" });
  const accept = await request(app.server)
    .post(`/api/v1/invitations/${invite.body.invitation.token}/accept`)
    .set(cookieHeader(runner));
  if (accept.status !== 200) throw new Error("accept failed");
}

describe("groups", () => {
  beforeEach(truncate);

  it("coach creates a group with members", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "gcoach");
    const teamId = await createTeamAs(coach, "Group Team");
    const r1 = await registerUser("RUNNER", "gr1");
    const r2 = await registerUser("RUNNER", "gr2");
    await addRunnerToTeam(coach, teamId, r1);
    await addRunnerToTeam(coach, teamId, r2);

    const res = await request(app.server)
      .post(`/api/v1/teams/${teamId}/groups`)
      .set(cookieHeader(coach))
      .send({ name: "Varsity", memberIds: [r1.id, r2.id] });
    expect(res.status).toBe(201);
    expect(res.body.group.name).toBe("Varsity");
    expect(res.body.group.memberCount).toBe(2);
    expect(res.body.group.members).toHaveLength(2);
  });

  it("rejects duplicate group names and non-member ids", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "gcoach2");
    const teamId = await createTeamAs(coach, "Group Team 2");
    const outsider = await registerUser("RUNNER", "gout");

    const bad = await request(app.server)
      .post(`/api/v1/teams/${teamId}/groups`)
      .set(cookieHeader(coach))
      .send({ name: "JV", memberIds: [outsider.id] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("INVALID_MEMBERS");

    const first = await request(app.server)
      .post(`/api/v1/teams/${teamId}/groups`)
      .set(cookieHeader(coach))
      .send({ name: "JV", memberIds: [] });
    expect(first.status).toBe(201);

    const dupe = await request(app.server)
      .post(`/api/v1/teams/${teamId}/groups`)
      .set(cookieHeader(coach))
      .send({ name: "JV", memberIds: [] });
    expect(dupe.status).toBe(409);
  });

  it("runner cannot create a group", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "gcoach3");
    const teamId = await createTeamAs(coach, "Group Team 3");
    const runner = await registerUser("RUNNER", "grunner3");
    await addRunnerToTeam(coach, teamId, runner);

    const res = await request(app.server)
      .post(`/api/v1/teams/${teamId}/groups`)
      .set(cookieHeader(runner))
      .send({ name: "Sneaky", memberIds: [] });
    expect(res.status).toBe(403);
  });

  it("add and remove members", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "gcoach4");
    const teamId = await createTeamAs(coach, "Group Team 4");
    const r1 = await registerUser("RUNNER", "gr4a");
    const r2 = await registerUser("RUNNER", "gr4b");
    await addRunnerToTeam(coach, teamId, r1);
    await addRunnerToTeam(coach, teamId, r2);

    const created = await request(app.server)
      .post(`/api/v1/teams/${teamId}/groups`)
      .set(cookieHeader(coach))
      .send({ name: "Distance", memberIds: [r1.id] });
    const groupId = created.body.group.id;

    const added = await request(app.server)
      .post(`/api/v1/groups/${groupId}/members`)
      .set(cookieHeader(coach))
      .send({ memberIds: [r2.id] });
    expect(added.body.group.memberCount).toBe(2);

    const removed = await request(app.server)
      .delete(`/api/v1/groups/${groupId}/members/${r1.id}`)
      .set(cookieHeader(coach));
    expect(removed.body.group.memberCount).toBe(1);
  });
});
