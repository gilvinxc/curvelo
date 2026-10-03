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

async function setupTeam() {
  const app = await getApp();
  const coach = await registerUser("COACH", "injcoach");
  const runnerA = await registerUser("RUNNER", "injrunA");
  const runnerB = await registerUser("RUNNER", "injrunB");
  const teamId = await createTeamAs(coach, "Injury Test Team");
  await addRunnerToTeam(coach, teamId, runnerA);
  await addRunnerToTeam(coach, teamId, runnerB);
  return { app, coach, runnerA, runnerB, teamId };
}

async function inviteAndVerifyGuardian(
  coach: { cookies: string[] },
  teamId: string,
  athleteId: string,
  parent: { email: string; cookies: string[] },
) {
  const app = await getApp();
  const invite = await request(app.server)
    .post(`/api/v1/teams/${teamId}/athletes/${athleteId}/guardians/invite`)
    .set(cookieHeader(coach))
    .send({ email: parent.email, relationship: "parent" });
  expect(invite.status).toBe(201);
  const accept = await request(app.server)
    .post(`/api/v1/guardian-invites/${invite.body.invite.token}/accept`)
    .set(cookieHeader(parent))
    .send({ consents: ["PARTICIPATION", "DATA_SHARING"] });
  expect(accept.status).toBe(200);
}

describe("injury log", () => {
  beforeEach(truncate);

  it("coach can report, list, update, and delete an injury", async () => {
    const { app, coach, runnerA, teamId } = await setupTeam();

    const reported = await request(app.server)
      .post(`/api/v1/teams/${teamId}/injuries`)
      .set(cookieHeader(coach))
      .send({
        athleteId: runnerA.id,
        title: "Shin splints",
        detail: "Left leg, started Monday",
        expectedReturn: "2026-11-01",
      });
    expect(reported.status).toBe(201);
    expect(reported.body.injury.title).toBe("Shin splints");
    expect(reported.body.injury.status).toBe("ACTIVE");
    const injuryId = reported.body.injury.id as string;

    const list = await request(app.server)
      .get(`/api/v1/teams/${teamId}/injuries`)
      .set(cookieHeader(coach));
    expect(list.status).toBe(200);
    expect(list.body.injuries).toHaveLength(1);

    const updated = await request(app.server)
      .patch(`/api/v1/teams/${teamId}/injuries/${injuryId}`)
      .set(cookieHeader(coach))
      .send({ status: "RECOVERED" });
    expect(updated.status).toBe(200);
    expect(updated.body.injury.status).toBe("RECOVERED");
    expect(updated.body.injury.resolvedAt).toBeTruthy();

    const deleted = await request(app.server)
      .delete(`/api/v1/teams/${teamId}/injuries/${injuryId}`)
      .set(cookieHeader(coach));
    expect(deleted.status).toBe(200);

    const after = await request(app.server)
      .get(`/api/v1/teams/${teamId}/injuries`)
      .set(cookieHeader(coach));
    expect(after.body.injuries).toHaveLength(0);
  });

  it("athlete sees only their own injuries", async () => {
    const { app, coach, runnerA, runnerB, teamId } = await setupTeam();

    for (const r of [runnerA, runnerB]) {
      const res = await request(app.server)
        .post(`/api/v1/teams/${teamId}/injuries`)
        .set(cookieHeader(coach))
        .send({ athleteId: r.id, title: "Sore knee" });
      expect(res.status).toBe(201);
    }

    const mine = await request(app.server)
      .get(`/api/v1/teams/${teamId}/injuries`)
      .set(cookieHeader(runnerA));
    expect(mine.status).toBe(200);
    expect(mine.body.injuries).toHaveLength(1);
    expect(mine.body.injuries[0].athleteId).toBe(runnerA.id);
  });

  it("athlete can self-report an injury", async () => {
    const { app, runnerA, teamId } = await setupTeam();
    const res = await request(app.server)
      .post(`/api/v1/teams/${teamId}/injuries`)
      .set(cookieHeader(runnerA))
      .send({ athleteId: runnerA.id, title: "Rolled ankle" });
    expect(res.status).toBe(201);
    expect(res.body.injury.reportedByName).toBeTruthy();
  });

  it("runner cannot report for a teammate or update injuries", async () => {
    const { app, coach, runnerA, runnerB, teamId } = await setupTeam();

    const badReport = await request(app.server)
      .post(`/api/v1/teams/${teamId}/injuries`)
      .set(cookieHeader(runnerA))
      .send({ athleteId: runnerB.id, title: "Fake" });
    expect(badReport.status).toBe(403);

    // coach reports one for runnerB, then runnerA tries to update it
    const reported = await request(app.server)
      .post(`/api/v1/teams/${teamId}/injuries`)
      .set(cookieHeader(coach))
      .send({ athleteId: runnerB.id, title: "Hamstring" });

    const badUpdate = await request(app.server)
      .patch(`/api/v1/teams/${teamId}/injuries/${reported.body.injury.id}`)
      .set(cookieHeader(runnerA))
      .send({ status: "RECOVERED" });
    expect(badUpdate.status).toBe(403);

    const badDelete = await request(app.server)
      .delete(`/api/v1/teams/${teamId}/injuries/${reported.body.injury.id}`)
      .set(cookieHeader(runnerA));
    expect(badDelete.status).toBe(403);
  });

  it("verified guardian sees their athlete's injuries, not others'", async () => {
    const { app, coach, runnerA, runnerB, teamId } = await setupTeam();
    const parent = await registerUser("PARENT", "injparent");
    await inviteAndVerifyGuardian(coach, teamId, runnerA.id, parent);

    for (const r of [runnerA, runnerB]) {
      await request(app.server)
        .post(`/api/v1/teams/${teamId}/injuries`)
        .set(cookieHeader(coach))
        .send({ athleteId: r.id, title: "Sore foot" });
    }

    const list = await request(app.server)
      .get(`/api/v1/teams/${teamId}/injuries`)
      .set(cookieHeader(parent));
    expect(list.status).toBe(200);
    expect(list.body.injuries).toHaveLength(1);
    expect(list.body.injuries[0].athleteId).toBe(runnerA.id);
  });

  it("coach-only export endpoint rejects non-coaches and emits CSV", async () => {
    const { app, coach, runnerA, teamId } = await setupTeam();

    const denied = await request(app.server)
      .get(`/api/v1/teams/${teamId}/entries/export`)
      .set(cookieHeader(runnerA));
    expect(denied.status).toBe(403);

    const ok = await request(app.server)
      .get(`/api/v1/teams/${teamId}/entries/export`)
      .set(cookieHeader(coach));
    expect(ok.status).toBe(200);
    expect(ok.headers["content-type"]).toContain("text/csv");
    expect(ok.headers["content-disposition"]).toContain("attachment");
    const lines = (ok.text as string).split("\r\n");
    expect(lines[0]).toBe(
      "first_name,last_name,team_name,event_name,event_date,seed_time",
    );
    // two runners, no events selected → one row each
    expect(lines.length).toBe(3);
  });
});
