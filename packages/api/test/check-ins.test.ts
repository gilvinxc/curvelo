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

let counter = 1000;

async function registerMinorRunner(emailPrefix: string): Promise<TestUser> {
  const app = await getApp();
  counter += 1;
  const email = `${emailPrefix}${counter}@example.com`;
  const res = await request(app.server).post("/api/v1/auth/register").send({
    email,
    password: "supersecretpassword",
    displayName: `${emailPrefix} ${counter}`,
    role: "RUNNER",
    dateOfBirth: "2012-06-15", // minor
  });
  if (res.status !== 201) throw new Error(`register minor failed: ${res.status}`);
  const cookies = res.headers["set-cookie"] as string[];
  return { id: res.body.user.id, email, cookies };
}

async function registerAdultRunner(emailPrefix: string): Promise<TestUser> {
  const app = await getApp();
  counter += 1;
  const email = `${emailPrefix}${counter}@example.com`;
  const res = await request(app.server).post("/api/v1/auth/register").send({
    email,
    password: "supersecretpassword",
    displayName: `${emailPrefix} ${counter}`,
    role: "RUNNER",
    dateOfBirth: "1990-01-01", // adult
  });
  if (res.status !== 201) throw new Error(`register adult failed: ${res.status}`);
  const cookies = res.headers["set-cookie"] as string[];
  return { id: res.body.user.id, email, cookies };
}

async function linkGuardian(
  coach: TestUser,
  teamId: string,
  athlete: TestUser,
  guardian: TestUser,
) {
  const app = await getApp();
  const invite = await request(app.server)
    .post(`/api/v1/teams/${teamId}/athletes/${athlete.id}/guardians/invite`)
    .set(cookieHeader(coach))
    .send({ email: guardian.email, relationship: "parent" });
  if (invite.status !== 201) throw new Error("guardian invite failed");
  const accept = await request(app.server)
    .post(`/api/v1/guardian-invites/${invite.body.invite.token}/accept`)
    .set(cookieHeader(guardian))
    .send({ consents: ["PARTICIPATION"] });
  if (![200, 201].includes(accept.status)) throw new Error("guardian accept failed");
}

async function setup() {
  const app = await getApp();
  const coach = await registerUser("COACH", "ccoach");
  const teamId = await createTeamAs(coach, "Check-in Team");
  const minorRunner = await registerMinorRunner("cminor");
  const adultRunner = await registerAdultRunner("cadult");
  const guardian = await registerUser("PARENT", "cguardian");
  const outsider = await registerUser("RUNNER", "coutsider");
  await addRunnerToTeam(coach, teamId, minorRunner);
  await addRunnerToTeam(coach, teamId, adultRunner);
  return { app, coach, teamId, minorRunner, adultRunner, guardian, outsider };
}

function postCheckIn(
  app: Awaited<ReturnType<typeof getApp>>,
  actor: TestUser,
  teamId: string,
  coachId: string,
  runnerId: string,
) {
  return request(app.server)
    .post(`/api/v1/teams/${teamId}/check-ins`)
    .set(cookieHeader(actor))
    .send({ coachId, runnerId });
}

describe("check-ins", () => {
  beforeEach(truncate);

  it("minor without a verified guardian cannot open a check-in", async () => {
    const { app, coach, teamId, minorRunner } = await setup();
    const res = await postCheckIn(app, minorRunner, teamId, coach.id, minorRunner.id);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/verified guardian/i);
  });

  it("minor with a verified guardian gets the guardian auto-added", async () => {
    const { app, coach, teamId, minorRunner, guardian } = await setup();
    await linkGuardian(coach, teamId, minorRunner, guardian);

    const res = await postCheckIn(app, minorRunner, teamId, coach.id, minorRunner.id);
    expect(res.status).toBe(201);
    expect(res.body.checkIn.guardianNames).toHaveLength(1);
    expect(res.body.checkIn.runnerName).toBeTruthy();
    expect(res.body.checkIn.coachName).toBeTruthy();

    // The guardian can read the channel…
    const read = await request(app.server)
      .get(`/api/v1/teams/${teamId}/conversations/${res.body.checkIn.id}/messages`)
      .set(cookieHeader(guardian));
    expect(read.status).toBe(200);

    // …and post in it.
    const post = await request(app.server)
      .post(`/api/v1/teams/${teamId}/conversations/${res.body.checkIn.id}/messages`)
      .set(cookieHeader(guardian))
      .send({ body: "Thanks coach, we'll work on that." });
    expect(post.status).toBe(201);

    // The guardian sees it in their check-in list.
    const list = await request(app.server)
      .get(`/api/v1/teams/${teamId}/check-ins`)
      .set(cookieHeader(guardian));
    expect(list.status).toBe(200);
    expect(list.body.checkIns).toHaveLength(1);
  });

  it("adult runner gets a coach+runner-only channel", async () => {
    const { app, coach, teamId, adultRunner, guardian } = await setup();
    const res = await postCheckIn(app, coach, teamId, coach.id, adultRunner.id);
    expect(res.status).toBe(201);
    expect(res.body.checkIn.guardianNames).toHaveLength(0);

    // An unrelated guardian cannot read it.
    const read = await request(app.server)
      .get(`/api/v1/teams/${teamId}/conversations/${res.body.checkIn.id}/messages`)
      .set(cookieHeader(guardian));
    expect(read.status).toBe(404);
  });

  it("outsiders and non-members cannot read or create check-ins", async () => {
    const { app, coach, teamId, minorRunner, guardian, outsider } = await setup();
    await linkGuardian(coach, teamId, minorRunner, guardian);
    const created = await postCheckIn(app, coach, teamId, coach.id, minorRunner.id);
    expect(created.status).toBe(201);
    const convId = created.body.checkIn.id;

    // Outsider can't list, read, or create.
    const list = await request(app.server)
      .get(`/api/v1/teams/${teamId}/check-ins`)
      .set(cookieHeader(outsider));
    expect(list.status).toBe(404);
    const read = await request(app.server)
      .get(`/api/v1/teams/${teamId}/conversations/${convId}/messages`)
      .set(cookieHeader(outsider));
    expect(read.status).toBe(404);
    const create = await postCheckIn(app, outsider, teamId, coach.id, minorRunner.id);
    expect([403, 404]).toContain(create.status);

    // Another runner on the team (not a participant) can't read it either.
    const other = await registerUser("RUNNER", "cother");
    await addRunnerToTeam(coach, teamId, other);
    const sneak = await request(app.server)
      .get(`/api/v1/teams/${teamId}/conversations/${convId}/messages`)
      .set(cookieHeader(other));
    expect(sneak.status).toBe(404);
  });

  it("duplicate create returns the same channel", async () => {
    const { app, coach, teamId, adultRunner } = await setup();
    const first = await postCheckIn(app, adultRunner, teamId, coach.id, adultRunner.id);
    expect(first.status).toBe(201);
    const second = await postCheckIn(app, coach, teamId, coach.id, adultRunner.id);
    expect(second.status).toBe(201);
    expect(second.body.checkIn.id).toBe(first.body.checkIn.id);
  });

  it("check-ins stay out of the general conversation list", async () => {
    const { app, coach, teamId, adultRunner } = await setup();
    await postCheckIn(app, coach, teamId, coach.id, adultRunner.id);
    const convs = await request(app.server)
      .get(`/api/v1/teams/${teamId}/conversations`)
      .set(cookieHeader(adultRunner));
    expect(convs.status).toBe(200);
    const kinds = convs.body.conversations.map((c: { kind: string }) => c.kind);
    expect(kinds).not.toContain("CHECK_IN");
  });

  it("status endpoint drives the runner UI", async () => {
    const { app, coach, teamId, minorRunner, adultRunner, guardian } = await setup();
    const minorStatus = await request(app.server)
      .get(`/api/v1/teams/${teamId}/check-ins/status`)
      .set(cookieHeader(minorRunner));
    expect(minorStatus.body.status).toMatchObject({
      isMinor: true,
      hasVerifiedGuardian: false,
      guardianRequired: true,
    });

    await linkGuardian(coach, teamId, minorRunner, guardian);
    const after = await request(app.server)
      .get(`/api/v1/teams/${teamId}/check-ins/status`)
      .set(cookieHeader(minorRunner));
    expect(after.body.status.guardianRequired).toBe(false);

    const adultStatus = await request(app.server)
      .get(`/api/v1/teams/${teamId}/check-ins/status`)
      .set(cookieHeader(adultRunner));
    expect(adultStatus.body.status).toMatchObject({
      isMinor: false,
      guardianRequired: false,
    });
  });
});
