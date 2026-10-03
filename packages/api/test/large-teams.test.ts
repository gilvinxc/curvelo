import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  getApp,
  registerUser,
  truncate,
  cookieHeader,
  createTeamAs,
  addRunnerToTeam,
  createWorkoutAs,
  type TestUser,
} from "./helpers.js";

let counter = 0;

async function registerAdultRunner(prefix: string): Promise<TestUser> {
  counter += 1;
  const app = await getApp();
  const email = `${prefix}${counter}@example.com`;
  const res = await request(app.server).post("/api/v1/auth/register").send({
    email,
    password: "supersecretpassword",
    displayName: `${prefix} ${counter}`,
    role: "RUNNER",
    dateOfBirth: "1990-01-01",
  });
  if (res.status !== 201) throw new Error(`register adult failed: ${res.status}`);
  return { id: res.body.user.id as string, email, cookies: res.headers["set-cookie"] as string[] };
}

async function addCoachToTeam(owner: TestUser, teamId: string, coach: TestUser) {
  const app = await getApp();
  const invite = await request(app.server)
    .post(`/api/v1/teams/${teamId}/invitations`)
    .set(cookieHeader(owner))
    .send({ email: coach.email, role: "COACH" });
  if (invite.status !== 201) throw new Error("coach invite failed");
  const accept = await request(app.server)
    .post(`/api/v1/invitations/${invite.body.invitation.token}/accept`)
    .set(cookieHeader(coach));
  if (accept.status !== 200) throw new Error("coach accept failed");
}

async function createGroup(coach: TestUser, teamId: string, name: string, memberIds: string[] = []) {
  const app = await getApp();
  const res = await request(app.server)
    .post(`/api/v1/teams/${teamId}/groups`)
    .set(cookieHeader(coach))
    .send({ name, memberIds });
  if (res.status !== 201) throw new Error(`createGroup failed: ${res.status}`);
  return res.body.group as { id: string };
}

async function setup() {
  const app = await getApp();
  const owner = await registerUser("COACH", "lt-owner");
  const assistant = await registerUser("COACH", "lt-assistant");
  const plainCoach = await registerUser("COACH", "lt-plaincoach");
  const runner1 = await registerAdultRunner("lt-runner1");
  const runner2 = await registerAdultRunner("lt-runner2");
  const runner3 = await registerAdultRunner("lt-runner3");
  const outsider = await registerUser("RUNNER", "lt-outsider");
  const teamId = await createTeamAs(owner, "Big Program");
  await addCoachToTeam(owner, teamId, assistant);
  await addCoachToTeam(owner, teamId, plainCoach);
  await addRunnerToTeam(owner, teamId, runner1);
  await addRunnerToTeam(owner, teamId, runner2);
  await addRunnerToTeam(owner, teamId, runner3);
  const groupA = await createGroup(owner, teamId, "Distance", [runner1.id, runner2.id]);
  const groupB = await createGroup(owner, teamId, "Sprints", [runner3.id]);
  return { app, owner, assistant, plainCoach, runner1, runner2, runner3, outsider, teamId, groupA, groupB };
}

async function setLeader(owner: TestUser, groupId: string, leaderId: string | null) {
  const app = await getApp();
  return request(app.server)
    .put(`/api/v1/groups/${groupId}/leader`)
    .set(cookieHeader(owner))
    .send({ leaderId });
}

describe("large teams: group leaders", () => {
  beforeEach(truncate);

  it("owner assigns a leader; non-owner is denied; runner cannot lead", async () => {
    const { app, owner, assistant, runner1, groupA } = await setup();

    const res = await setLeader(owner, groupA.id, assistant.id);
    expect(res.status).toBe(200);
    expect(res.body.group.leaderId).toBe(assistant.id);
    expect(res.body.group.leaderName).toBeTruthy();

    // Non-owner coach cannot assign.
    const denied = await request(app.server)
      .put(`/api/v1/groups/${groupA.id}/leader`)
      .set(cookieHeader(assistant))
      .send({ leaderId: assistant.id });
    expect(denied.status).toBe(403);

    // A runner cannot be a leader.
    const bad = await setLeader(owner, groupA.id, runner1.id);
    expect(bad.status).toBe(400);

    // Remove the leader.
    const removed = await setLeader(owner, groupA.id, null);
    expect(removed.status).toBe(200);
    expect(removed.body.group.leaderId).toBeNull();
  });

  it("leader manages their own group but not another group", async () => {
    const { app, owner, assistant, runner3, groupA, groupB } = await setup();
    await setLeader(owner, groupA.id, assistant.id);

    // Own group: allowed.
    const ok = await request(app.server)
      .post(`/api/v1/groups/${groupA.id}/members`)
      .set(cookieHeader(assistant))
      .send({ memberIds: [runner3.id] });
    expect(ok.status).toBe(200);

    const rm = await request(app.server)
      .delete(`/api/v1/groups/${groupA.id}/members/${runner3.id}`)
      .set(cookieHeader(assistant));
    expect(rm.status).toBe(200);

    // Another group: denied even though they are a COACH.
    const denied = await request(app.server)
      .post(`/api/v1/groups/${groupB.id}/members`)
      .set(cookieHeader(assistant))
      .send({ memberIds: [runner3.id] });
    expect(denied.status).toBe(403);

    const deniedRm = await request(app.server)
      .delete(`/api/v1/groups/${groupB.id}/members/${runner3.id}`)
      .set(cookieHeader(assistant));
    expect(deniedRm.status).toBe(403);
  });

  it("non-leader coaches and the owner keep full group powers", async () => {
    const { app, owner, plainCoach, runner1, groupA, groupB } = await setup();
    // Neither the owner nor plainCoach leads any group: full access everywhere.
    const addA = await request(app.server)
      .post(`/api/v1/groups/${groupA.id}/members`)
      .set(cookieHeader(plainCoach))
      .send({ memberIds: [runner1.id] });
    expect(addA.status).toBe(200);
    const addB = await request(app.server)
      .post(`/api/v1/groups/${groupB.id}/members`)
      .set(cookieHeader(plainCoach))
      .send({ memberIds: [runner1.id] });
    expect(addB.status).toBe(200);
    const addOwner = await request(app.server)
      .post(`/api/v1/groups/${groupB.id}/members`)
      .set(cookieHeader(owner))
      .send({ memberIds: [runner1.id] });
    expect(addOwner.status).toBe(200);
  });

  it("leader posts announcements to their own group only", async () => {
    const { app, owner, assistant, groupA, groupB, teamId } = await setup();
    await setLeader(owner, groupA.id, assistant.id);

    const ok = await request(app.server)
      .post(`/api/v1/groups/${groupA.id}/announcements`)
      .set(cookieHeader(assistant))
      .send({ body: "Distance crew: meet at the track at 6am" });
    expect(ok.status).toBe(201);

    const denied = await request(app.server)
      .post(`/api/v1/groups/${groupB.id}/announcements`)
      .set(cookieHeader(assistant))
      .send({ body: "Sprinters: you are not mine" });
    expect(denied.status).toBe(403);

    // Message landed in group A's conversation.
    const convs = await request(app.server)
      .get(`/api/v1/teams/${teamId}/conversations`)
      .set(cookieHeader(assistant));
    const groupConv = convs.body.conversations.find((c: { groupId: string }) => c.groupId === groupA.id);
    const msgs = await request(app.server)
      .get(`/api/v1/teams/${teamId}/conversations/${groupConv.id}/messages`)
      .set(cookieHeader(assistant));
    expect(msgs.body.messages.some((m: { body: string }) => m.body.includes("6am"))).toBe(true);
  });

  it("group digest is scoped to the leader's group", async () => {
    const { app, owner, assistant, groupA, groupB } = await setup();
    await setLeader(owner, groupA.id, assistant.id);

    const digest = await request(app.server)
      .get(`/api/v1/groups/${groupA.id}/digest`)
      .set(cookieHeader(assistant));
    expect(digest.status).toBe(200);
    const ids = digest.body.digest.athletes.map((a: { athleteId: string }) => a.athleteId);
    // Group A has runner1 + runner2 only.
    expect(ids).toHaveLength(2);

    const denied = await request(app.server)
      .get(`/api/v1/groups/${groupB.id}/digest`)
      .set(cookieHeader(assistant));
    expect(denied.status).toBe(403);

    // A manager still gets the team-wide digest elsewhere; group digest works for them too.
    const mgr = await request(app.server)
      .get(`/api/v1/groups/${groupB.id}/digest`)
      .set(cookieHeader(owner));
    expect(mgr.status).toBe(200);
  });

  it("outsider cannot touch any of it", async () => {
    const { app, outsider, groupA } = await setup();
    const res = await request(app.server)
      .get(`/api/v1/groups/${groupA.id}/digest`)
      .set(cookieHeader(outsider));
    expect([403, 404]).toContain(res.status);
  });
});

describe("large teams: bulk assignment", () => {
  beforeEach(truncate);

  it("assigns to many athletes, validates all IDs first", async () => {
    const { app, owner, runner1, runner2, runner3, teamId } = await setup();
    const workout = await createWorkoutAs(owner, teamId);

    const res = await request(app.server)
      .post(`/api/v1/teams/${teamId}/assignments/bulk`)
      .set(cookieHeader(owner))
      .send({
        workoutId: workout.id,
        athleteIds: [runner1.id, runner2.id, runner3.id],
        scheduledDate: "2026-10-10",
        notes: "Easy day",
      });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(3);
    expect(res.body.skipped).toHaveLength(0);
  });

  it("rejects invalid and non-runner IDs, reports them", async () => {
    const { app, owner, runner1, plainCoach, teamId } = await setup();
    const workout = await createWorkoutAs(owner, teamId);

    const res = await request(app.server)
      .post(`/api/v1/teams/${teamId}/assignments/bulk`)
      .set(cookieHeader(owner))
      .send({
        workoutId: workout.id,
        athleteIds: [runner1.id, plainCoach.id, "00000000-0000-0000-0000-000000000000"],
        scheduledDate: "2026-10-10",
      });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(1);
    expect(res.body.skipped).toHaveLength(2);
  });

  it("runner cannot bulk assign", async () => {
    const { app, owner, runner1, runner2, teamId } = await setup();
    const workout = await createWorkoutAs(owner, teamId);
    const res = await request(app.server)
      .post(`/api/v1/teams/${teamId}/assignments/bulk`)
      .set(cookieHeader(runner1))
      .send({ workoutId: workout.id, athleteIds: [runner2.id], scheduledDate: "2026-10-10" });
    expect(res.status).toBe(403);
  });

  it("group leader can only bulk-assign their own groups", async () => {
    const { app, owner, assistant, runner1, runner3, teamId, groupA } = await setup();
    const workout = await createWorkoutAs(owner, teamId);
    await setLeader(owner, groupA.id, assistant.id);

    const res = await request(app.server)
      .post(`/api/v1/teams/${teamId}/assignments/bulk`)
      .set(cookieHeader(assistant))
      .send({
        workoutId: workout.id,
        athleteIds: [runner1.id, runner3.id],
        scheduledDate: "2026-10-10",
      });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(1); // runner1 in Distance; runner3 skipped
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0].reason).toMatch(/your groups/i);
  });
});

describe("large teams: bulk messaging", () => {
  beforeEach(truncate);

  it("sends to multiple groups at once", async () => {
    const { app, owner, teamId, groupA, groupB } = await setup();
    const res = await request(app.server)
      .post(`/api/v1/teams/${teamId}/messages/bulk`)
      .set(cookieHeader(owner))
      .send({ groupIds: [groupA.id, groupB.id], body: "Practice moved to 5pm" });
    expect(res.status).toBe(201);
    expect(res.body.sentToGroups).toHaveLength(2);
    expect(res.body.sentToAthletes).toHaveLength(0);

    const convs = await request(app.server)
      .get(`/api/v1/teams/${teamId}/conversations`)
      .set(cookieHeader(owner));
    for (const gid of [groupA.id, groupB.id]) {
      const conv = convs.body.conversations.find((c: { groupId: string }) => c.groupId === gid);
      const msgs = await request(app.server)
        .get(`/api/v1/teams/${teamId}/conversations/${conv.id}/messages`)
        .set(cookieHeader(owner));
      expect(msgs.body.messages.some((m: { body: string }) => m.body.includes("5pm"))).toBe(true);
    }
  });

  it("sends to athletes via check-in threads", async () => {
    const { app, owner, runner1, runner2, teamId } = await setup();
    const res = await request(app.server)
      .post(`/api/v1/teams/${teamId}/messages/bulk`)
      .set(cookieHeader(owner))
      .send({ athleteIds: [runner1.id, runner2.id], body: "Great race yesterday" });
    expect(res.status).toBe(201);
    expect(res.body.sentToAthletes).toHaveLength(2);

    // Check-in threads exist for the coach.
    const checkIns = await request(app.server)
      .get(`/api/v1/teams/${teamId}/check-ins`)
      .set(cookieHeader(owner));
    expect(checkIns.body.checkIns.length).toBeGreaterThanOrEqual(2);
  });

  it("leader is scoped to their groups for bulk messaging", async () => {
    const { app, owner, assistant, teamId, groupA, groupB } = await setup();
    await setLeader(owner, groupA.id, assistant.id);
    const res = await request(app.server)
      .post(`/api/v1/teams/${teamId}/messages/bulk`)
      .set(cookieHeader(assistant))
      .send({ groupIds: [groupA.id, groupB.id], body: "Hello" });
    expect(res.status).toBe(201);
    expect(res.body.sentToGroups).toEqual([groupA.id]);
    expect(res.body.skipped).toHaveLength(1);
  });

  it("runner cannot bulk message", async () => {
    const { app, runner1, teamId, groupA } = await setup();
    const res = await request(app.server)
      .post(`/api/v1/teams/${teamId}/messages/bulk`)
      .set(cookieHeader(runner1))
      .send({ groupIds: [groupA.id], body: "Hi" });
    expect(res.status).toBe(403);
  });
});

describe("large teams: attendance", () => {
  beforeEach(truncate);

  it("coach takes attendance; history shows % present", async () => {
    const { app, owner, runner1, runner2, runner3, teamId } = await setup();

    const saved = await request(app.server)
      .post(`/api/v1/teams/${teamId}/attendance`)
      .set(cookieHeader(owner))
      .send({
        date: "2026-10-03",
        records: { [runner1.id]: true, [runner2.id]: true, [runner3.id]: false },
      });
    expect(saved.status).toBe(201);
    expect(saved.body.attendance.presentCount).toBe(2);
    expect(saved.body.attendance.absentCount).toBe(1);
    expect(saved.body.attendance.presentPct).toBe(67);

    const history = await request(app.server)
      .get(`/api/v1/teams/${teamId}/attendance`)
      .set(cookieHeader(owner));
    expect(history.status).toBe(200);
    expect(history.body.attendance).toHaveLength(1);
    expect(history.body.attendance[0].presentPct).toBe(67);

    const detail = await request(app.server)
      .get(`/api/v1/teams/${teamId}/attendance/${saved.body.attendance.id}`)
      .set(cookieHeader(owner));
    expect(detail.status).toBe(200);
    expect(detail.body.attendance.members).toHaveLength(3);
    const absent = detail.body.attendance.members.find(
      (m: { userId: string }) => m.userId === runner3.id,
    );
    expect(absent.present).toBe(false);
  });

  it("re-taking attendance for the same date updates it", async () => {
    const { app, owner, runner1, runner2, teamId } = await setup();
    const payload = (r1: boolean, r2: boolean) => ({
      date: "2026-10-03",
      records: { [runner1.id]: r1, [runner2.id]: r2 },
    });
    await request(app.server).post(`/api/v1/teams/${teamId}/attendance`).set(cookieHeader(owner)).send(payload(true, false));
    const again = await request(app.server).post(`/api/v1/teams/${teamId}/attendance`).set(cookieHeader(owner)).send(payload(true, true));
    expect(again.status).toBe(201);
    expect(again.body.attendance.presentCount).toBe(2);

    const history = await request(app.server).get(`/api/v1/teams/${teamId}/attendance`).set(cookieHeader(owner));
    expect(history.body.attendance).toHaveLength(1);
  });

  it("rejects non-members and denies runners", async () => {
    const { app, owner, runner1, outsider, teamId } = await setup();
    const bad = await request(app.server)
      .post(`/api/v1/teams/${teamId}/attendance`)
      .set(cookieHeader(owner))
      .send({ date: "2026-10-03", records: { [outsider.id]: true } });
    expect(bad.status).toBe(422);

    const denied = await request(app.server)
      .get(`/api/v1/teams/${teamId}/attendance`)
      .set(cookieHeader(runner1));
    expect(denied.status).toBe(403);
  });
});
