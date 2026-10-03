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

async function notificationsFor(user: TestUser) {
  const app = await getApp();
  const res = await request(app.server)
    .get("/api/v1/notifications")
    .set(cookieHeader(user));
  expect(res.status).toBe(200);
  return res.body.notifications as {
    type: string;
    title: string;
    link: string | null;
  }[];
}

async function promote(
  app: Awaited<ReturnType<typeof getApp>>,
  owner: TestUser,
  teamId: string,
  userId: string,
  role: string,
) {
  const res = await request(app.server)
    .patch(`/api/v1/teams/${teamId}/members/${userId}`)
    .set(cookieHeader(owner))
    .send({ role });
  expect(res.status).toBe(200);
}

describe("event notifications", () => {
  beforeEach(truncate);

  it("check-in message notifies other participants, not the author", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "ncoach");
    const teamId = await createTeamAs(coach, "Notify Team");
    // Adult runner: coach+runner-only channel, no guardian needed.
    const runnerRes = await request(app.server)
      .post("/api/v1/auth/register")
      .send({
        email: "nrunner1@example.com",
        password: "password123",
        displayName: "Nina Runner",
        role: "RUNNER",
        dateOfBirth: "1990-01-01",
      });
    const runner: TestUser = {
      id: runnerRes.body.user.id,
      email: "nrunner1@example.com",
      cookies: runnerRes.headers["set-cookie"] as string[],
    };
    await addRunnerToTeam(coach, teamId, runner);

    const ci = await request(app.server)
      .post(`/api/v1/teams/${teamId}/check-ins`)
      .set(cookieHeader(runner))
      .send({ coachId: coach.id, runnerId: runner.id });
    expect(ci.status).toBe(201);
    const convId = ci.body.checkIn.id;

    const post = await request(app.server)
      .post(`/api/v1/teams/${teamId}/conversations/${convId}/messages`)
      .set(cookieHeader(runner))
      .send({ body: "My knee hurt after yesterday's run." });
    expect(post.status).toBe(201);

    // Coach gets the notification; the author does not.
    const coachNotes = await notificationsFor(coach);
    expect(
      coachNotes.filter((n) => n.type === "CHECK_IN_MESSAGE"),
    ).toHaveLength(1);
    expect(coachNotes[0].title).toMatch(/Nina Runner/);
    expect(coachNotes[0].link).toBe(`/teams/${teamId}/messages`);

    const runnerNotes = await notificationsFor(runner);
    expect(
      runnerNotes.filter((n) => n.type === "CHECK_IN_MESSAGE"),
    ).toHaveLength(0);
  });

  it("check-in @mention does not double-notify", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "mcoach");
    const teamId = await createTeamAs(coach, "Mention Team");
    const runnerRes = await request(app.server)
      .post("/api/v1/auth/register")
      .send({
        email: "mrunner1@example.com",
        password: "password123",
        displayName: "Mia Runner",
        role: "RUNNER",
        dateOfBirth: "1990-01-01",
      });
    const runner: TestUser = {
      id: runnerRes.body.user.id,
      email: "mrunner1@example.com",
      cookies: runnerRes.headers["set-cookie"] as string[],
    };
    await addRunnerToTeam(coach, teamId, runner);

    const ci = await request(app.server)
      .post(`/api/v1/teams/${teamId}/check-ins`)
      .set(cookieHeader(runner))
      .send({ coachId: coach.id, runnerId: runner.id });
    const convId = ci.body.checkIn.id;

    // Need the coach's display name for the @mention.
    const coachMe = await request(app.server)
      .get("/api/v1/auth/me")
      .set(cookieHeader(coach));
    const coachName = coachMe.body.user.displayName as string;

    const post = await request(app.server)
      .post(`/api/v1/teams/${teamId}/conversations/${convId}/messages`)
      .set(cookieHeader(runner))
      .send({ body: `@${coachName} can we talk about my training?` });
    expect(post.status).toBe(201);

    // Exactly one notification total for the coach (the mention one).
    const coachNotes = await notificationsFor(coach);
    expect(coachNotes).toHaveLength(1);
    expect(coachNotes[0].type).toBe("MENTION");
  });

  it("injury report notifies coaches only — not the reporter, admins, or runners", async () => {
    const app = await getApp();
    const coach1 = await registerUser("COACH", "icoach1");
    const coach2 = await registerUser("COACH", "icoach2");
    const teamId = await createTeamAs(coach1, "Injury Team");
    await addRunnerToTeam(coach1, teamId, coach2);
    await promote(app, coach1, teamId, coach2.id, "COACH");

    const admin = await registerUser("RUNNER", "iadmin");
    await addRunnerToTeam(coach1, teamId, admin);
    await promote(app, coach1, teamId, admin.id, "TEAM_ADMIN");

    const athlete = await registerUser("RUNNER", "iathlete");
    await addRunnerToTeam(coach1, teamId, athlete);
    const otherRunner = await registerUser("RUNNER", "iother");
    await addRunnerToTeam(coach1, teamId, otherRunner);

    // Coach1 reports an injury for the athlete.
    const rep = await request(app.server)
      .post(`/api/v1/teams/${teamId}/injuries`)
      .set(cookieHeader(coach1))
      .send({ athleteId: athlete.id, title: "Ankle sprain" });
    expect(rep.status).toBe(201);

    // Coach2 (not the reporter) is notified.
    const c2Notes = await notificationsFor(coach2);
    const injuryNotes = c2Notes.filter((n) => n.type === "INJURY_REPORTED");
    expect(injuryNotes).toHaveLength(1);
    expect(injuryNotes[0].link).toBe(`/teams/${teamId}/coaching`);

    // Reporter, team admin, athlete, and other runners get nothing.
    for (const u of [coach1, admin, athlete, otherRunner]) {
      const notes = await notificationsFor(u);
      expect(
        notes.filter((n) => n.type === "INJURY_REPORTED"),
      ).toHaveLength(0);
    }
  });

  it("injury report notifies the athlete's verified guardians", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "gcoach");
    const teamId = await createTeamAs(coach, "Guardian Notify Team");
    const athlete = await registerUser("RUNNER", "gathlete");
    await addRunnerToTeam(coach, teamId, athlete);
    const guardian = await registerUser("RUNNER", "gguardian");

    // Coach invites the guardian; guardian accepts with consents → VERIFIED.
    const invite = await request(app.server)
      .post(`/api/v1/teams/${teamId}/athletes/${athlete.id}/guardians/invite`)
      .set(cookieHeader(coach))
      .send({ email: guardian.email, relationship: "parent" });
    expect(invite.status).toBe(201);
    const accept = await request(app.server)
      .post(`/api/v1/guardian-invites/${invite.body.invite.token}/accept`)
      .set(cookieHeader(guardian))
      .send({ consents: ["PARTICIPATION", "DATA_SHARING"] });
    expect(accept.status).toBe(200);

    // Coach reports an injury for the athlete.
    const rep = await request(app.server)
      .post(`/api/v1/teams/${teamId}/injuries`)
      .set(cookieHeader(coach))
      .send({ athleteId: athlete.id, title: "Knee pain" });
    expect(rep.status).toBe(201);

    const gNotes = await notificationsFor(guardian);
    const gInjury = gNotes.filter((n) => n.type === "INJURY_REPORTED");
    expect(gInjury).toHaveLength(1);
    expect(gInjury[0].link).toBe("/family");
  });

  it("athlete self-report notifies all team coaches", async () => {
    const app = await getApp();
    const coach1 = await registerUser("COACH", "scoach1");
    const coach2 = await registerUser("COACH", "scoach2");
    const teamId = await createTeamAs(coach1, "Self Report Team");
    await addRunnerToTeam(coach1, teamId, coach2);
    await promote(app, coach1, teamId, coach2.id, "COACH");
    const athlete = await registerUser("RUNNER", "sathlete");
    await addRunnerToTeam(coach1, teamId, athlete);

    const rep = await request(app.server)
      .post(`/api/v1/teams/${teamId}/injuries`)
      .set(cookieHeader(athlete))
      .send({ athleteId: athlete.id, title: "Shin splints" });
    expect(rep.status).toBe(201);

    for (const c of [coach1, coach2]) {
      const notes = await notificationsFor(c);
      expect(
        notes.filter((n) => n.type === "INJURY_REPORTED"),
      ).toHaveLength(1);
    }
    // The athlete doesn't notify themselves.
    const athleteNotes = await notificationsFor(athlete);
    expect(
      athleteNotes.filter((n) => n.type === "INJURY_REPORTED"),
    ).toHaveLength(0);
  });
});
