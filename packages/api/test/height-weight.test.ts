import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  getApp,
  registerUser,
  truncate,
  cookieHeader,
} from "./helpers.js";

describe("height and weight", () => {
  beforeEach(truncate);

  it("profile stores height and weight with sane ranges", async () => {
    const app = await getApp();
    const user = await registerUser("RUNNER", "hw1");

    const ok = await request(app.server)
      .patch("/api/v1/users/me")
      .set(cookieHeader(user))
      .send({ heightCm: 178, weightKg: 70 });
    expect(ok.status).toBe(200);
    expect(ok.body.user.profile.heightCm).toBe(178);
    expect(ok.body.user.profile.weightKg).toBe(70);

    const badWeight = await request(app.server)
      .patch("/api/v1/users/me")
      .set(cookieHeader(user))
      .send({ weightKg: 5 });
    expect(badWeight.status).toBe(400);

    const badHeight = await request(app.server)
      .patch("/api/v1/users/me")
      .set(cookieHeader(user))
      .send({ heightCm: 400 });
    expect(badHeight.status).toBe(400);
  });

  it("logging an activity with weight updates the profile", async () => {
    const app = await getApp();
    const user = await registerUser("RUNNER", "hw2");

    const created = await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(user))
      .send({
        kind: "RUN",
        startedAt: new Date(Date.now() - 3600000).toISOString(),
        distanceM: 5000,
        durationS: 1500,
        weightKg: 72,
      });
    expect(created.status).toBe(201);

    const me = await request(app.server)
      .get("/api/v1/users/me")
      .set(cookieHeader(user));
    expect(me.body.user.profile.weightKg).toBe(72);

    const updated = await request(app.server)
      .patch(`/api/v1/activities/${created.body.activity.id}`)
      .set(cookieHeader(user))
      .send({ weightKg: 71 });
    expect(updated.status).toBe(200);

    const me2 = await request(app.server)
      .get("/api/v1/users/me")
      .set(cookieHeader(user));
    expect(me2.body.user.profile.weightKg).toBe(71);

    const bad = await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(user))
      .send({
        kind: "RUN",
        startedAt: new Date(Date.now() - 3600000).toISOString(),
        distanceM: 1000,
        weightKg: 600,
      });
    expect(bad.status).toBe(400);
  });
});
