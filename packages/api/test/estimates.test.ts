import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  getApp,
  registerUser,
  truncate,
  cookieHeader,
} from "./helpers.js";

async function logRun(
  app: Awaited<ReturnType<typeof getApp>>,
  user: { cookies: string[] },
  body: Record<string, unknown>,
) {
  return request(app.server)
    .post("/api/v1/activities")
    .set(cookieHeader(user as never))
    .send({
      kind: "RUN",
      startedAt: new Date(Date.now() - 3600000).toISOString(),
      ...body,
    });
}

describe("steps and calorie estimates", () => {
  beforeEach(truncate);

  it("estimates steps and calories from profile height/weight", async () => {
    const app = await getApp();
    const user = await registerUser("RUNNER", "est1");
    await request(app.server)
      .patch("/api/v1/users/me")
      .set(cookieHeader(user))
      .send({ heightCm: 178, weightKg: 70 });

    // 5k @ 178cm: steps ≈ 5000 / (1.78*0.413) ≈ 6801; kcal ≈ 1.03*70*5 ≈ 361
    const res = await logRun(app, user, { distanceM: 5000, durationS: 1500 });
    expect(res.status).toBe(201);
    expect(res.body.activity.steps).toBe(6801);
    expect(res.body.activity.calories).toBe(361);
  });

  it("user-provided values always win; no profile data means no estimates", async () => {
    const app = await getApp();
    const user = await registerUser("RUNNER", "est2");

    const res = await logRun(app, user, {
      distanceM: 5000,
      durationS: 1500,
      calories: 400,
      steps: 7000,
    });
    expect(res.status).toBe(201);
    expect(res.body.activity.calories).toBe(400);
    expect(res.body.activity.steps).toBe(7000);

    const bare = await logRun(app, user, { distanceM: 3000, durationS: 900 });
    expect(bare.status).toBe(201);
    expect(bare.body.activity.calories).toBeNull();
    expect(bare.body.activity.steps).toBeNull();
  });

  it("estimates from duration when there is no distance (strength)", async () => {
    const app = await getApp();
    const user = await registerUser("RUNNER", "est3");
    await request(app.server)
      .patch("/api/v1/users/me")
      .set(cookieHeader(user))
      .send({ weightKg: 80 });

    // STRENGTH 5 MET × 80kg × 1h = 400
    const res = await logRun(app, user, {
      kind: "STRENGTH",
      durationS: 3600,
    });
    expect(res.status).toBe(201);
    expect(res.body.activity.calories).toBe(400);
    expect(res.body.activity.steps).toBeNull();
  });
});
