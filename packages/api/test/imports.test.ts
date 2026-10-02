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

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="curvelo-test">
  <trk><name>Morning run</name><type>running</type>
    <trkseg>
      <trkpt lat="38.0000" lon="-84.0000"><ele>280</ele><time>2026-09-28T12:00:00Z</time></trkpt>
      <trkpt lat="38.0050" lon="-84.0000"><ele>282</ele><time>2026-09-28T12:15:00Z</time></trkpt>
      <trkpt lat="38.0100" lon="-84.0000"><ele>281</ele><time>2026-09-28T12:30:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;

const TCX = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Running">
      <Id>2026-09-27T12:00:00Z</Id>
      <Lap StartTime="2026-09-27T12:00:00Z">
        <TotalTimeSeconds>1500</TotalTimeSeconds>
        <DistanceMeters>5000</DistanceMeters>
        <Calories>310</Calories>
        <AverageHeartRateBpm><Value>142</Value></AverageHeartRateBpm>
        <MaximumHeartRateBpm><Value>168</Value></MaximumHeartRateBpm>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;

/** Minimal hand-built FIT file: file_id + one running session. */
function buildFit(startUnix: number): Buffer {
  const FIT_EPOCH = 631065600;
  const t = startUnix - FIT_EPOCH;
  const u16 = (v: number) => {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(v);
    return b;
  };
  const u32 = (v: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v);
    return b;
  };
  const recs: Buffer[] = [
    Buffer.from([0x40, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00,0x01,0x00, 0x01,0x02,0x84, 0x02,0x02,0x84, 0x04,0x04,0x86]),
    Buffer.concat([Buffer.from([0x00, 0x04]), u16(1), u16(1234), u32(t)]),
    Buffer.from([0x41, 0x00, 0x00, 0x12, 0x00, 0x07, 0x05,0x01,0x00, 0x02,0x04,0x86, 0x07,0x04,0x86, 0x09,0x04,0x86, 0x0b,0x02,0x84, 0x10,0x01,0x02, 0x11,0x01,0x02]),
    Buffer.concat([Buffer.from([0x01, 0x01]), u32(t - 1800), u32(1800 * 1000), u32(5200 * 100), u16(320), Buffer.from([145, 172])]),
  ];
  const data = Buffer.concat(recs);
  const header = Buffer.concat([Buffer.from([14, 0x10]), u16(2112), u32(data.length), Buffer.from(".FIT"), u16(0)]);
  return Buffer.concat([header, data, u16(0)]);
}

async function setup() {
  const app = await getApp();
  const coach = await registerUser("COACH", "impcoach");
  const runner = await registerUser("RUNNER", "imprunner");
  const teamId = await createTeamAs(coach, "Import Team");
  await addRunnerToTeam(coach, teamId, runner);
  return { app, coach, runner, teamId };
}

async function preview(user: TestUser, buf: Buffer, filename: string, fields: Record<string, string> = {}) {
  const app = await getApp();
  let req = request(app.server).post("/api/v1/activities/import/preview").set(cookieHeader(user));
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req.attach("file", buf, filename);
}

async function confirm(user: TestUser, buf: Buffer, filename: string, fields: Record<string, string> = {}) {
  const app = await getApp();
  let req = request(app.server).post("/api/v1/activities/import/confirm").set(cookieHeader(user));
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req.attach("file", buf, filename);
}

describe("file import", () => {
  beforeEach(truncate);

  it("GPX: preview then import, duplicate rejected", async () => {
    const { runner, teamId } = await setup();
    const buf = Buffer.from(GPX, "utf-8");

    const pv = await preview(runner, buf, "morning.gpx", { teamId });
    expect(pv.status).toBe(200);
    const summary = pv.body.summary;
    expect(summary.format).toBe("GPX");
    expect(summary.kind).toBe("RUN");
    expect(summary.distanceM).toBeGreaterThan(1000); // ~1.1 km
    expect(summary.durationS).toBe(1800);
    expect(summary.alreadyImported).toBe(false);

    const cf = await confirm(runner, buf, "morning.gpx", { teamId });
    expect(cf.status).toBe(201);
    expect(cf.body.activity.source).toBe("FILE_IMPORT");
    expect(cf.body.activity.teamId).toBe(teamId);
    expect(cf.body.activity.distanceM).toBe(summary.distanceM);

    const dupe = await confirm(runner, buf, "morning.gpx", { teamId });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error.code).toBe("ALREADY_IMPORTED");
  });

  it("TCX: parses sport, HR, and calories", async () => {
    const { runner } = await setup();
    const buf = Buffer.from(TCX, "utf-8");

    const cf = await confirm(runner, buf, "run.tcx");
    expect(cf.status).toBe(201);
    const a = cf.body.activity;
    expect(a.kind).toBe("RUN");
    expect(a.distanceM).toBe(5000);
    expect(a.durationS).toBe(1500);
    expect(a.avgHrBpm).toBe(142);
    expect(a.maxHrBpm).toBe(168);
    expect(a.calories).toBe(310);
  });

  it("FIT: parses session fields", async () => {
    const { runner } = await setup();
    const startUnix = Math.floor(Date.now() / 1000) - 86400;
    const buf = buildFit(startUnix);

    const pv = await preview(runner, buf, "activity.fit");
    expect(pv.status).toBe(200);
    expect(pv.body.summary.format).toBe("FIT");
    expect(pv.body.summary.kind).toBe("RUN");

    const cf = await confirm(runner, buf, "activity.fit");
    expect(cf.status).toBe(201);
    const a = cf.body.activity;
    expect(a.distanceM).toBe(5200);
    expect(a.durationS).toBe(1800);
    expect(a.avgHrBpm).toBe(145);
    expect(a.maxHrBpm).toBe(172);
    expect(a.calories).toBe(320);
  });

  it("rejects garbage files and future-dated activities", async () => {
    const { runner } = await setup();

    const bad = await preview(runner, Buffer.from("not a workout"), "nope.txt");
    expect(bad.status).toBe(400);

    const futureGpx = GPX.replaceAll("2026-09-28", "2099-01-01");
    const cf = await confirm(runner, Buffer.from(futureGpx, "utf-8"), "future.gpx");
    expect(cf.status).toBe(400);
  });

  it("duplicate detection is per athlete", async () => {
    const { runner } = await setup();
    const other = await registerUser("RUNNER", "impother");
    const buf = Buffer.from(TCX, "utf-8");

    const r1 = await confirm(runner, buf, "run.tcx");
    expect(r1.status).toBe(201);
    // Same file bytes, different athlete: allowed.
    const r2 = await confirm(other, buf, "run.tcx");
    expect(r2.status).toBe(201);
  });
});
