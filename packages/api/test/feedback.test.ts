import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { getApp, registerUser, truncate, cookieHeader } from "./helpers.js";

describe("feedback", () => {
  beforeEach(truncate);

  it("user can submit and list own feedback; admin can triage", async () => {
    const app = await getApp();
    const user = await registerUser("RUNNER", "fb1");
    const admin = await registerUser("COACH", "fb2");
    // grant system admin directly
    const { db } = await import("../src/db.js");
    await db.user.update({
      where: { id: admin.id },
      data: { systemRole: "SYSTEM_ADMIN" },
    });

    const sub = await request(app.server)
      .post("/api/v1/feedback")
      .set(cookieHeader(user))
      .send({ category: "FEATURE", body: "Add dark mode please" });
    expect(sub.status).toBe(201);

    const mine = await request(app.server)
      .get("/api/v1/feedback/mine")
      .set(cookieHeader(user));
    expect(mine.body.feedback).toHaveLength(1);

    // non-admin cannot see all
    const denied = await request(app.server)
      .get("/api/v1/admin/feedback")
      .set(cookieHeader(user));
    expect(denied.status).toBe(403);

    const all = await request(app.server)
      .get("/api/v1/admin/feedback")
      .set(cookieHeader(admin));
    expect(all.body.feedback).toHaveLength(1);
    expect(all.body.feedback[0].userName).toBeTruthy();

    const triage = await request(app.server)
      .patch(`/api/v1/admin/feedback/${sub.body.feedback.id}`)
      .set(cookieHeader(admin))
      .send({ status: "REVIEWED" });
    expect(triage.body.status).toBe("REVIEWED");
  });
});
