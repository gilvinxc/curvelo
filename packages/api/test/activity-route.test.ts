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

/** Minimal GPX with a 3-point track (real lat/lon near Lexington, KY). */
function gpxWithTrack(points: Array<[number, number]>): Buffer {
  const trkpts = points
    .map(
      ([lat, lon], i) =>
        `<trkpt lat="${lat}" lon="${lon}"><ele>300</ele><time>2026-09-18T13:${String(i).padStart(2, "0")}:00Z</time></trkpt>`,
    )
    .join("");
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1"><trk><type>running</type><trkseg>${trkpts}</trkseg></trk></gpx>`,
  );
}

const GPX_3PT = gpxWithTrack([
  [38.0406, -84.5037],
  [38.0416, -84.5047],
  [38.0426, -84.5057],
]);

function gpxNoTrack(): Buffer {
  // Valid timestamps (so duration exists) but unusable coordinates.
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1"><trk><type>running</type><trkseg><trkpt lat="999" lon="999"><ele>300</ele><time>2026-09-18T13:00:00Z</time></trkpt><trkpt><ele>300</ele><time>2026-09-18T13:01:00Z</time></trkpt></trkseg></trk></gpx>`,
  );
}

async function importFile(app: any, user: TestUser, buf: Buffer, filename: string, teamId?: string) {
  const req = request(app.server)
    .post("/api/v1/activities/import/confirm")
    .set(cookieHeader(user))
    .field("visibility", "TEAM");
  if (teamId) req.field("teamId", teamId);
  return req.attach("file", buf, filename);
}

async function linkGuardian(
  app: any,
  coach: TestUser,
  teamId: string,
  athlete: TestUser,
  guardian: TestUser,
  opts: { accept?: boolean } = {},
) {
  const invite = await request(app.server)
    .post(`/api/v1/teams/${teamId}/athletes/${athlete.id}/guardians/invite`)
    .set(cookieHeader(coach))
    .send({ email: guardian.email, relationship: "parent" });
  if (invite.status !== 201) throw new Error("guardian invite failed");
  if (opts.accept === false) return; // leave PENDING (unverified)
  const accept = await request(app.server)
    .post(`/api/v1/guardian-invites/${invite.body.invite.token}/accept`)
    .set(cookieHeader(guardian))
    .send({ consents: ["PARTICIPATION"] });
  if (![200, 201].includes(accept.status)) throw new Error("guardian accept failed");
}

async function setup() {
  const app = await getApp();
  const coach = await registerUser("COACH", "rcoach");
  const teamId = await createTeamAs(coach, "Route Team");
  const runner = await registerUser("RUNNER", "rrunner");
  const teammate = await registerUser("RUNNER", "rteammate");
  const outsider = await registerUser("RUNNER", "router");
  const guardian = await registerUser("PARENT", "rguardian");
  const unverified = await registerUser("PARENT", "runverified");
  await addRunnerToTeam(coach, teamId, runner);
  await addRunnerToTeam(coach, teamId, teammate);
  await linkGuardian(app, coach, teamId, runner, guardian);
  await linkGuardian(app, coach, teamId, runner, unverified, { accept: false });
  return { app, coach, teamId, runner, teammate, outsider, guardian, unverified };
}

async function importRun(app: any, runner: TestUser, buf: Buffer, name: string, teamId?: string) {
  const res = await importFile(app, runner, buf, name, teamId);
  expect(res.status).toBe(201);
  return res.body.activity.id as string;
}

describe("GPS routes", () => {
  beforeEach(truncate);

  it("stores a simplified route from GPX (point count <= 500)", async () => {
    const { app, runner, teamId } = await setup();
    // 1200-point winding track
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 1200; i++) {
      pts.push([38.04 + i * 0.00001, -84.5 + Math.sin(i / 20) * 0.001]);
    }
    const id = await importRun(app, runner, gpxWithTrack(pts), "big.gpx", teamId);
    const res = await request(app.server)
      .get(`/api/v1/activities/${id}/route`)
      .set(cookieHeader(runner));
    expect(res.status).toBe(200);
    expect(res.body.route.points.length).toBeLessThanOrEqual(500);
    expect(res.body.route.points.length).toBeGreaterThanOrEqual(2);
  });

  it("owner sees route in detail and via /route; coach gets 403", async () => {
    const { app, coach, runner, teamId } = await setup();
    const id = await importRun(app, runner, GPX_3PT, "run.gpx", teamId);

    const detail = await request(app.server)
      .get(`/api/v1/activities/${id}`)
      .set(cookieHeader(runner));
    expect(detail.status).toBe(200);
    expect(detail.body.activity.route).toHaveLength(3);
    expect(detail.body.activity.hasGpsRoute).toBe(true);

    const route = await request(app.server)
      .get(`/api/v1/activities/${id}/route`)
      .set(cookieHeader(runner));
    expect(route.status).toBe(200);
    expect(route.body.route.points).toHaveLength(3);

    // Coach of the runner's team: sees the activity, NOT the route.
    const coachDetail = await request(app.server)
      .get(`/api/v1/activities/${id}`)
      .set(cookieHeader(coach));
    expect(coachDetail.status).toBe(200);
    expect(coachDetail.body.activity.route).toBeNull();
    // …but the GPS badge boolean IS visible to the coach.
    expect(coachDetail.body.activity.hasGpsRoute).toBe(true);

    const coachRoute = await request(app.server)
      .get(`/api/v1/activities/${id}/route`)
      .set(cookieHeader(coach));
    expect(coachRoute.status).toBe(403);
  });

  it("verified guardian sees the route; unverified guardian gets 403", async () => {
    const { app, guardian, unverified, runner, teamId } = await setup();
    const id = await importRun(app, runner, GPX_3PT, "run.gpx", teamId);

    const g = await request(app.server)
      .get(`/api/v1/activities/${id}/route`)
      .set(cookieHeader(guardian));
    expect(g.status).toBe(200);
    expect(g.body.route.points).toHaveLength(3);

    const gd = await request(app.server)
      .get(`/api/v1/activities/${id}`)
      .set(cookieHeader(guardian));
    expect(gd.body.activity.route).toHaveLength(3);

    const u = await request(app.server)
      .get(`/api/v1/activities/${id}/route`)
      .set(cookieHeader(unverified));
    expect(u.status).toBe(403);
  });

  it("teammate and outsider get 403 on the route endpoint", async () => {
    const { app, teammate, outsider, runner, teamId } = await setup();
    const id = await importRun(app, runner, GPX_3PT, "run.gpx", teamId);

    for (const u of [teammate, outsider]) {
      const res = await request(app.server)
        .get(`/api/v1/activities/${id}/route`)
        .set(cookieHeader(u));
      expect(res.status).toBe(403);
    }
  });

  it("list endpoints never include routes", async () => {
    const { app, runner, teamId } = await setup();
    await importRun(app, runner, GPX_3PT, "run.gpx", teamId);
    const res = await request(app.server)
      .get("/api/v1/activities?from=2026-09-01&to=2026-09-30")
      .set(cookieHeader(runner));
    expect(res.status).toBe(200);
    expect(res.body.activities.length).toBeGreaterThan(0);
    for (const a of res.body.activities) {
      expect(a.route ?? null).toBeNull();
      expect(a.hasGpsRoute).toBe(true);
    }
  });

  it("activity without GPS: no route, hasGpsRoute false, /route 404s", async () => {
    const { app, runner, teamId } = await setup();
    const res = await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(runner))
      .send({
        kind: "RUN",
        startedAt: "2026-09-18T13:00:00Z",
        distanceM: 5000,
        durationS: 1500,
        visibility: "TEAM",
      });
    expect(res.status).toBe(201);
    const id = res.body.activity.id;
    expect(res.body.activity.hasGpsRoute).toBe(false);

    const route = await request(app.server)
      .get(`/api/v1/activities/${id}/route`)
      .set(cookieHeader(runner));
    expect(route.status).toBe(404);
  });

  it("deleting the activity cascades the route", async () => {
    const { app, runner, teamId } = await setup();
    const id = await importRun(app, runner, GPX_3PT, "run.gpx", teamId);
    const del = await request(app.server)
      .delete(`/api/v1/activities/${id}`)
      .set(cookieHeader(runner));
    expect(del.status).toBe(200);
    const route = await request(app.server)
      .get(`/api/v1/activities/${id}/route`)
      .set(cookieHeader(runner));
    expect(route.status).toBe(404);
  });

  it("malformed GPS never fails the import", async () => {
    const { app, runner, teamId } = await setup();
    // Single point = no route, but import succeeds.
    const id = await importRun(app, runner, gpxNoTrack(), "notrack.gpx", teamId);
    const route = await request(app.server)
      .get(`/api/v1/activities/${id}/route`)
      .set(cookieHeader(runner));
    expect(route.status).toBe(404);
  });
});
