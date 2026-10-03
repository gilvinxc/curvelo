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

const now = new Date();
const daysAgo = (n: number) =>
  new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

async function setup() {
  const app = await getApp();
  const coach = await registerUser("COACH", "hlcoach");
  const runnerA = await registerUser("RUNNER", "hlrunA");
  const runnerB = await registerUser("RUNNER", "hlrunB");
  const teamId = await createTeamAs(coach, "Health Test Team");
  await addRunnerToTeam(coach, teamId, runnerA);
  await addRunnerToTeam(coach, teamId, runnerB);
  return { app, coach, runnerA, runnerB, teamId };
}

async function logRun(
  app: any,
  user: any,
  teamId: string,
  body: Record<string, unknown>,
) {
  const res = await request(app.server)
    .post("/api/v1/activities")
    .set(cookieHeader(user))
    .send({ kind: "RUN", teamId, visibility: "TEAM", ...body });
  expect(res.status).toBe(201);
  return res;
}

async function logRace(
  app: any,
  user: any,
  body: Record<string, unknown>,
) {
  const res = await request(app.server)
    .post("/api/v1/race-results")
    .set(cookieHeader(user))
    .send({ distanceM: 5000, durationS: 1200, ...body });
  expect(res.status).toBe(201);
  return res;
}

describe("team health", () => {
  beforeEach(truncate);

  it("rolls up miles, pace (both-fields-only), RPE, participation, and hides injuries from non-coaches", async () => {
    const { app, coach, runnerA, runnerB, teamId } = await setup();

    // Runner A: 8k in 40min (5:00/km) 2 days ago, with RPE.
    await logRun(app, runnerA, teamId, {
      startedAt: daysAgo(2),
      distanceM: 8000,
      durationS: 2400,
      effortRpe: 6,
    });
    // Runner A: 5k with NO duration 1 day ago — must not affect pace.
    await logRun(app, runnerA, teamId, {
      startedAt: daysAgo(1),
      distanceM: 5000,
      durationS: undefined,
    });
    // Runner B: 10k in 50min (5:00/km) 10 days ago — outside the week window.
    await logRun(app, runnerB, teamId, {
      startedAt: daysAgo(10),
      distanceM: 10000,
      durationS: 3000,
      effortRpe: 8,
    });

    // One active injury on runner A.
    const injury = await request(app.server)
      .post(`/api/v1/teams/${teamId}/injuries`)
      .set(cookieHeader(coach))
      .send({ athleteId: runnerA.id, title: "Shin splints" });
    expect(injury.status).toBe(201);

    const coachView = await request(app.server)
      .get(`/api/v1/teams/${teamId}/health`)
      .set(cookieHeader(coach));
    expect(coachView.status).toBe(200);
    const h = coachView.body.health;

    // Miles: only the 2 runs inside the last 7d (8k + 5k).
    expect(h.milesWeekM).toBe(13000);
    expect(h.milesPrevWeekM).toBe(10000);
    // Pace: only the 8k/40min run counts (5k has no time) -> 5:00/km = 300s.
    expect(h.avgPaceS).toBeCloseTo(300, 1);
    // RPE: (6 + 8) / 2 = 7.
    expect(h.avgRpe).toBeCloseTo(7, 1);
    // Injuries: coach sees the count.
    expect(h.activeInjuries).toBe(1);
    // Participation: only runnerA logged in the last 7d -> 50%.
    expect(h.participationPct).toBe(50);
    expect(h.runnerCount).toBe(2);
    expect(h.activeRunnerCount).toBe(1);

    // Runner sees everything except injuries.
    const runnerView = await request(app.server)
      .get(`/api/v1/teams/${teamId}/health`)
      .set(cookieHeader(runnerA));
    expect(runnerView.status).toBe(200);
    expect(runnerView.body.health.activeInjuries).toBeNull();
    expect(runnerView.body.health.participationPct).toBe(50);
  });

  it("race health counts PRs and pace-by-distance", async () => {
    const { app, coach, runnerA, runnerB, teamId } = await setup();

    // Runner A 5K history: old slow one (60d ago), then a PR 5d ago.
    await logRace(app, runnerA, {
      raceName: "Old 5K",
      racedAt: daysAgo(60),
      distanceM: 5000,
      durationS: 1500, // 5:00/km
    });
    await logRace(app, runnerA, {
      raceName: "Spring 5K",
      racedAt: daysAgo(5),
      distanceM: 5000,
      durationS: 1200, // 4:00/km — PR
    });
    // Runner B: same 5K, slower than A's PR but a PR for B (first ever).
    await logRace(app, runnerB, {
      raceName: "Spring 5K",
      racedAt: daysAgo(5),
      distanceM: 5000,
      durationS: 1400, // 4:40/km — PR for B
    });
    // Runner A 10K 3d ago — first at that distance, so also a PR.
    await logRace(app, runnerA, {
      raceName: "Spring 10K",
      racedAt: daysAgo(3),
      distanceM: 10000,
      durationS: 2700, // 4:30/km
    });
    // Runner A repeats the 5K at the same PR pace — tie, not a new PR.
    await logRace(app, runnerA, {
      raceName: "Evening 5K",
      racedAt: daysAgo(1),
      distanceM: 5000,
      durationS: 1200,
    });

    const res = await request(app.server)
      .get(`/api/v1/teams/${teamId}/health`)
      .set(cookieHeader(coach));
    expect(res.status).toBe(200);
    const races = res.body.health.races;

    // PRs in 30d: A's 5K PR, B's 5K PR, A's 10K PR. The tie doesn't count.
    expect(races.prs30d).toBe(3);
    expect(races.results30d).toBe(4);
    expect(races.races30d).toBe(3);

    // Pace by distance (90d): 5K group has 4 results (the 60d-old one is
    // inside the 90d window), 10K group has 1.
    const byDist = Object.fromEntries(
      races.paceByDistance.map((g: any) => [g.distanceM, g]),
    );
    expect(byDist[5000].resultsCount).toBe(4);
    // (1500 + 1200 + 1400 + 1200) / 20000 * 1000 = 265 s/km
    expect(byDist[5000].avgPaceS).toBeCloseTo(265, 1);
    expect(byDist[10000].resultsCount).toBe(1);
    expect(byDist[10000].avgPaceS).toBeCloseTo(270, 1);
    // Ordered by distance asc.
    expect(races.paceByDistance[0].distanceM).toBe(5000);

    // Recent races carry PR counts.
    const spring5k = races.recent.find((r: any) => r.raceName === "Spring 5K");
    expect(spring5k.resultsCount).toBe(2);
    expect(spring5k.prCount).toBe(2);
    const evening5k = races.recent.find((r: any) => r.raceName === "Evening 5K");
    expect(evening5k.prCount).toBe(0);
  });

  it("alumni cannot view team health; non-members get 404", async () => {
    const { app, coach, teamId } = await setup();
    const alum = await registerUser("RUNNER", "hlalum");
    await addRunnerToTeam(coach, teamId, alum);
    // Flip to alumni.
    const flip = await request(app.server)
      .patch(`/api/v1/teams/${teamId}/members/${alum.id}`)
      .set(cookieHeader(coach))
      .send({ role: "ALUMNI" });
    expect(flip.status).toBe(200);

    const res = await request(app.server)
      .get(`/api/v1/teams/${teamId}/health`)
      .set(cookieHeader(alum));
    expect(res.status).toBe(403);

    const outsider = await registerUser("RUNNER", "hlout");
    const res2 = await request(app.server)
      .get(`/api/v1/teams/${teamId}/health`)
      .set(cookieHeader(outsider));
    expect(res2.status).toBe(404);
  });
});
