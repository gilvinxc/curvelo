import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { getApp, registerUser, truncate, cookieHeader, refreshCookie } from "./helpers.js";

describe("auth", () => {
  beforeEach(truncate);

  it("registers a coach and returns a session (no password hash leaked)", async () => {
    const app = await getApp();
    const res = await request(app.server).post("/api/v1/auth/register").send({
      email: "coach@example.com",
      password: "supersecretpassword",
      displayName: "Coach Carter",
      role: "COACH",
    });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("coach@example.com");
    expect(res.body.user).not.toHaveProperty("passwordHash");
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("rejects duplicate email", async () => {
    const app = await getApp();
    await registerUser("RUNNER", "dupe");
    const res = await request(app.server).post("/api/v1/auth/register").send({
      email: "dupe1@example.com",
      password: "supersecretpassword",
      displayName: "Dupe",
      role: "RUNNER",
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("rejects weak password and bad input with validation errors", async () => {
    const app = await getApp();
    const res = await request(app.server).post("/api/v1/auth/register").send({
      email: "not-an-email",
      password: "short",
      displayName: "",
      role: "COACH",
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("logs in, and rejects bad credentials without enumerating accounts", async () => {
    const app = await getApp();
    const user = await registerUser("RUNNER", "login");

    const ok = await request(app.server).post("/api/v1/auth/login").send({
      email: user.email,
      password: "supersecretpassword",
    });
    expect(ok.status).toBe(200);
    expect(ok.body.user.id).toBe(user.id);

    const badPass = await request(app.server).post("/api/v1/auth/login").send({
      email: user.email,
      password: "wrongpassword",
    });
    const noUser = await request(app.server).post("/api/v1/auth/login").send({
      email: "nobody@example.com",
      password: "wrongpassword",
    });
    expect(badPass.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(badPass.body.error.message).toBe(noUser.body.error.message);
  });

  it("serves /auth/me with cookies and 401s without", async () => {
    const app = await getApp();
    const user = await registerUser("COACH", "me");
    const authed = await request(app.server)
      .get("/api/v1/auth/me")
      .set(cookieHeader(user));
    expect(authed.status).toBe(200);
    expect(authed.body.user.email).toBe(user.email);

    const anon = await request(app.server).get("/api/v1/auth/me");
    expect(anon.status).toBe(401);
  });

  it("rotates refresh tokens and detects reuse", async () => {
    const app = await getApp();
    const user = await registerUser("RUNNER", "rot");
    const oldRefresh = refreshCookie(user.cookies)!;

    const rotated = await request(app.server)
      .post("/api/v1/auth/refresh")
      .set("Cookie", oldRefresh);
    expect(rotated.status).toBe(200);
    const newRefresh = refreshCookie(rotated.headers["set-cookie"] as string[])!;
    expect(newRefresh).not.toBe(oldRefresh);

    // Reusing the old (rotated) token = theft signal → 401, family killed.
    const reuse = await request(app.server)
      .post("/api/v1/auth/refresh")
      .set("Cookie", oldRefresh);
    expect(reuse.status).toBe(401);

    // The family's newest token is dead too after reuse detection.
    const afterTheft = await request(app.server)
      .post("/api/v1/auth/refresh")
      .set("Cookie", newRefresh);
    expect(afterTheft.status).toBe(401);
  });

  it("logout kills the session", async () => {
    const app = await getApp();
    const user = await registerUser("RUNNER", "logout");
    const rc = refreshCookie(user.cookies)!;

    const out = await request(app.server)
      .post("/api/v1/auth/logout")
      .set("Cookie", rc);
    expect(out.status).toBe(200);

    const again = await request(app.server)
      .post("/api/v1/auth/refresh")
      .set("Cookie", rc);
    expect(again.status).toBe(401);
  });

  it("forgot password: full reset flow, single-use token, sessions revoked", async () => {
    const { takeOutbox } = await import("../src/lib/mail.js");
    const app = await getApp();
    const user = await registerUser("RUNNER", "resetme");
    const rc = refreshCookie(user.cookies)!;

    const req = await request(app.server)
      .post("/api/v1/auth/forgot-password")
      .send({ email: user.email });
    expect(req.status).toBe(200);
    expect(req.body.ok).toBe(true);

    const sent = takeOutbox();
    expect(sent).toHaveLength(1);
    const token = sent[0].text.match(/token=([a-f0-9]{64})/)?.[1];
    expect(token).toBeTruthy();

    // Unknown email: same 200, no mail sent (no account enumeration).
    const unknown = await request(app.server)
      .post("/api/v1/auth/forgot-password")
      .send({ email: "nobody@example.com" });
    expect(unknown.status).toBe(200);
    expect(takeOutbox()).toHaveLength(0);

    const reset = await request(app.server)
      .post("/api/v1/auth/reset-password")
      .send({ token, password: "brand-new-password-123" });
    expect(reset.status).toBe(200);

    // Token is single-use.
    const reuse = await request(app.server)
      .post("/api/v1/auth/reset-password")
      .send({ token, password: "another-new-password-123" });
    expect(reuse.status).toBe(400);

    // Old password no longer works; new one does.
    const oldLogin = await request(app.server)
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: "supersecretpassword" });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app.server)
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: "brand-new-password-123" });
    expect(newLogin.status).toBe(200);

    // Pre-reset session was revoked.
    const stale = await request(app.server)
      .post("/api/v1/auth/refresh")
      .set("Cookie", rc);
    expect(stale.status).toBe(401);
  });
});
