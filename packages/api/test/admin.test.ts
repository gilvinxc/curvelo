import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { db } from "../src/db.js";
import {
  cookieHeader,
  getApp,
  registerUser,
  truncate,
} from "./helpers.js";

async function makeAdmin(userId: string) {
  await db.user.update({
    where: { id: userId },
    data: { systemRole: "SYSTEM_ADMIN" },
  });
}

describe("admin", () => {
  beforeEach(truncate);

  it("non-admins are rejected from admin endpoints", async () => {
    const app = await getApp();
    const runner = await registerUser("RUNNER", "noadmin");
    for (const path of ["/api/v1/admin/stats", "/api/v1/admin/users", "/api/v1/admin/teams", "/api/v1/admin/audit"]) {
      const res = await request(app.server)
        .get(path)
        .set(cookieHeader(runner));
      expect(res.status).toBe(403);
    }
  });

  it("admin manages users: suspend, reactivate, grant admin", async () => {
    const app = await getApp();
    const admin = await registerUser("COACH", "adminone");
    await makeAdmin(admin.id);
    // Re-login so the session carries the role.
    const relog = await request(app.server).post("/api/v1/auth/login").send({
      email: admin.email,
      password: "supersecretpassword",
    });
    const adminCookies = relog.headers["set-cookie"] as string[];
    const adminHeader = { Cookie: (adminCookies as string[]).join("; ") };

    const runner = await registerUser("RUNNER", "managed");

    const list = await request(app.server)
      .get("/api/v1/admin/users?search=managed")
      .set(adminHeader);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.users[0].email).toBe(runner.email);

    // Suspend: login fails, sessions revoked.
    const susp = await request(app.server)
      .patch(`/api/v1/admin/users/${runner.id}`)
      .set(adminHeader)
      .send({ status: "SUSPENDED" });
    expect(susp.status).toBe(200);
    expect(susp.body.user.status).toBe("SUSPENDED");

    const loginAttempt = await request(app.server)
      .post("/api/v1/auth/login")
      .send({ email: runner.email, password: "supersecretpassword" });
    expect(loginAttempt.status).toBe(403);
    expect(loginAttempt.body.error.code).toBe("ACCOUNT_DISABLED");

    // Reactivate.
    const react = await request(app.server)
      .patch(`/api/v1/admin/users/${runner.id}`)
      .set(adminHeader)
      .send({ status: "ACTIVE" });
    expect(react.body.user.status).toBe("ACTIVE");

    // Grant admin.
    const grant = await request(app.server)
      .patch(`/api/v1/admin/users/${runner.id}`)
      .set(adminHeader)
      .send({ systemRole: "SYSTEM_ADMIN" });
    expect(grant.body.user.systemRole).toBe("SYSTEM_ADMIN");

    // Admin cannot change their own role.
    const self = await request(app.server)
      .patch(`/api/v1/admin/users/${admin.id}`)
      .set(adminHeader)
      .send({ systemRole: null });
    expect(self.status).toBe(400);
  });

  it("admin sees stats, teams, and the audit log", async () => {
    const app = await getApp();
    const admin = await registerUser("COACH", "admintwo");
    await makeAdmin(admin.id);
    const relog = await request(app.server).post("/api/v1/auth/login").send({
      email: admin.email,
      password: "supersecretpassword",
    });
    const adminHeader = {
      Cookie: (relog.headers["set-cookie"] as string[]).join("; "),
    };

    const stats = await request(app.server)
      .get("/api/v1/admin/stats")
      .set(adminHeader);
    expect(stats.status).toBe(200);
    expect(stats.body.stats.users).toBeGreaterThanOrEqual(1);

    const teams = await request(app.server)
      .get("/api/v1/admin/teams")
      .set(adminHeader);
    expect(teams.status).toBe(200);

    const audit = await request(app.server)
      .get("/api/v1/admin/audit?action=USER_LOGIN")
      .set(adminHeader);
    expect(audit.status).toBe(200);
    expect(audit.body.total).toBeGreaterThanOrEqual(1);
    expect(audit.body.events[0].action).toBe("USER_LOGIN");
    expect(audit.body.events[0].actorName).toBeTruthy();
  });
});
