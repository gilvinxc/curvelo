import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { cookieHeader, getApp, registerUser, truncate } from "./helpers.js";

describe("trackers", () => {
  beforeEach(truncate);

  it("reports COROS as not connected by default", async () => {
    const app = await getApp();
    const runner = await registerUser("RUNNER", "trackrunner");
    const res = await request(app.server)
      .get("/api/v1/trackers/status")
      .set(cookieHeader(runner));
    expect(res.status).toBe(200);
    expect(res.body.trackers).toHaveLength(1);
    expect(res.body.trackers[0].provider).toBe("COROS");
    expect(res.body.trackers[0].connected).toBe(false);
  });

  it("rejects sync when not connected", async () => {
    const app = await getApp();
    const runner = await registerUser("RUNNER", "trackrunner2");
    const res = await request(app.server)
      .post("/api/v1/trackers/coros/sync")
      .set(cookieHeader(runner));
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
  });

  it("requires auth for tracker endpoints", async () => {
    const app = await getApp();
    const res = await request(app.server).get("/api/v1/trackers/status");
    expect(res.status).toBe(401);
  });
});
