import request from "supertest";
import { buildApp } from "../src/app.js";
import { db } from "../src/db.js";

let app: Awaited<ReturnType<typeof buildApp>> | null = null;

export async function getApp() {
  if (!app) {
    app = await buildApp();
    await app.ready();
  }
  return app;
}

export async function truncate() {
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE "AuditLog", "RefreshToken", "Invitation", "TeamMembership",
      "GuardianLink", "Season", "ComplianceRule", "Team", "Profile",
      "Organization", "User"
    RESTART IDENTITY CASCADE
  `);
}

export interface TestUser {
  id: string;
  email: string;
  cookies: string[];
}

let counter = 0;

export async function registerUser(
  role: "COACH" | "RUNNER" = "RUNNER",
  emailPrefix = "user",
): Promise<TestUser> {
  const a = await getApp();
  counter += 1;
  const email = `${emailPrefix}${counter}@example.com`;
  const res = await request(a.server)
    .post("/api/v1/auth/register")
    .send({
      email,
      password: "supersecretpassword",
      displayName: `${emailPrefix} ${counter}`,
      role,
    });
  if (res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return {
    id: res.body.user.id as string,
    email,
    cookies: res.headers["set-cookie"] as string[],
  };
}

export function cookieHeader(user: TestUser): Record<string, string> {
  return { Cookie: user.cookies.join("; ") };
}

export function refreshCookie(cookies: string[]): string | undefined {
  const found = cookies.find((c) => c.startsWith("cv_refresh="));
  return found?.split(";")[0];
}
