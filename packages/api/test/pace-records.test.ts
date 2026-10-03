import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  getApp,
  registerUser,
  truncate,
  cookieHeader,
  createTeamAs,
  addRunnerToTeam,
} from "./helpers.js";

const RUN = {
  kind: "RUN",
  title: "Run",
  startedAt: "2026-09-01T13:00:00Z",
};

async function logRun(user: { cookies: string[] }, distanceM: number, durationS: number | undefined, startedAt = "2026-09-01T13:00:00Z") {
  const app = await getApp();
  const body: Record<string, unknown> = { ...RUN, startedAt, distanceM };
  if (durationS !== undefined) body.durationS = durationS;
  const res = await request(app.server)
    .post("/api/v1/activities")
    .set(cookieHeader(user))
    .send(body);
  expect(res.status).toBe(201);
  return res.body.activity.id as string;
}

describe("pace records", () => {
  beforeEach(truncate);

  it("detects the fastest pace per standard distance with 2% tolerance", async () => {
    const runner = await registerUser("RUNNER", "prrunner");
    // 5K in 20:00 (4:00/km) then a faster 5K in 19:00 (3:48/km)
    await logRun(runner, 5000, 1200, "2026-09-01T13:00:00Z");
    const fastId = await logRun(runner, 5000, 1140, "2026-09-05T13:00:00Z");
    // 3.11 miles ≈ 5004m — within 2% of 5K, slower pace (should not win)
    await logRun(runner, 5004, 1260, "2026-09-10T13:00:00Z");

    const app = await getApp();
    const res = await request(app.server)
      .get("/api/v1/users/me/pace-records")
      .set(cookieHeader(runner));
    expect(res.status).toBe(200);
    const fiveK = res.body.records.find((r: { label: string }) => r.label === "5K");
    expect(fiveK).toBeDefined();
    expect(fiveK.activityId).toBe(fastId);
    expect(fiveK.bestPaceS).toBeCloseTo(228, 1); // 1140/5000*1000
  });

  it("ignores runs missing distance or duration", async () => {
    const runner = await registerUser("RUNNER", "prrunner2");
    // 10K with no duration — must not count
    await logRun(runner, 10000, undefined);
    const app = await getApp();
    const res = await request(app.server)
      .get("/api/v1/users/me/pace-records")
      .set(cookieHeader(runner));
    expect(res.status).toBe(200);
    expect(res.body.records.find((r: { label: string }) => r.label === "10K")).toBeUndefined();
  });

  it("only returns distances the runner actually logged", async () => {
    const runner = await registerUser("RUNNER", "prrunner3");
    await logRun(runner, 1609, 360); // ~1 mile
    const app = await getApp();
    const res = await request(app.server)
      .get("/api/v1/users/me/pace-records")
      .set(cookieHeader(runner));
    expect(res.body.records).toHaveLength(1);
    expect(res.body.records[0].label).toBe("1 mi");
  });
});

describe("seasons", () => {
  beforeEach(truncate);

  it("coach-only write; members read; alumni blocked", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "scoach");
    const teamId = await createTeamAs(coach, "Season Team");
    const runner = await registerUser("RUNNER", "srunner");
    await addRunnerToTeam(coach, teamId, runner);

    const body = {
      name: "Fall XC 2026",
      startsAt: "2026-08-01",
      endsAt: "2026-11-30",
      championshipName: "State Championship",
      championshipDate: "2026-11-14",
    };

    // Runner cannot create.
    const denied = await request(app.server)
      .post(`/api/v1/teams/${teamId}/seasons`)
      .set(cookieHeader(runner))
      .send(body);
    expect(denied.status).toBe(403);

    // Coach creates.
    const created = await request(app.server)
      .post(`/api/v1/teams/${teamId}/seasons`)
      .set(cookieHeader(coach))
      .send(body);
    expect(created.status).toBe(201);
    const seasonId = created.body.season.id as string;
    expect(created.body.season.championshipName).toBe("State Championship");

    // Runner can list.
    const list = await request(app.server)
      .get(`/api/v1/teams/${teamId}/seasons`)
      .set(cookieHeader(runner));
    expect(list.status).toBe(200);
    expect(list.body.seasons).toHaveLength(1);

    // Runner cannot update or delete.
    expect(
      (
        await request(app.server)
          .patch(`/api/v1/teams/${teamId}/seasons/${seasonId}`)
          .set(cookieHeader(runner))
          .send({ name: "Hacked" })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app.server)
          .delete(`/api/v1/teams/${teamId}/seasons/${seasonId}`)
          .set(cookieHeader(runner))
      ).status,
    ).toBe(403);

    // Alumni are blocked from seasons entirely.
    const alum = await registerUser("RUNNER", "salum");
    await addRunnerToTeam(coach, teamId, alum);
    await request(app.server)
      .patch(`/api/v1/teams/${teamId}/members/${alum.id}`)
      .set(cookieHeader(coach))
      .send({ role: "ALUMNI" });
    expect(
      (
        await request(app.server)
          .get(`/api/v1/teams/${teamId}/seasons`)
          .set(cookieHeader(alum))
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app.server)
          .get(`/api/v1/teams/${teamId}/seasons/active`)
          .set(cookieHeader(alum))
      ).status,
    ).toBe(403);

    // Coach updates + deletes.
    const upd = await request(app.server)
      .patch(`/api/v1/teams/${teamId}/seasons/${seasonId}`)
      .set(cookieHeader(coach))
      .send({ name: "Fall XC 2026!" });
    expect(upd.status).toBe(200);
    expect(upd.body.season.name).toBe("Fall XC 2026!");
    expect(
      (
        await request(app.server)
          .delete(`/api/v1/teams/${teamId}/seasons/${seasonId}`)
          .set(cookieHeader(coach))
      ).status,
    ).toBe(200);
  });

  it("active season returns countdown math", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "scoach2");
    const teamId = await createTeamAs(coach, "Countdown Team");

    // Season containing today with a championship 10 days out.
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 30);
    const end = new Date(today);
    end.setDate(end.getDate() + 30);
    const champ = new Date(today);
    champ.setDate(champ.getDate() + 10);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    await request(app.server)
      .post(`/api/v1/teams/${teamId}/seasons`)
      .set(cookieHeader(coach))
      .send({
        name: "Season",
        startsAt: fmt(start),
        endsAt: fmt(end),
        championshipName: "Champs",
        championshipDate: fmt(champ),
      });

    const res = await request(app.server)
      .get(`/api/v1/teams/${teamId}/seasons/active`)
      .set(cookieHeader(coach));
    expect(res.status).toBe(200);
    expect(res.body.active).not.toBeNull();
    expect(res.body.active.daysToChampionship).toBe(10);
    expect(res.body.active.weeks.length).toBeGreaterThan(4);
    expect(res.body.active.weeks[0]).toHaveProperty("weekStart");
    expect(res.body.active.weeks[0]).toHaveProperty("milesM");
  });
});
