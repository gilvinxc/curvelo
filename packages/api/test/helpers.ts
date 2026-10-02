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

export async function createTeamAs(coach: TestUser, name: string): Promise<string> {
  const app = await getApp();
  const res = await request(app.server)
    .post("/api/v1/teams")
    .set(cookieHeader(coach))
    .send({ name });
  if (res.status !== 201) throw new Error(`createTeam failed: ${res.status}`);
  return res.body.team.id as string;
}

export const INTERVAL_WORKOUT = {
  title: "6x800m Intervals",
  description: "Classic VO2max session",
  kind: "INTERVAL",
  steps: [
    { kind: "WARMUP", distanceM: 1600, targetRpe: 4 },
    { kind: "INTERVAL", distanceM: 800, repetitions: 6, targetPaceS: 200, notes: "2:00 rest between" },
    { kind: "RECOVERY", durationS: 120, repetitions: 6 },
    { kind: "COOLDOWN", distanceM: 1600, targetRpe: 3 },
  ],
};

export async function createWorkoutAs(
  coach: TestUser,
  teamId: string,
  body: object = INTERVAL_WORKOUT,
): Promise<{ id: string }> {
  const app = await getApp();
  const res = await request(app.server)
    .post(`/api/v1/teams/${teamId}/workouts`)
    .set(cookieHeader(coach))
    .send(body);
  if (res.status !== 201) {
    throw new Error(`createWorkout failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.workout;
}

export async function addRunnerToTeam(
  coach: TestUser,
  teamId: string,
  runner: TestUser,
): Promise<void> {
  const app = await getApp();
  const invite = await request(app.server)
    .post(`/api/v1/teams/${teamId}/invitations`)
    .set(cookieHeader(coach))
    .send({ email: runner.email, role: "RUNNER" });
  if (invite.status !== 201) throw new Error("invite failed");
  const accept = await request(app.server)
    .post(`/api/v1/invitations/${invite.body.invitation.token}/accept`)
    .set(cookieHeader(runner));
  if (accept.status !== 200) throw new Error("accept failed");
}

export function refreshCookie(cookies: string[]): string | undefined {
  const found = cookies.find((c) => c.startsWith("cv_refresh="));
  return found?.split(";")[0];
}
