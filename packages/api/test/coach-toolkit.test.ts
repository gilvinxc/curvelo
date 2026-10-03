import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  getApp,
  registerUser,
  truncate,
  cookieHeader,
  createTeamAs,
  addRunnerToTeam,
  type TestUser,
} from "./helpers.js";

async function setup() {
  const app = await getApp();
  const coach = await registerUser("COACH", "toolkit-coach");
  const runner = await registerUser("RUNNER", "toolkit-runner");
  const runner2 = await registerUser("RUNNER", "toolkit-runner2");
  const outsider = await registerUser("RUNNER", "toolkit-outsider");
  const teamId = await createTeamAs(coach, "Toolkit Team");
  await addRunnerToTeam(coach, teamId, runner);
  await addRunnerToTeam(coach, teamId, runner2);
  return { app, coach, runner, runner2, outsider, teamId };
}

function awardPayload(athleteId: string) {
  return {
    athleteId,
    type: "MEDAL",
    place: 1,
    eventName: "Winchester 5K Classic",
    eventDate: "2026-09-20",
    notes: "Great kick",
  };
}

describe("coach toolkit", () => {
  beforeEach(truncate);

  it("coach creates/updates/deletes an award; runner is denied", async () => {
    const { app, coach, runner, teamId } = await setup();

    const created = await request(app.server)
      .post(`/api/v1/teams/${teamId}/awards`)
      .set(cookieHeader(coach))
      .send(awardPayload(runner.id));
    expect(created.status).toBe(201);
    expect(created.body.award.eventName).toBe("Winchester 5K Classic");
    expect(created.body.award.athleteName).toBeTruthy();

    // Runner cannot create.
    const denied = await request(app.server)
      .post(`/api/v1/teams/${teamId}/awards`)
      .set(cookieHeader(runner))
      .send(awardPayload(runner.id));
    expect(denied.status).toBe(403);

    const awardId = created.body.award.id;
    const updated = await request(app.server)
      .patch(`/api/v1/awards/${awardId}`)
      .set(cookieHeader(coach))
      .send({ place: 2 });
    expect(updated.status).toBe(200);
    expect(updated.body.award.place).toBe(2);

    const del = await request(app.server)
      .delete(`/api/v1/awards/${awardId}`)
      .set(cookieHeader(coach));
    expect(del.status).toBe(204);

    const list = await request(app.server)
      .get(`/api/v1/teams/${teamId}/awards`)
      .set(cookieHeader(coach));
    expect(list.body.awards).toHaveLength(0);
  });

  it("award creation validates athlete membership", async () => {
    const { app, coach, outsider, teamId } = await setup();
    const res = await request(app.server)
      .post(`/api/v1/teams/${teamId}/awards`)
      .set(cookieHeader(coach))
      .send(awardPayload(outsider.id));
    expect(res.status).toBe(403);
  });

  it("athlete sees own awards; award count respects season window", async () => {
    const { app, coach, runner, runner2, teamId } = await setup();
    await request(app.server)
      .post(`/api/v1/teams/${teamId}/awards`)
      .set(cookieHeader(coach))
      .send(awardPayload(runner.id));
    await request(app.server)
      .post(`/api/v1/teams/${teamId}/awards`)
      .set(cookieHeader(coach))
      .send({ ...awardPayload(runner2.id), eventDate: "2025-01-10" });

    const mine = await request(app.server)
      .get(`/api/v1/teams/${teamId}/athletes/${runner.id}/awards`)
      .set(cookieHeader(runner));
    expect(mine.status).toBe(200);
    expect(mine.body.awards).toHaveLength(1);

    // Runner2 cannot see runner's awards.
    const other = await request(app.server)
      .get(`/api/v1/teams/${teamId}/athletes/${runner.id}/awards`)
      .set(cookieHeader(runner2));
    expect(other.status).toBe(403);

    const total = await request(app.server)
      .get(`/api/v1/teams/${teamId}/awards/count`)
      .set(cookieHeader(coach));
    expect(total.body.total).toBe(2);

    const season = await request(app.server)
      .get(`/api/v1/teams/${teamId}/awards/count?from=2026-01-01&to=2026-12-31`)
      .set(cookieHeader(coach));
    expect(season.body.total).toBe(1);
  });

  it("award with postToFeed creates a shoutout post", async () => {
    const { app, coach, runner, teamId } = await setup();
    const res = await request(app.server)
      .post(`/api/v1/teams/${teamId}/awards`)
      .set(cookieHeader(coach))
      .send({ ...awardPayload(runner.id), postToFeed: true });
    expect(res.status).toBe(201);

    const feed = await request(app.server)
      .get(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(coach));
    expect(feed.status).toBe(200);
    const shoutout = feed.body.posts.find(
      (p: { kind: string }) => p.kind === "SHOUTOUT",
    );
    expect(shoutout).toBeTruthy();
    expect(shoutout.body).toContain("Winchester 5K Classic");
  });

  it("eligibility nudges surface expired/missing docs", async () => {
    const { app, coach, runner, runner2, teamId } = await setup();

    const req = await request(app.server)
      .post(`/api/v1/teams/${teamId}/document-requirements`)
      .set(cookieHeader(coach))
      .send({ kind: "PHYSICAL", label: "Annual physical", validDays: 365 });
    expect(req.status).toBe(201);

    // Runner uploads an expired physical (issued 400 days ago, valid 365).
    const pdf = Buffer.from("%PDF-1.4 fake");
    const issued = new Date(Date.now() - 400 * 86_400_000).toISOString();
    const up = await request(app.server)
      .post("/api/v1/documents/upload")
      .set(cookieHeader(runner))
      .field("teamId", teamId)
      .field("kind", "PHYSICAL")
      .field("label", "Annual physical")
      .field("requirementId", req.body.requirement.id)
      .field("issuedAt", issued)
      .attach("file", pdf, "physical.pdf");
    expect(up.status).toBe(201);

    const status = await request(app.server)
      .get(`/api/v1/teams/${teamId}/document-status`)
      .set(cookieHeader(coach));
    expect(status.status).toBe(200);
    const expired = status.body.athletes.find(
      (a: { userId: string }) => a.userId === runner.id,
    );
    expect(expired.cleared).toBe(false);
    expect(expired.requirements[0].status).toBe("expired");

    // Runner2 uploaded nothing → missing.
    const missing = status.body.athletes.find(
      (a: { userId: string }) => a.userId === runner2.id,
    );
    expect(missing.cleared).toBe(false);
    expect(missing.requirements[0].status).toBe("missing");
  });

  it("weekly recap draft returns text from verified stats", async () => {
    const { app, coach, runner, teamId } = await setup();

    // Log a team-visible activity in the last 7 days.
    const act = await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(runner))
      .send({
        teamId,
        visibility: "TEAM",
        kind: "RUN",
        distanceM: 5000,
        durationS: 1500,
        startedAt: new Date().toISOString(),
      });
    expect(act.status).toBe(201);

    const draft = await request(app.server)
      .post(`/api/v1/teams/${teamId}/weekly-recap/draft`)
      .set(cookieHeader(coach));
    expect(draft.status).toBe(200);
    expect(typeof draft.body.draft).toBe("string");
    expect(draft.body.draft.length).toBeGreaterThan(20);
    // The draft must mention the real mileage, not invent it.
    expect(draft.body.draft).toContain("3.1");

    // Runner cannot draft.
    const denied = await request(app.server)
      .post(`/api/v1/teams/${teamId}/weekly-recap/draft`)
      .set(cookieHeader(runner));
    expect(denied.status).toBe(403);
  });

  it("alumni digest draft endpoint exists (was 404)", async () => {
    const { app, coach, teamId } = await setup();
    const draft = await request(app.server)
      .post(`/api/v1/teams/${teamId}/alumni-digest/draft`)
      .set(cookieHeader(coach));
    expect(draft.status).toBe(200);
    expect(typeof draft.body.draft).toBe("string");
  });

  it("lineup helper ranks runners by best time at the distance", async () => {
    const { app, coach, runner, runner2, teamId } = await setup();

    const log = await request(app.server)
      .post("/api/v1/race-results/team-log")
      .set(cookieHeader(coach))
      .send({
        teamId,
        raceName: "County 5K",
        distanceM: 5000,
        racedAt: new Date().toISOString(),
        entries: [
          { userId: runner.id, durationS: 1500, finishPlace: 2 },
          { userId: runner2.id, durationS: 1380, finishPlace: 1 },
        ],
      });
    expect(log.status).toBe(201);

    const lineup = await request(app.server)
      .get(`/api/v1/teams/${teamId}/lineup?distanceM=5000`)
      .set(cookieHeader(coach));
    expect(lineup.status).toBe(200);
    expect(lineup.body.lineup).toHaveLength(2);
    // Faster runner first.
    expect(lineup.body.lineup[0].userId).toBe(runner2.id);
    expect(lineup.body.lineup[0].durationS).toBe(1380);
    expect(lineup.body.lineup[1].userId).toBe(runner.id);

    // Wrong distance → empty, not an error.
    const empty = await request(app.server)
      .get(`/api/v1/teams/${teamId}/lineup?distanceM=10000`)
      .set(cookieHeader(coach));
    expect(empty.body.lineup).toHaveLength(0);

    // Runner cannot see the lineup helper.
    const denied = await request(app.server)
      .get(`/api/v1/teams/${teamId}/lineup?distanceM=5000`)
      .set(cookieHeader(runner));
    expect(denied.status).toBe(403);
  });

  it("awards cascade when the team is deleted", async () => {
    const { app, coach, runner, teamId } = await setup();
    const created = await request(app.server)
      .post(`/api/v1/teams/${teamId}/awards`)
      .set(cookieHeader(coach))
      .send(awardPayload(runner.id));
    expect(created.status).toBe(201);

    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    await prisma.team.delete({ where: { id: teamId } });
    const remaining = await prisma.award.count();
    await prisma.$disconnect();
    expect(remaining).toBe(0);
  });
});
