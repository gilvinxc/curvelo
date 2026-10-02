import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  getApp,
  registerUser,
  truncate,
  cookieHeader,
  TestUser,
  createTeamAs,
  addRunnerToTeam,
} from "./helpers.js";

async function setup() {
  const app = await getApp();
  const coach = await registerUser("COACH", "gcoach");
  const teamId = await createTeamAs(coach, "Guardian Team");
  const athlete = await registerUser("RUNNER", "gathlete");
  const parent = await registerUser("PARENT", "gparent");
  await addRunnerToTeam(coach, teamId, athlete);
  return { app, coach, teamId, athlete, parent };
}

async function inviteGuardian(
  coach: TestUser,
  teamId: string,
  athleteId: string,
  email: string,
) {
  const app = await getApp();
  const res = await request(app.server)
    .post(`/api/v1/teams/${teamId}/athletes/${athleteId}/guardians/invite`)
    .set(cookieHeader(coach))
    .send({ email, relationship: "parent" });
  if (res.status !== 201) {
    throw new Error(`invite failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.invite;
}

describe("guardians", () => {
  beforeEach(truncate);

  it("full flow: coach invites → parent previews → accepts with consents", async () => {
    const { app, coach, teamId, athlete, parent } = await setup();

    const invite = await inviteGuardian(coach, teamId, athlete.id, parent.email);
    expect(invite.token).toBeDefined();
    expect(invite.status).toBe("PENDING");

    const preview = await request(app.server).get(
      `/api/v1/guardian-invites/${invite.token}/preview`,
    );
    expect(preview.status).toBe(200);
    expect(preview.body.invite.teamName).toBeDefined();
    expect(preview.body.invite.token).toBeUndefined(); // not leaked publicly

    const accept = await request(app.server)
      .post(`/api/v1/guardian-invites/${invite.token}/accept`)
      .set(cookieHeader(parent))
      .send({ consents: ["PARTICIPATION", "DATA_SHARING"] });
    expect(accept.status).toBe(200);
    expect(accept.body.link.status).toBe("VERIFIED");

    const reuse = await request(app.server)
      .post(`/api/v1/guardian-invites/${invite.token}/accept`)
      .set(cookieHeader(parent))
      .send({ consents: [] });
    expect(reuse.status).toBe(409);
  });

  it("invite is bound to the invited email", async () => {
    const { app, coach, teamId, athlete, parent } = await setup();
    const other = await registerUser("PARENT", "gother");

    const invite = await inviteGuardian(coach, teamId, athlete.id, parent.email);

    const stolen = await request(app.server)
      .post(`/api/v1/guardian-invites/${invite.token}/accept`)
      .set(cookieHeader(other))
      .send({ consents: [] });
    expect(stolen.status).toBe(403);
  });

  it("coach views guardians + consents; runner cannot", async () => {
    const { app, coach, teamId, athlete, parent } = await setup();
    const invite = await inviteGuardian(coach, teamId, athlete.id, parent.email);
    await request(app.server)
      .post(`/api/v1/guardian-invites/${invite.token}/accept`)
      .set(cookieHeader(parent))
      .send({ consents: ["PARTICIPATION"] });

    const view = await request(app.server)
      .get(`/api/v1/teams/${teamId}/athletes/${athlete.id}/guardians`)
      .set(cookieHeader(coach));
    expect(view.status).toBe(200);
    expect(view.body.guardians).toHaveLength(1);
    expect(view.body.guardians[0].guardianEmail).toBe(parent.email);
    expect(view.body.consents).toHaveLength(1);
    expect(view.body.consents[0].type).toBe("PARTICIPATION");

    const blocked = await request(app.server)
      .get(`/api/v1/teams/${teamId}/athletes/${athlete.id}/guardians`)
      .set(cookieHeader(athlete));
    expect(blocked.status).toBe(403);
  });

  it("parent sees linked children with assignments and activities", async () => {
    const { app, coach, teamId, athlete, parent } = await setup();
    const invite = await inviteGuardian(coach, teamId, athlete.id, parent.email);
    await request(app.server)
      .post(`/api/v1/guardian-invites/${invite.token}/accept`)
      .set(cookieHeader(parent))
      .send({ consents: ["PARTICIPATION", "DATA_SHARING"] });

    // Athlete logs a run; coach assigns a workout.
    await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(athlete))
      .send({
        kind: "RUN",
        startedAt: "2026-09-18T13:00:00Z",
        distanceM: 5000,
        durationS: 1500,
        teamId,
        visibility: "TEAM",
      });
    const workoutRes = await request(app.server)
      .post(`/api/v1/teams/${teamId}/workouts`)
      .set(cookieHeader(coach))
      .send({
        title: "Easy run",
        steps: [{ kind: "STEADY", distanceM: 3000 }],
      });
    await request(app.server)
      .post(`/api/v1/teams/${teamId}/assignments`)
      .set(cookieHeader(coach))
      .send({
        workoutId: workoutRes.body.workout.id,
        assignedToUserId: athlete.id,
        scheduledDate: "2026-10-20",
      });

    const children = await request(app.server)
      .get("/api/v1/users/me/children")
      .set(cookieHeader(parent));
    expect(children.status).toBe(200);
    expect(children.body.children).toHaveLength(1);
    const child = children.body.children[0];
    expect(child.athleteName).toBeDefined();
    expect(child.consentRequired).toBe(true); // no DOB → conservative
    expect(child.consents).toHaveLength(2);
    expect(child.upcomingAssignments).toHaveLength(1);
    expect(child.recentActivities).toHaveLength(1);
  });

  it("guardian can unlink themselves; coach can revoke", async () => {
    const { app, coach, teamId, athlete, parent } = await setup();
    const invite = await inviteGuardian(coach, teamId, athlete.id, parent.email);
    const accepted = await request(app.server)
      .post(`/api/v1/guardian-invites/${invite.token}/accept`)
      .set(cookieHeader(parent))
      .send({ consents: ["PARTICIPATION"] });
    const linkId = accepted.body.link.id;

    // Consents are revoked along with the link.
    const revoke = await request(app.server)
      .delete(`/api/v1/guardian-links/${linkId}`)
      .set(cookieHeader(parent));
    expect(revoke.status).toBe(200);

    const view = await request(app.server)
      .get(`/api/v1/teams/${teamId}/athletes/${athlete.id}/guardians`)
      .set(cookieHeader(coach));
    expect(view.body.guardians).toHaveLength(0);
    expect(view.body.consents).toHaveLength(0);

    const children = await request(app.server)
      .get("/api/v1/users/me/children")
      .set(cookieHeader(parent));
    expect(children.body.children).toHaveLength(0);
  });

  it("rejects duplicate invites and self-invites", async () => {
    const { app, coach, teamId, athlete, parent } = await setup();

    await inviteGuardian(coach, teamId, athlete.id, parent.email);
    const dupe = await request(app.server)
      .post(`/api/v1/teams/${teamId}/athletes/${athlete.id}/guardians/invite`)
      .set(cookieHeader(coach))
      .send({ email: parent.email });
    expect(dupe.status).toBe(409);

    const self = await request(app.server)
      .post(`/api/v1/teams/${teamId}/athletes/${athlete.id}/guardians/invite`)
      .set(cookieHeader(coach))
      .send({ email: athlete.email });
    expect(self.status).toBe(422);
  });
});
