import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { db } from "../src/db.js";
import {
  cookieHeader,
  getApp,
  registerUser,
  truncate,
  type TestUser,
} from "./helpers.js";

async function makeAdmin(userId: string) {
  await db.user.update({
    where: { id: userId },
    data: { systemRole: "SYSTEM_ADMIN" },
  });
}

function cookiesOf(res: { headers: Record<string, string | string[]> }): TestUser["cookies"] {
  return res.headers["set-cookie"] as string[];
}

describe("admin impersonation (View as)", () => {
  beforeEach(truncate);

  it("admin can impersonate a runner and the session behaves as the runner", async () => {
    const app = await getApp();
    const admin = await registerUser("COACH", "impadmin");
    await makeAdmin(admin.id);
    const runner = await registerUser("RUNNER", "imprunner");

    const res = await request(app.server)
      .post(`/api/v1/admin/users/${runner.id}/impersonate`)
      .set(cookieHeader(admin));
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(runner.id);
    expect(res.body.impersonated).toBe(true);

    const asRunner = { Cookie: cookiesOf(res).join("; ") };

    // /auth/me now reports the runner.
    const me = await request(app.server).get("/api/v1/auth/me").set(asRunner);
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(runner.id);

    // No admin powers leak: admin endpoints 403 for the impersonated session.
    const stats = await request(app.server)
      .get("/api/v1/admin/stats")
      .set(asRunner);
    expect(stats.status).toBe(403);
  });

  it("non-admins get 403 from the impersonate endpoint", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "impcoach");
    const runner = await registerUser("RUNNER", "imprunner2");

    const res = await request(app.server)
      .post(`/api/v1/admin/users/${runner.id}/impersonate`)
      .set(cookieHeader(coach));
    expect(res.status).toBe(403);
  });

  it("cannot impersonate another site admin", async () => {
    const app = await getApp();
    const admin = await registerUser("COACH", "impadmin2");
    await makeAdmin(admin.id);
    const admin2 = await registerUser("COACH", "impadmin3");
    await makeAdmin(admin2.id);

    const res = await request(app.server)
      .post(`/api/v1/admin/users/${admin2.id}/impersonate`)
      .set(cookieHeader(admin));
    expect(res.status).toBe(403);
  });

  it("cannot impersonate yourself or a suspended account", async () => {
    const app = await getApp();
    const admin = await registerUser("COACH", "impadmin4");
    await makeAdmin(admin.id);
    const runner = await registerUser("RUNNER", "imprunner3");

    const self = await request(app.server)
      .post(`/api/v1/admin/users/${admin.id}/impersonate`)
      .set(cookieHeader(admin));
    expect(self.status).toBe(400);

    await db.user.update({
      where: { id: runner.id },
      data: { status: "SUSPENDED" },
    });
    const susp = await request(app.server)
      .post(`/api/v1/admin/users/${runner.id}/impersonate`)
      .set(cookieHeader(admin));
    expect(susp.status).toBe(400);

    const missing = await request(app.server)
      .post("/api/v1/admin/users/00000000-0000-0000-0000-000000000000/impersonate")
      .set(cookieHeader(admin));
    expect(missing.status).toBe(404);
  });

  it("start and end are audit-logged, and exit restores the admin", async () => {
    const app = await getApp();
    const admin = await registerUser("COACH", "impadmin5");
    await makeAdmin(admin.id);
    const runner = await registerUser("RUNNER", "imprunner4");

    const start = await request(app.server)
      .post(`/api/v1/admin/users/${runner.id}/impersonate`)
      .set(cookieHeader(admin));
    expect(start.status).toBe(200);
    const asRunner = { Cookie: cookiesOf(start).join("; ") };

    const startedEvents = await db.auditLog.findMany({
      where: { action: "IMPERSONATION_STARTED" },
    });
    expect(startedEvents).toHaveLength(1);
    expect(startedEvents[0].actorId).toBe(admin.id);
    expect(startedEvents[0].entityId).toBe(runner.id);

    // Exit from the impersonated session restores the admin.
    const exit = await request(app.server)
      .post("/api/v1/admin/impersonate/exit")
      .set(asRunner);
    expect(exit.status).toBe(200);
    expect(exit.body.user.id).toBe(admin.id);
    expect(exit.body.impersonated).toBe(false);

    const asAdminAgain = { Cookie: cookiesOf(exit).join("; ") };
    const me = await request(app.server)
      .get("/api/v1/auth/me")
      .set(asAdminAgain);
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(admin.id);
    expect(me.body.user.systemRole).toBe("SYSTEM_ADMIN");

    // The impersonated session is dead: its refresh token no longer rotates.
    // (The stateless access JWT remains valid until its short expiry, exactly
    // like a normal logout — the web discards it on exit.)
    const dead = await request(app.server)
      .post("/api/v1/auth/refresh")
      .set(asRunner);
    expect(dead.status).toBe(401);

    const endedEvents = await db.auditLog.findMany({
      where: { action: "IMPERSONATION_ENDED" },
    });
    expect(endedEvents).toHaveLength(1);
    expect(endedEvents[0].actorId).toBe(admin.id);
    expect(endedEvents[0].entityId).toBe(runner.id);
  });

  it("exit without an impersonated session is rejected", async () => {
    const app = await getApp();
    const runner = await registerUser("RUNNER", "imprunner5");

    const res = await request(app.server)
      .post("/api/v1/admin/impersonate/exit")
      .set(cookieHeader(runner));
    expect(res.status).toBe(403);
  });

  it("exit still works after the impersonated session's token rotates", async () => {
    const app = await getApp();
    const admin = await registerUser("COACH", "impadmin6");
    await makeAdmin(admin.id);
    const runner = await registerUser("RUNNER", "imprunner6");

    const start = await request(app.server)
      .post(`/api/v1/admin/users/${runner.id}/impersonate`)
      .set(cookieHeader(admin));
    expect(start.status).toBe(200);
    let jar = { Cookie: cookiesOf(start).join("; ") };

    // Rotate the impersonated session's refresh token.
    const refreshed = await request(app.server)
      .post("/api/v1/auth/refresh")
      .set(jar);
    expect(refreshed.status).toBe(200);
    jar = { Cookie: cookiesOf(refreshed).join("; ") };

    const exit = await request(app.server)
      .post("/api/v1/admin/impersonate/exit")
      .set(jar);
    expect(exit.status).toBe(200);
    expect(exit.body.user.id).toBe(admin.id);
  });
});
