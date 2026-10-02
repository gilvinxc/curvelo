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
});
