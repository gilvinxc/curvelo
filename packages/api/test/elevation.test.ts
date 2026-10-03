import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  getApp,
  registerUser,
  truncate,
  cookieHeader,
  TestUser,
} from "./helpers.js";

const GPX_ELEV = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="curvelo-test">
  <trk><name>Hilly run</name><type>running</type>
    <trkseg>
      <trkpt lat="38.0000" lon="-84.0000"><ele>280</ele><time>2026-09-28T12:00:00Z</time></trkpt>
      <trkpt lat="38.0050" lon="-84.0000"><ele>292</ele><time>2026-09-28T12:15:00Z</time></trkpt>
      <trkpt lat="38.0100" lon="-84.0000"><ele>285</ele><time>2026-09-28T12:30:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;
// Gain: 280 -> 292 (+12), 292 -> 285 (+0) = 12m

const TCX_ELEV = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Running">
      <Id>2026-09-27T12:00:00Z</Id>
      <Lap StartTime="2026-09-27T12:00:00Z">
        <TotalTimeSeconds>1500</TotalTimeSeconds>
        <DistanceMeters>5000</DistanceMeters>
        <Track>
          <Trackpoint><Time>2026-09-27T12:00:00Z</Time><AltitudeMeters>100</AltitudeMeters></Trackpoint>
          <Trackpoint><Time>2026-09-27T12:10:00Z</Time><AltitudeMeters>115</AltitudeMeters></Trackpoint>
          <Trackpoint><Time>2026-09-27T12:20:00Z</Time><AltitudeMeters>110</AltitudeMeters></Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;
// Gain: 100 -> 115 (+15), 115 -> 110 (+0) = 15m

/** Hand-built FIT with total_ascent = 87m in the session. */
function buildFitElev(startUnix: number): Buffer {
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
    // Session definition: 8 fields, adding total_ascent (field 22, uint16).
    Buffer.from([0x41, 0x00, 0x00, 0x12, 0x00, 0x08, 0x05,0x01,0x00, 0x02,0x04,0x86, 0x07,0x04,0x86, 0x09,0x04,0x86, 0x0b,0x02,0x84, 0x10,0x01,0x02, 0x11,0x01,0x02, 0x16,0x02,0x84]),
    Buffer.concat([Buffer.from([0x01, 0x01]), u32(t - 1800), u32(1800 * 1000), u32(5200 * 100), u16(320), Buffer.from([145, 172]), u16(87)]),
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

describe("elevation", () => {
  beforeEach(truncate);

  it("manual elevation is saved and returned", async () => {
    const app = await getApp();
    const runner = await registerUser("RUNNER", "elev1");
    const res = await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(runner))
      .send({
        kind: "RUN",
        startedAt: "2026-09-18T13:00:00Z",
        distanceM: 8000,
        durationS: 2400,
        elevationGainM: 132.5,
      });
    expect(res.status).toBe(201);
    expect(res.body.activity.elevationGainM).toBe(132.5);

    const id = res.body.activity.id;
    const got = await request(app.server)
      .get(`/api/v1/activities/${id}`)
      .set(cookieHeader(runner));
    expect(got.status).toBe(200);
    expect(got.body.activity.elevationGainM).toBe(132.5);
  });

  it("elevation is optional; omitted stays null", async () => {
    const app = await getApp();
    const runner = await registerUser("RUNNER", "elev2");
    const res = await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(runner))
      .send({
        kind: "RUN",
        startedAt: "2026-09-18T13:00:00Z",
        distanceM: 8000,
        durationS: 2400,
      });
    expect(res.status).toBe(201);
    expect(res.body.activity.elevationGainM).toBeNull();
  });

  it("negative elevation is rejected", async () => {
    const app = await getApp();
    const runner = await registerUser("RUNNER", "elev3");
    const res = await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(runner))
      .send({
        kind: "RUN",
        startedAt: "2026-09-18T13:00:00Z",
        distanceM: 8000,
        durationS: 2400,
        elevationGainM: -5,
      });
    expect(res.status).toBe(400);
  });

  it("elevation can be updated after logging", async () => {
    const app = await getApp();
    const runner = await registerUser("RUNNER", "elev4");
    const created = await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(runner))
      .send({
        kind: "RUN",
        startedAt: "2026-09-18T13:00:00Z",
        distanceM: 8000,
        durationS: 2400,
      });
    const id = created.body.activity.id;
    const upd = await request(app.server)
      .patch(`/api/v1/activities/${id}`)
      .set(cookieHeader(runner))
      .send({ elevationGainM: 75 });
    expect(upd.status).toBe(200);
    expect(upd.body.activity.elevationGainM).toBe(75);
  });

  it("GPX import auto-fills elevation from trackpoint <ele>", async () => {
    const runner = await registerUser("RUNNER", "elev5");
    const cf = await importFile(runner, Buffer.from(GPX_ELEV, "utf-8"), "hilly.gpx");
    expect(cf.status).toBe(201);
    expect(cf.body.activity.elevationGainM).toBe(12);
  });

  it("TCX import auto-fills elevation from AltitudeMeters", async () => {
    const runner = await registerUser("RUNNER", "elev6");
    const cf = await importFile(runner, Buffer.from(TCX_ELEV, "utf-8"), "hilly.tcx");
    expect(cf.status).toBe(201);
    expect(cf.body.activity.elevationGainM).toBe(15);
  });

  it("FIT import auto-fills elevation from total_ascent", async () => {
    const runner = await registerUser("RUNNER", "elev7");
    const startUnix = Math.floor(Date.now() / 1000) - 7200;
    const cf = await importFile(runner, buildFitElev(startUnix), "hilly.fit");
    expect(cf.status).toBe(201);
    expect(cf.body.activity.elevationGainM).toBe(87);
  });
});
