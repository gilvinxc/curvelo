import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { getApp, registerUser, truncate, cookieHeader, TestUser, createTeamAs, createWorkoutAs, addRunnerToTeam } from "./helpers.js";

const RUN_BODY = {
  kind: "RUN",
  title: "Morning easy run",
  startedAt: "2026-09-18T13:00:00Z",
  distanceM: 8000,
  durationS: 2400,
  effortRpe: 4,
};

async function setup() {
  const app = await getApp();
  const coach = await registerUser("COACH", "lcoach");
  const teamId = await createTeamAs(coach, "Log Team");
  const workout = await createWorkoutAs(coach, teamId);
  const r1 = await registerUser("RUNNER", "lr1");
  const r2 = await registerUser("RUNNER", "lr2");
  await addRunnerToTeam(coach, teamId, r1);
  await addRunnerToTeam(coach, teamId, r2);
  return { app, coach, teamId, workout, r1, r2 };
}

describe("activities", () => {
  beforeEach(truncate);

  it("runner logs a run; pace is derived", async () => {
    const { app, coach, teamId, r1 } = await setup();
    const res = await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(r1))
      .send({ ...RUN_BODY, teamId });
    expect(res.status).toBe(201);
    const a = res.body.activity;
    expect(a.distanceM).toBe(8000);
    expect(a.avgPaceS).toBeCloseTo(300, 1); // 2400s / 8000m * 1000
    expect(a.visibility).toBe("TEAM"); // defaultShareLevel SUMMARY → TEAM
    expect(a.teamId).toBe(teamId);
  });

  it("rejects invalid activity payloads", async () => {
    const { app, r1 } = await setup();
    const post = (body: object) =>
      request(app.server).post("/api/v1/activities").set(cookieHeader(r1)).send(body);

    // no distance or duration
    const noMetrics = await post({ kind: "RUN", startedAt: "2026-09-18T13:00:00Z" });
    expect(noMetrics.status).toBe(400);

    // future activity
    const future = await post({ ...RUN_BODY, startedAt: "2030-01-01T00:00:00Z" });
    expect(future.status).toBe(400);

    // max HR below avg HR
    const badHr = await post({ ...RUN_BODY, avgHrBpm: 160, maxHrBpm: 150 });
    expect(badHr.status).toBe(400);
  });

  it("visibility defaults to PRIVATE when the user shares nothing", async () => {
    const { app, r1 } = await setup();
    await request(app.server)
      .patch("/api/v1/users/me")
      .set(cookieHeader(r1))
      .send({ defaultShareLevel: "NONE" });

    const res = await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(r1))
      .send(RUN_BODY);
    expect(res.status).toBe(201);
    expect(res.body.activity.visibility).toBe("PRIVATE");
  });

  it("logs against a team-wide assignment; rejects another athlete's assignment", async () => {
    const { app, coach, teamId, workout, r1, r2 } = await setup();
    const auth = (u: TestUser) => cookieHeader(u);

    const teamWide = await request(app.server)
      .post(`/api/v1/teams/${teamId}/assignments`)
      .set(auth(coach))
      .send({ workoutId: workout.id, scheduledDate: "2026-09-18" });

    const linked = await request(app.server)
      .post("/api/v1/activities")
      .set(auth(r1))
      .send({ ...RUN_BODY, assignmentId: teamWide.body.assignment.id });
    expect(linked.status).toBe(201);
    expect(linked.body.activity.assignmentId).toBe(teamWide.body.assignment.id);
    expect(linked.body.activity.teamId).toBe(teamId); // inherited from assignment

    const individual = await request(app.server)
      .post(`/api/v1/teams/${teamId}/assignments`)
      .set(auth(coach))
      .send({
        workoutId: workout.id,
        assignedToUserId: r2.id,
        scheduledDate: "2026-09-19",
      });

    const stolen = await request(app.server)
      .post("/api/v1/activities")
      .set(auth(r1))
      .send({ ...RUN_BODY, assignmentId: individual.body.assignment.id });
    expect(stolen.status).toBe(403);
  });

  it("activity privacy: coach sees TEAM, not PRIVATE; athletes see none of each other's", async () => {
    const { app, coach, teamId, r1, r2 } = await setup();
    const auth = (u: TestUser) => cookieHeader(u);

    const teamVisible = await request(app.server)
      .post("/api/v1/activities")
      .set(auth(r1))
      .send({ ...RUN_BODY, teamId, visibility: "TEAM" });
    const privateAct = await request(app.server)
      .post("/api/v1/activities")
      .set(auth(r1))
      .send({ ...RUN_BODY, teamId, visibility: "PRIVATE" });

    const coachSees = await request(app.server)
      .get(`/api/v1/activities/${teamVisible.body.activity.id}`)
      .set(auth(coach));
    expect(coachSees.status).toBe(200);

    const coachBlocked = await request(app.server)
      .get(`/api/v1/activities/${privateAct.body.activity.id}`)
      .set(auth(coach));
    expect(coachBlocked.status).toBe(404);

    const peerBlocked = await request(app.server)
      .get(`/api/v1/activities/${teamVisible.body.activity.id}`)
      .set(auth(r2));
    expect(peerBlocked.status).toBe(404);
  });

  it("only the owner can update or delete", async () => {
    const { app, coach, r1 } = await setup();
    const created = await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(r1))
      .send(RUN_BODY);

    const updated = await request(app.server)
      .patch(`/api/v1/activities/${created.body.activity.id}`)
      .set(cookieHeader(r1))
      .send({ effortRpe: 6, notes: "Felt strong" });
    expect(updated.status).toBe(200);
    expect(updated.body.activity.effortRpe).toBe(6);

    const coachEdit = await request(app.server)
      .patch(`/api/v1/activities/${created.body.activity.id}`)
      .set(cookieHeader(coach))
      .send({ effortRpe: 2 });
    expect(coachEdit.status).toBe(404);

    const deleted = await request(app.server)
      .delete(`/api/v1/activities/${created.body.activity.id}`)
      .set(cookieHeader(r1));
    expect(deleted.status).toBe(200);
  });

  it("stats aggregate distance and time", async () => {
    const { app, r1 } = await setup();
    const auth = cookieHeader(r1);
    await request(app.server).post("/api/v1/activities").set(auth).send(RUN_BODY);
    await request(app.server)
      .post("/api/v1/activities")
      .set(auth)
      .send({ ...RUN_BODY, startedAt: "2026-09-19T13:00:00Z", distanceM: 5000, durationS: 1500 });

    const stats = await request(app.server)
      .get("/api/v1/users/me/stats?from=2026-09-01&to=2026-09-30")
      .set(auth);
    expect(stats.status).toBe(200);
    expect(stats.body.stats).toMatchObject({
      count: 2,
      totalDistanceM: 13000,
      totalDurationS: 3900,
    });
    expect(stats.body.stats.avgPaceS).toBeCloseTo(300, 1);
  });

  it("coach athlete view: profile, stats, recent activities, upcoming assignments", async () => {
    const { app, coach, teamId, workout, r1 } = await setup();
    const auth = (u: TestUser) => cookieHeader(u);

    await request(app.server)
      .post("/api/v1/activities")
      .set(auth(r1))
      .send({ ...RUN_BODY, teamId, visibility: "TEAM" });
    await request(app.server)
      .post(`/api/v1/teams/${teamId}/assignments`)
      .set(auth(coach))
      .send({ workoutId: workout.id, scheduledDate: "2026-10-25" });

    const view = await request(app.server)
      .get(`/api/v1/teams/${teamId}/athletes/${r1.id}`)
      .set(auth(coach));
    expect(view.status).toBe(200);
    expect(view.body.athlete.displayName).toBeDefined();
    expect(view.body.athlete.stats.count).toBe(1);
    expect(view.body.athlete.recentActivities).toHaveLength(1);
    expect(view.body.athlete.upcomingAssignments).toHaveLength(1);

    const runnerBlocked = await request(app.server)
      .get(`/api/v1/teams/${teamId}/athletes/${r1.id}`)
      .set(auth(r1));
    expect(runnerBlocked.status).toBe(403);
  });

  it("calendars merge assignments with completed activities", async () => {
    const { app, coach, teamId, r1 } = await setup();
    const auth = (u: TestUser) => cookieHeader(u);

    await request(app.server)
      .post("/api/v1/activities")
      .set(auth(r1))
      .send({ ...RUN_BODY, teamId, visibility: "TEAM" });

    const teamCal = await request(app.server)
      .get(`/api/v1/teams/${teamId}/calendar?from=2026-09-01&to=2026-09-30`)
      .set(auth(coach));
    expect(teamCal.body.activities).toHaveLength(1);
    expect(teamCal.body.activities[0].userId).toBe(r1.id);

    const mine = await request(app.server)
      .get("/api/v1/users/me/calendar?from=2026-09-01&to=2026-09-30")
      .set(auth(r1));
    expect(mine.body.activities).toHaveLength(1);
  });
});

describe("share to feed on log", () => {
  beforeEach(truncate);

  it("shares to the feed only when shareToFeed is set", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "shareCoach");
    const runner = await registerUser("RUNNER", "shareRunner");
    const teamId = await createTeamAs(coach, "Share Team");
    await addRunnerToTeam(coach, teamId, runner);

    const payload = {
      kind: "RUN",
      startedAt: new Date(Date.now() - 3600000).toISOString(),
      distanceM: 5000,
      durationS: 1500,
      teamId,
      visibility: "TEAM",
    };

    // With shareToFeed: a feed post appears.
    const shared = await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(runner))
      .send({ ...payload, shareToFeed: true });
    expect(shared.status).toBe(201);

    const feed = await request(app.server)
      .get(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(runner));
    expect(feed.body.posts).toHaveLength(1);
    expect(feed.body.posts[0].activity.id).toBe(shared.body.activity.id);

    // Without shareToFeed: no new post.
    const unshared = await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(runner))
      .send(payload);
    expect(unshared.status).toBe(201);

    const feed2 = await request(app.server)
      .get(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(runner));
    expect(feed2.body.posts).toHaveLength(1);
  });
});
