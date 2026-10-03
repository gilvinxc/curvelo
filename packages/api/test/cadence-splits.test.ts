import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  getApp,
  registerUser,
  truncate,
  cookieHeader,
  TestUser,
} from "./helpers.js";
import { db } from "../src/db.js";

const TCX_CAD_SPLITS = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Running">
      <Id>2026-09-27T12:00:00Z</Id>
      <Lap StartTime="2026-09-27T12:00:00Z">
        <TotalTimeSeconds>600</TotalTimeSeconds>
        <DistanceMeters>1609.344</DistanceMeters>
        <Track>
          <Trackpoint><Time>2026-09-27T12:00:00Z</Time><Cadence>168</Cadence></Trackpoint>
          <Trackpoint><Time>2026-09-27T12:05:00Z</Time><Cadence>172</Cadence></Trackpoint>
        </Track>
      </Lap>
      <Lap StartTime="2026-09-27T12:10:00Z">
        <TotalTimeSeconds>590</TotalTimeSeconds>
        <DistanceMeters>1609.344</DistanceMeters>
        <Track>
          <Trackpoint><Time>2026-09-27T12:10:00Z</Time><Cadence>174</Cadence></Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;
// Cadence avg: (168+172+174)/3 = 171.33 -> 171

const GPX_CAD = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="curvelo-test">
  <trk><name>Cadence run</name><type>running</type>
    <trkseg>
      <trkpt lat="38.0000" lon="-84.0000"><time>2026-09-28T12:00:00Z</time><extensions><gpxtpx:TrackPointExtension xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><gpxtpx:cad>165</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>
      <trkpt lat="38.0050" lon="-84.0000"><time>2026-09-28T12:15:00Z</time><extensions><gpxtpx:TrackPointExtension xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><gpxtpx:cad>175</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>
    </trkseg>
  </trk>
</gpx>`;
// Cadence avg: (165+175)/2 = 170

/** Hand-built FIT with session avg_cadence = 85 (strides) -> 170 spm, and 2 laps. */
function buildFitCadSplits(startUnix: number): Buffer {
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
    // File ID definition + data (same shape as elevation test).
    Buffer.from([0x40, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00,0x01,0x00, 0x01,0x02,0x84, 0x02,0x02,0x84, 0x04,0x04,0x86]),
    Buffer.concat([Buffer.from([0x00, 0x04]), u16(1), u16(1234), u32(t)]),
    // Session definition: 9 fields, adding avg_cadence (field 18, uint8).
    Buffer.from([0x41, 0x00, 0x00, 0x12, 0x00, 0x09, 0x05,0x01,0x00, 0x02,0x04,0x86, 0x07,0x04,0x86, 0x09,0x04,0x86, 0x0b,0x02,0x84, 0x10,0x01,0x02, 0x11,0x01,0x02, 0x16,0x02,0x84, 0x12,0x01,0x02]),
    Buffer.concat([Buffer.from([0x01, 0x01]), u32(t - 1200), u32(1200 * 1000), u32(3218 * 100), u16(320), Buffer.from([145, 172]), u16(87), Buffer.from([85])]),
    // Lap definition (global 19): timestamp(253,u32), total_elapsed_time(7,u32), total_distance(9,u32).
    Buffer.from([0x42, 0x00, 0x00, 0x13, 0x00, 0x03, 0xfd,0x04,0x86, 0x07,0x04,0x86, 0x09,0x04,0x86]),
    Buffer.concat([Buffer.from([0x02]), u32(t - 1200), u32(600 * 1000), u32(1609 * 100)]),
    Buffer.concat([Buffer.from([0x02]), u32(t - 600), u32(600 * 1000), u32(1609 * 100)]),
  ];
  const data = Buffer.concat(recs);
  const header = Buffer.concat([Buffer.from([14, 0x10]), u16(2112), u32(data.length), Buffer.from(".FIT"), u16(0)]);
  return Buffer.concat([header, data, u16(0)]);
}

async function importFile(user: TestUser, buf: Buffer, filename: string) {
  const app = await getApp();
  return request(app.server)
    .post("/api/v1/activities/import/confirm")
    .set(cookieHeader(user))
    .attach("file", buf, filename);
}

async function logRun(user: TestUser, body: Record<string, unknown>) {
  const app = await getApp();
  return request(app.server)
    .post("/api/v1/activities")
    .set(cookieHeader(user))
    .send({ kind: "RUN", startedAt: "2026-09-18T13:00:00Z", distanceM: 8000, durationS: 2400, ...body });
}

describe("cadence", () => {
  beforeEach(truncate);

  it("manual cadence is saved and returned", async () => {
    const runner = await registerUser("RUNNER", "cad1");
    const res = await logRun(runner, { avgCadenceSpm: 172 });
    expect(res.status).toBe(201);
    expect(res.body.activity.avgCadenceSpm).toBe(172);
  });

  it("cadence is optional; omitted stays null", async () => {
    const runner = await registerUser("RUNNER", "cad2");
    const res = await logRun(runner, {});
    expect(res.status).toBe(201);
    expect(res.body.activity.avgCadenceSpm).toBeNull();
  });

  it("out-of-range cadence is rejected", async () => {
    const runner = await registerUser("RUNNER", "cad3");
    for (const v of [-5, 301]) {
      const res = await logRun(runner, { avgCadenceSpm: v });
      expect(res.status).toBe(400);
    }
  });

  it("TCX import auto-fills cadence", async () => {
    const runner = await registerUser("RUNNER", "cad4");
    const res = await importFile(runner, Buffer.from(TCX_CAD_SPLITS), "cad.tcx");
    expect(res.status).toBe(201);
    expect(res.body.activity.avgCadenceSpm).toBe(171);
  });

  it("GPX import auto-fills cadence from extensions", async () => {
    const runner = await registerUser("RUNNER", "cad5");
    const res = await importFile(runner, Buffer.from(GPX_CAD), "cad.gpx");
    expect(res.status).toBe(201);
    expect(res.body.activity.avgCadenceSpm).toBe(170);
  });

  it("FIT import converts session avg_cadence strides to spm", async () => {
    const runner = await registerUser("RUNNER", "cad6");
    const buf = buildFitCadSplits(Math.floor(Date.now() / 1000) - 86400);
    const res = await importFile(runner, buf, "cad.fit");
    expect(res.status).toBe(201);
    expect(res.body.activity.avgCadenceSpm).toBe(170);
  });
});

describe("lap splits", () => {
  beforeEach(truncate);

  it("manual splits are saved, ordered, and returned on detail", async () => {
    const runner = await registerUser("RUNNER", "spl1");
    const res = await logRun(runner, {
      splits: [
        { distanceM: 1609, durationS: 400 },
        { distanceM: 1609, durationS: 390 },
      ],
    });
    expect(res.status).toBe(201);
    const splits = res.body.activity.splits;
    expect(splits).toHaveLength(2);
    expect(splits[0].position).toBe(0);
    expect(splits[0].distanceM).toBe(1609);
    expect(splits[0].durationS).toBe(400);
    expect(splits[1].position).toBe(1);

    const app = await getApp();
    const got = await request(app.server)
      .get(`/api/v1/activities/${res.body.activity.id}`)
      .set(cookieHeader(runner));
    expect(got.body.activity.splits).toHaveLength(2);
    expect(got.body.activity.splits.map((s: { position: number }) => s.position)).toEqual([0, 1]);
  });

  it("update replaces splits entirely", async () => {
    const runner = await registerUser("RUNNER", "spl2");
    const created = await logRun(runner, {
      splits: [{ distanceM: 1000, durationS: 300 }],
    });
    expect(created.status).toBe(201);
    const id = created.body.activity.id;

    const app = await getApp();
    const upd = await request(app.server)
      .patch(`/api/v1/activities/${id}`)
      .set(cookieHeader(runner))
      .send({
        splits: [
          { distanceM: 2000, durationS: 600 },
          { distanceM: 2000, durationS: 590 },
          { distanceM: 1000 },
        ],
      });
    expect(upd.status).toBe(200);
    expect(upd.body.activity.splits).toHaveLength(3);
    expect(upd.body.activity.splits[2].durationS).toBeNull();

    // Omitting splits leaves them alone.
    const upd2 = await request(app.server)
      .patch(`/api/v1/activities/${id}`)
      .set(cookieHeader(runner))
      .send({ notes: "hello" });
    expect(upd2.status).toBe(200);
    expect(upd2.body.activity.splits).toHaveLength(3);
  });

  it("split with neither distance nor duration is rejected", async () => {
    const runner = await registerUser("RUNNER", "spl3");
    const res = await logRun(runner, { splits: [{}] });
    expect(res.status).toBe(400);
  });

  it("TCX import auto-fills lap splits", async () => {
    const runner = await registerUser("RUNNER", "spl4");
    const res = await importFile(runner, Buffer.from(TCX_CAD_SPLITS), "splits.tcx");
    expect(res.status).toBe(201);
    const splits = res.body.activity.splits;
    expect(splits).toHaveLength(2);
    expect(splits[0].distanceM).toBe(1609);
    expect(splits[0].durationS).toBe(600);
    expect(splits[1].durationS).toBe(590);
  });

  it("FIT import auto-fills lap splits", async () => {
    const runner = await registerUser("RUNNER", "spl5");
    const buf = buildFitCadSplits(Math.floor(Date.now() / 1000) - 86400);
    const res = await importFile(runner, buf, "splits.fit");
    expect(res.status).toBe(201);
    expect(res.body.activity.splits).toHaveLength(2);
    expect(res.body.activity.splits[0].distanceM).toBe(1609);
  });

  it("deleting an activity cascades its splits", async () => {
    const runner = await registerUser("RUNNER", "spl6");
    const created = await logRun(runner, {
      splits: [{ distanceM: 1000, durationS: 300 }],
    });
    const id = created.body.activity.id;
    expect(await db.activitySplit.count({ where: { activityId: id } })).toBe(1);

    const app = await getApp();
    const del = await request(app.server)
      .delete(`/api/v1/activities/${id}`)
      .set(cookieHeader(runner));
    expect(del.status).toBe(200);
    expect(await db.activitySplit.count({ where: { activityId: id } })).toBe(0);
  });
});
