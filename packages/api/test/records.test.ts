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

async function setup() {
  const app = await getApp();
  const coach = await registerUser("COACH", "reccoach");
  const runner = await registerUser("RUNNER", "recrunner");
  const teamId = await createTeamAs(coach, "Record Breakers");
  await addRunnerToTeam(coach, teamId, runner);
  return { app, coach, runner, teamId };
}

const RACE = {
  raceName: "Winchester 5K",
  distanceM: 5000,
  durationS: 1470,
  racedAt: new Date().toISOString(),
};

describe("records + shoes", () => {
  beforeEach(truncate);

  it("runner logs a race result; PRs show the best time per distance", async () => {
    const { app, runner } = await setup();
    const first = await request(app.server)
      .post("/api/v1/race-results")
      .set(cookieHeader(runner))
      .send(RACE);
    expect(first.status).toBe(201);

    const second = await request(app.server)
      .post("/api/v1/race-results")
      .set(cookieHeader(runner))
      .send({ ...RACE, durationS: 1500, raceName: "Slower 5K" });
    expect(second.status).toBe(201);

    const res = await request(app.server)
      .get("/api/v1/users/me/records")
      .set(cookieHeader(runner));
    expect(res.status).toBe(200);
    expect(res.body.records).toHaveLength(1);
    expect(res.body.records[0].label).toBe("5K");
    expect(res.body.records[0].durationS).toBe(1470); // best wins
    expect(res.body.records[0].raceName).toBe("Winchester 5K");
  });

  it("team records take the best across members, ignoring private-activity races", async () => {
    const { app, coach, runner, teamId } = await setup();
    const other = await registerUser("RUNNER", "recother");
    await addRunnerToTeam(coach, teamId, other);

    await request(app.server)
      .post("/api/v1/race-results")
      .set(cookieHeader(runner))
      .send(RACE);

    await request(app.server)
      .post("/api/v1/race-results")
      .set(cookieHeader(other))
      .send({ ...RACE, durationS: 1400, raceName: "Faster 5K" });

    // A race linked to a PRIVATE activity must not count for the team.
    const priv = await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(other))
      .send({
        kind: "RUN",
        startedAt: new Date().toISOString(),
        distanceM: 5000,
        durationS: 1300,
        visibility: "PRIVATE",
        teamId,
      });
    expect(priv.status).toBe(201);
    await request(app.server)
      .post("/api/v1/race-results")
      .set(cookieHeader(other))
      .send({
        raceName: "Secret 5K",
        distanceM: 5000,
        durationS: 1200,
        racedAt: new Date().toISOString(),
        activityId: priv.body.activity.id,
      });

    const res = await request(app.server)
      .get(`/api/v1/teams/${teamId}/records`)
      .set(cookieHeader(runner));
    expect(res.status).toBe(200);
    expect(res.body.records).toHaveLength(1);
    expect(res.body.records[0].durationS).toBe(1400);
    expect(res.body.records[0].displayName).toContain("recother");
  });

  it("shoe mileage accumulates from logged runs; retired shoes are rejected", async () => {
    const { app, runner, teamId } = await setup();
    const created = await request(app.server)
      .post("/api/v1/shoes")
      .set(cookieHeader(runner))
      .send({ name: "Daily trainers", brand: "Nike", model: "Pegasus" });
    expect(created.status).toBe(201);
    const shoeId = created.body.shoe.id;

    const run = await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(runner))
      .send({
        kind: "RUN",
        startedAt: new Date().toISOString(),
        distanceM: 8000,
        durationS: 2400,
        visibility: "TEAM",
        teamId,
        shoeId,
      });
    expect(run.status).toBe(201);
    expect(run.body.activity.shoeId).toBe(shoeId);
    expect(run.body.activity.shoeName).toBe("Daily trainers");

    const shoes = await request(app.server)
      .get("/api/v1/shoes")
      .set(cookieHeader(runner));
    expect(shoes.body.shoes[0].mileageM).toBe(8000);

    // A teammate's shoe cannot be used.
    const coachShoe = await request(app.server)
      .post("/api/v1/shoes")
      .set(cookieHeader(runner))
      .send({ name: "Mine" });
    const other = await registerUser("RUNNER", "recshoeother");
    const stolen = await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(other))
      .send({
        kind: "RUN",
        startedAt: new Date().toISOString(),
        distanceM: 1000,
        durationS: 300,
        shoeId: coachShoe.body.shoe.id,
      });
    expect(stolen.status).toBe(403);

    // Retire, then logging with it is rejected.
    await request(app.server)
      .patch(`/api/v1/shoes/${shoeId}`)
      .set(cookieHeader(runner))
      .send({ retired: true });
    const retired = await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(runner))
      .send({
        kind: "RUN",
        startedAt: new Date().toISOString(),
        distanceM: 1000,
        durationS: 300,
        shoeId,
      });
    expect(retired.status).toBe(400);
  });

  it("default shoe applies to new runs until changed; retiring clears it", async () => {
    const { app, runner } = await setup();
    const mk = async (name: string) => {
      const r = await request(app.server)
        .post("/api/v1/shoes")
        .set(cookieHeader(runner))
        .send({ name });
      expect(r.status).toBe(201);
      return r.body.shoe.id as string;
    };
    const a = await mk("Shoe A");
    const b = await mk("Shoe B");

    // Set A as default; a run with no shoeId picks it up.
    const def = await request(app.server)
      .post(`/api/v1/shoes/${a}/default`)
      .set(cookieHeader(runner));
    expect(def.status).toBe(200);
    expect(def.body.shoe.isDefault).toBe(true);

    const run1 = await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(runner))
      .send({
        kind: "RUN",
        startedAt: new Date().toISOString(),
        distanceM: 5000,
        durationS: 1500,
        visibility: "PRIVATE",
      });
    expect(run1.status).toBe(201);
    expect(run1.body.activity.shoeId).toBe(a);

    // Setting B as default replaces A.
    await request(app.server)
      .post(`/api/v1/shoes/${b}/default`)
      .set(cookieHeader(runner))
      .expect(200);
    const list = await request(app.server)
      .get("/api/v1/shoes")
      .set(cookieHeader(runner));
    const byId = Object.fromEntries(list.body.shoes.map((s: any) => [s.id, s]));
    expect(byId[a].isDefault).toBe(false);
    expect(byId[b].isDefault).toBe(true);

    // Retiring the default clears it; new runs get no shoe.
    await request(app.server)
      .patch(`/api/v1/shoes/${b}`)
      .set(cookieHeader(runner))
      .send({ retired: true })
      .expect(200);
    const run2 = await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(runner))
      .send({
        kind: "RUN",
        startedAt: new Date().toISOString(),
        distanceM: 3000,
        durationS: 900,
        visibility: "PRIVATE",
      });
    expect(run2.status).toBe(201);
    expect(run2.body.activity.shoeId).toBeNull();

    // A retired shoe can't become the default.
    const bad = await request(app.server)
      .post(`/api/v1/shoes/${b}/default`)
      .set(cookieHeader(runner));
    expect(bad.status).toBe(400);
  });

  it("contact info is manager-only on the roster", async () => {
    const { app, coach, runner, teamId } = await setup();
    const other = await registerUser("RUNNER", "reccontact");
    await addRunnerToTeam(coach, teamId, other);

    await request(app.server)
      .patch("/api/v1/users/me")
      .set(cookieHeader(other))
      .send({ phone: "555-1234", emergencyName: "Mom", emergencyPhone: "555-9999" });

    const coachView = await request(app.server)
      .get(`/api/v1/teams/${teamId}/roster`)
      .set(cookieHeader(coach));
    const entry = coachView.body.roster.find((m: { userId: string }) => m.userId === other.id);
    expect(entry.phone).toBe("555-1234");
    expect(entry.emergencyPhone).toBe("555-9999");

    const runnerView = await request(app.server)
      .get(`/api/v1/teams/${teamId}/roster`)
      .set(cookieHeader(runner));
    const hidden = runnerView.body.roster.find((m: { userId: string }) => m.userId === other.id);
    expect(hidden.phone).toBeUndefined();
    expect(hidden.email).toBeUndefined();
  });

  it("race result stores splits, place, and field size; bad splits rejected", async () => {
    const { app, runner } = await setup();
    const splits = [
      { distanceM: 1609, durationS: 500 },
      { distanceM: 1609, durationS: 500 },
      { distanceM: 1782, durationS: 500 },
    ];
    const created = await request(app.server)
      .post("/api/v1/race-results")
      .set(cookieHeader(runner))
      .send({
        ...RACE,
        durationS: 1500,
        splits,
        finishPlace: 7,
        ageGroupPlace: 2,
        fieldSize: 342,
      });
    expect(created.status).toBe(201);
    expect(created.body.raceResult.splits).toHaveLength(3);
    expect(created.body.raceResult.finishPlace).toBe(7);
    expect(created.body.raceResult.fieldSize).toBe(342);

    const bad = await request(app.server)
      .post("/api/v1/race-results")
      .set(cookieHeader(runner))
      .send({
        ...RACE,
        durationS: 1500,
        splits: [
          { distanceM: 1609, durationS: 300 },
          { distanceM: 1609, durationS: 300 },
        ],
      });
    expect(bad.status).toBe(400);
  });

  it("coach bulk-logs race results for the team", async () => {
    const { app, coach, runner, teamId } = await setup();
    const other = await registerUser("RUNNER", "raceteamother");
    await addRunnerToTeam(coach, teamId, other);

    const res = await request(app.server)
      .post("/api/v1/race-results/team-log")
      .set(cookieHeader(coach))
      .send({
        teamId,
        raceName: "City 5K",
        distanceM: 5000,
        racedAt: new Date().toISOString(),
        fieldSize: 500,
        entries: [
          { userId: runner.id, durationS: 1500, finishPlace: 42 },
          { userId: other.id, durationS: 1560, finishPlace: 87 },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.count).toBe(2);

    const mine = await request(app.server)
      .get("/api/v1/race-results")
      .set(cookieHeader(other));
    expect(mine.body.raceResults).toHaveLength(1);
    expect(mine.body.raceResults[0].durationS).toBe(1560);
    expect(mine.body.raceResults[0].finishPlace).toBe(87);
    expect(mine.body.raceResults[0].fieldSize).toBe(500);

    // Runner cannot bulk-log.
    const denied = await request(app.server)
      .post("/api/v1/race-results/team-log")
      .set(cookieHeader(runner))
      .send({
        teamId,
        raceName: "City 5K",
        distanceM: 5000,
        racedAt: new Date().toISOString(),
        entries: [{ userId: runner.id, durationS: 1500 }],
      });
    expect(denied.status).toBe(403);
  });

  it("AI race analysis calls out a positive split; access is owner/coach-only", async () => {
    const { app, coach, runner, teamId } = await setup();
    // Went out hot: first 5K split well under average, faded late.
    const created = await request(app.server)
      .post("/api/v1/race-results")
      .set(cookieHeader(runner))
      .send({
        ...RACE,
        durationS: 1240,
        splits: [
          { distanceM: 1609, durationS: 380 },
          { distanceM: 1609, durationS: 400 },
          { distanceM: 1782, durationS: 460 },
        ],
        finishPlace: 15,
        fieldSize: 200,
      });
    expect(created.status).toBe(201);
    const id = created.body.raceResult.id;

    const analysis = await request(app.server)
      .get(`/api/v1/race-results/${id}/analysis`)
      .set(cookieHeader(runner));
    expect(analysis.status).toBe(200);
    expect(analysis.body.analysis.pacingVerdict).toBe("positive");
    expect(analysis.body.analysis.hasSplits).toBe(true);
    expect(analysis.body.analysis.narrative.length).toBeGreaterThan(0);
    expect(analysis.body.analysis.coachingCues.length).toBeGreaterThan(0);
    expect(analysis.body.analysis.provider).toBe("local");

    // Coach of the athlete's team can view it.
    const coachView = await request(app.server)
      .get(`/api/v1/race-results/${id}/analysis`)
      .set(cookieHeader(coach));
    expect(coachView.status).toBe(200);

    // Unrelated runner cannot.
    const stranger = await registerUser("RUNNER", "racestranger");
    const denied = await request(app.server)
      .get(`/api/v1/race-results/${id}/analysis`)
      .set(cookieHeader(stranger));
    expect([403, 404]).toContain(denied.status);
  });
});
