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
  const coach = await registerUser("COACH", "aicoach");
  const teamId = await createTeamAs(coach, "AI Team");
  const runner = await registerUser("RUNNER", "airunner");
  const quiet = await registerUser("RUNNER", "aiquiet");
  await addRunnerToTeam(coach, teamId, runner);
  await addRunnerToTeam(coach, teamId, quiet);
  return { app, coach, teamId, runner, quiet };
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCHours(d.getUTCHours() - 1); // buffer so "today" is never in the future
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
}

async function logRun(user: TestUser, teamId: string, nDaysAgo: number, durationS: number, assignmentId?: string) {
  const app = await getApp();
  const res = await request(app.server)
    .post("/api/v1/activities")
    .set(cookieHeader(user))
    .send({
      kind: "RUN",
      startedAt: daysAgo(nDaysAgo),
      distanceM: 5000,
      durationS,
      effortRpe: 6,
      teamId,
      visibility: "TEAM",
      ...(assignmentId ? { assignmentId } : {}),
    });
  if (res.status !== 201) {
    throw new Error(`logRun failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.activity;
}

describe("ai coaching assistance", () => {
  beforeEach(truncate);

  it("athlete insight: stats, trend detection, and local provider", async () => {
    const { app, coach, teamId, runner } = await setup();

    // 4 runs over 4 days, getting faster → improving trend + 4-day streak.
    await logRun(runner, teamId, 3, 1600);
    await logRun(runner, teamId, 2, 1550);
    await logRun(runner, teamId, 1, 1500);
    await logRun(runner, teamId, 0, 1450);

    // One assigned workout, one linked completion → 100% completion.
    const workoutRes = await request(app.server)
      .post(`/api/v1/teams/${teamId}/workouts`)
      .set(cookieHeader(coach))
      .send({ title: "Tempo", steps: [{ kind: "STEADY", distanceM: 5000 }] });
    const assignRes = await request(app.server)
      .post(`/api/v1/teams/${teamId}/assignments`)
      .set(cookieHeader(coach))
      .send({
        workoutId: workoutRes.body.workout.id,
        assignedToUserId: runner.id,
        scheduledDate: daysAgo(1).slice(0, 10),
      });
    const assignmentId = assignRes.body.assignment.id;
    await logRun(runner, teamId, 1, 1500, assignmentId);

    const res = await request(app.server)
      .get(`/api/v1/teams/${teamId}/athletes/${runner.id}/insights`)
      .set(cookieHeader(coach));
    expect(res.status).toBe(200);
    const insight = res.body.insight;
    expect(insight.provider).toBe("local");
    expect(insight.stats.sessions).toBe(5);
    expect(insight.stats.activeDays).toBe(4);
    expect(insight.stats.totalDistanceM).toBe(25000);
    expect(insight.stats.streakDays).toBe(4);
    expect(insight.stats.paceTrend).toBe("improving");
    expect(insight.stats.completionRate).toBe(1);
    expect(insight.highlights.length).toBeGreaterThan(0);
    expect(insight.narrative).toContain("trending in the right direction");
  });

  it("quiet athlete gets a check-in narrative; digest flags them", async () => {
    const { app, coach, teamId, runner, quiet } = await setup();
    await logRun(runner, teamId, 0, 1500);

    const insight = await request(app.server)
      .get(`/api/v1/teams/${teamId}/athletes/${quiet.id}/insights`)
      .set(cookieHeader(coach));
    expect(insight.status).toBe(200);
    expect(insight.body.insight.stats.sessions).toBe(0);
    expect(insight.body.insight.watchOuts.length).toBeGreaterThan(0);

    const digest = await request(app.server)
      .get(`/api/v1/teams/${teamId}/digest?days=28`)
      .set(cookieHeader(coach));
    expect(digest.status).toBe(200);
    expect(digest.body.digest.provider).toBe("local");
    const rows = digest.body.digest.athletes;
    expect(rows).toHaveLength(2);
    const quietRow = rows.find((r: { athleteId: string }) => r.athleteId === quiet.id);
    expect(quietRow.status).toBe("quiet");
    const activeRow = rows.find((r: { athleteId: string }) => r.athleteId === runner.id);
    expect(activeRow.status).toBe("on-track");
    expect(digest.body.digest.summary).toContain("1/2 athletes on track");
  });

  it("insights and digest are coach-only", async () => {
    const { app, teamId, runner, quiet } = await setup();

    const r1 = await request(app.server)
      .get(`/api/v1/teams/${teamId}/athletes/${quiet.id}/insights`)
      .set(cookieHeader(runner));
    expect(r1.status).toBe(403);

    const r2 = await request(app.server)
      .get(`/api/v1/teams/${teamId}/digest`)
      .set(cookieHeader(runner));
    expect(r2.status).toBe(403);
  });
});
