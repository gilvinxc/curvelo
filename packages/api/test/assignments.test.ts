import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { getApp, registerUser, truncate, cookieHeader, TestUser } from "./helpers.js";
import { db } from "../src/db.js";
import { createTeamAs, createWorkoutAs } from "./workouts.test.js";

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

async function setup() {
  const app = await getApp();
  const coach = await registerUser("COACH", "acoach");
  const teamId = await createTeamAs(coach, "Assign Team");
  const workout = await createWorkoutAs(coach, teamId);
  const r1 = await registerUser("RUNNER", "ar1");
  const r2 = await registerUser("RUNNER", "ar2");
  await addRunnerToTeam(coach, teamId, r1);
  await addRunnerToTeam(coach, teamId, r2);
  return { app, coach, teamId, workout, r1, r2 };
}

describe("assignments", () => {
  beforeEach(truncate);

  it("coach assigns to the whole team, an individual, and a group", async () => {
    const { app, coach, teamId, workout, r1 } = await setup();

    const teamWide = await request(app.server)
      .post(`/api/v1/teams/${teamId}/assignments`)
      .set(cookieHeader(coach))
      .send({ workoutId: workout.id, scheduledDate: "2026-10-20" });
    expect(teamWide.status).toBe(201);
    expect(teamWide.body.assignment.assignedToUserId).toBeNull();
    expect(teamWide.body.assignment.groupId).toBeNull();

    const individual = await request(app.server)
      .post(`/api/v1/teams/${teamId}/assignments`)
      .set(cookieHeader(coach))
      .send({ workoutId: workout.id, assignedToUserId: r1.id, scheduledDate: "2026-10-21" });
    expect(individual.status).toBe(201);
    expect(individual.body.assignment.assignedToName).toBeDefined();

    const group = await request(app.server)
      .post(`/api/v1/teams/${teamId}/groups`)
      .set(cookieHeader(coach))
      .send({ name: "Sprinters", memberIds: [r1.id] });
    const groupAssign = await request(app.server)
      .post(`/api/v1/teams/${teamId}/assignments`)
      .set(cookieHeader(coach))
      .send({ workoutId: workout.id, groupId: group.body.group.id, scheduledDate: "2026-10-22" });
    expect(groupAssign.status).toBe(201);
    expect(groupAssign.body.assignment.groupName).toBe("Sprinters");
  });

  it("runner cannot create assignments; group+individual together is rejected", async () => {
    const { app, coach, teamId, workout, r1, r2 } = await setup();

    const forbidden = await request(app.server)
      .post(`/api/v1/teams/${teamId}/assignments`)
      .set(cookieHeader(r1))
      .send({ workoutId: workout.id, scheduledDate: "2026-10-20" });
    expect(forbidden.status).toBe(403);

    const group = await request(app.server)
      .post(`/api/v1/teams/${teamId}/groups`)
      .set(cookieHeader(coach))
      .send({ name: "G2", memberIds: [] });

    const both = await request(app.server)
      .post(`/api/v1/teams/${teamId}/assignments`)
      .set(cookieHeader(coach))
      .send({
        workoutId: workout.id,
        groupId: group.body.group.id,
        assignedToUserId: r2.id,
        scheduledDate: "2026-10-20",
      });
    expect(both.status).toBe(400);
  });

  it("cannot assign to someone not on the team", async () => {
    const { app, coach, teamId, workout } = await setup();
    const outsider = await registerUser("RUNNER", "aout");

    const res = await request(app.server)
      .post(`/api/v1/teams/${teamId}/assignments`)
      .set(cookieHeader(coach))
      .send({ workoutId: workout.id, assignedToUserId: outsider.id, scheduledDate: "2026-10-20" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("INVALID_ASSIGNEE");
  });

  it("calendar scoping: coach sees all, runner sees own + team-wide", async () => {
    const { app, coach, teamId, workout, r1, r2 } = await setup();
    const auth = (u: TestUser) => cookieHeader(u);
    const post = (body: object, as: TestUser = coach) =>
      request(app.server).post(`/api/v1/teams/${teamId}/assignments`).set(auth(as)).send(body);

    await post({ workoutId: workout.id, scheduledDate: "2026-11-01" }); // team-wide
    await post({ workoutId: workout.id, assignedToUserId: r1.id, scheduledDate: "2026-11-02" });
    await post({ workoutId: workout.id, assignedToUserId: r2.id, scheduledDate: "2026-11-03" });

    const coachCal = await request(app.server)
      .get(`/api/v1/teams/${teamId}/calendar?from=2026-11-01&to=2026-11-30`)
      .set(auth(coach));
    expect(coachCal.body.assignments).toHaveLength(3);

    const r1Cal = await request(app.server)
      .get(`/api/v1/teams/${teamId}/calendar?from=2026-11-01&to=2026-11-30`)
      .set(auth(r1));
    expect(r1Cal.body.assignments).toHaveLength(2); // team-wide + own

    const mine = await request(app.server)
      .get(`/api/v1/users/me/calendar?from=2026-11-01&to=2026-11-30`)
      .set(auth(r1));
    expect(mine.body.assignments).toHaveLength(2);
  });

  it("compliance: dead-period BLOCK rule rejects the assignment", async () => {
    const { app, coach, teamId, workout } = await setup();

    await db.complianceRule.create({
      data: {
        name: "Winter dead period",
        teamId,
        appliesTo: "WORKOUT_ASSIGNMENT",
        startsAt: new Date("2026-12-20T00:00:00Z"),
        endsAt: new Date("2027-01-05T00:00:00Z"),
        action: "BLOCK",
      },
    });

    const blocked = await request(app.server)
      .post(`/api/v1/teams/${teamId}/assignments`)
      .set(cookieHeader(coach))
      .send({ workoutId: workout.id, scheduledDate: "2026-12-25" });
    expect(blocked.status).toBe(403);

    const allowed = await request(app.server)
      .post(`/api/v1/teams/${teamId}/assignments`)
      .set(cookieHeader(coach))
      .send({ workoutId: workout.id, scheduledDate: "2026-12-10" });
    expect(allowed.status).toBe(201);
    expect(allowed.body.assignment.needsApproval).toBe(false);
  });

  it("compliance: REQUIRE_APPROVAL flags the assignment", async () => {
    const { app, coach, teamId, workout } = await setup();

    await db.complianceRule.create({
      data: {
        name: "Holiday review period",
        teamId,
        appliesTo: "WORKOUT_ASSIGNMENT",
        startsAt: new Date("2026-12-20T00:00:00Z"),
        endsAt: new Date("2027-01-05T00:00:00Z"),
        action: "REQUIRE_APPROVAL",
      },
    });

    const res = await request(app.server)
      .post(`/api/v1/teams/${teamId}/assignments`)
      .set(cookieHeader(coach))
      .send({ workoutId: workout.id, scheduledDate: "2026-12-25" });
    expect(res.status).toBe(201);
    expect(res.body.assignment.needsApproval).toBe(true);
  });
});
