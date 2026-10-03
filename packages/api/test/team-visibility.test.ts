import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  getApp,
  registerUser,
  truncate,
  cookieHeader,
  createTeamAs,
  addRunnerToTeam,
  type TestUser,
} from "./helpers.js";

async function makePublicTeam(coach: TestUser, name: string, city?: string) {
  const app = await getApp();
  const res = await request(app.server)
    .post("/api/v1/teams")
    .set(cookieHeader(coach))
    .send({ name, visibility: "PUBLIC", city });
  if (res.status !== 201) throw new Error(`public team failed: ${res.status}`);
  return res.body.team as { id: string };
}

describe("team visibility + directory", () => {
  let coach: TestUser;
  let runner: TestUser;
  let outsider: TestUser;
  let privateTeamId: string;
  let publicTeamId: string;

  beforeEach(async () => {
    await truncate();
    coach = await registerUser("COACH", "tv-coach");
    runner = await registerUser("RUNNER", "tv-runner");
    outsider = await registerUser("RUNNER", "tv-outsider");
    privateTeamId = await createTeamAs(coach, "Hidden Harriers");
    await addRunnerToTeam(coach, privateTeamId, runner);
    publicTeamId = (await makePublicTeam(coach, "Open Road Runners", "Lexington")).id;
  });

  it("directory lists only PUBLIC teams", async () => {
    const app = await getApp();
    const res = await request(app.server)
      .get("/api/v1/teams/directory")
      .set(cookieHeader(outsider));
    expect(res.status).toBe(200);
    const names = res.body.teams.map((t: { name: string }) => t.name);
    expect(names).toContain("Open Road Runners");
    expect(names).not.toContain("Hidden Harriers");
    expect(res.body.total).toBe(1);
  });

  it("directory supports name + city search and pagination", async () => {
    const app = await getApp();
    const byName = await request(app.server)
      .get("/api/v1/teams/directory?q=road")
      .set(cookieHeader(outsider));
    expect(byName.body.total).toBe(1);

    const byCity = await request(app.server)
      .get("/api/v1/teams/directory?city=lex")
      .set(cookieHeader(outsider));
    expect(byCity.body.total).toBe(1);

    const noMatch = await request(app.server)
      .get("/api/v1/teams/directory?city=nowhere")
      .set(cookieHeader(outsider));
    expect(noMatch.body.total).toBe(0);

    const paged = await request(app.server)
      .get("/api/v1/teams/directory?page=2&pageSize=1")
      .set(cookieHeader(outsider));
    expect(paged.body.teams).toHaveLength(0);
    expect(paged.body.page).toBe(2);
  });

  it("directory entries expose only safe fields", async () => {
    const app = await getApp();
    const res = await request(app.server)
      .get("/api/v1/teams/directory")
      .set(cookieHeader(outsider));
    const team = res.body.teams[0];
    expect(Object.keys(team).sort()).toEqual(
      ["city", "description", "hasLogo", "id", "name", "slug", "state", "visibility"].sort(),
    );
    expect(team.memberCount).toBeUndefined();
    expect(team.city).toBe("Lexington");
  });

  it("public team preview is safe; private team preview 404s", async () => {
    const app = await getApp();
    const pub = await request(app.server)
      .get(`/api/v1/teams/${publicTeamId}/public`)
      .set(cookieHeader(outsider));
    expect(pub.status).toBe(200);
    expect(pub.body.team.memberCount).toBeUndefined();
    expect(Object.keys(pub.body.team).sort()).toEqual(
      ["city", "description", "hasLogo", "id", "name", "slug", "state", "visibility"].sort(),
    );

    const priv = await request(app.server)
      .get(`/api/v1/teams/${privateTeamId}/public`)
      .set(cookieHeader(outsider));
    expect(priv.status).toBe(404);
  });

  it("non-member cannot use the member team endpoint", async () => {
    const app = await getApp();
    const res = await request(app.server)
      .get(`/api/v1/teams/${publicTeamId}`)
      .set(cookieHeader(outsider));
    expect(res.status).toBe(404);
  });

  it("coach can change visibility; runner cannot", async () => {
    const app = await getApp();
    const ok = await request(app.server)
      .patch(`/api/v1/teams/${privateTeamId}`)
      .set(cookieHeader(coach))
      .send({ visibility: "PUBLIC", city: "Winchester", state: "KY" });
    expect(ok.status).toBe(200);
    expect(ok.body.team.visibility).toBe("PUBLIC");
    expect(ok.body.team.city).toBe("Winchester");

    const denied = await request(app.server)
      .patch(`/api/v1/teams/${privateTeamId}`)
      .set(cookieHeader(runner))
      .send({ visibility: "PRIVATE" });
    expect(denied.status).toBe(403);
  });

  it("public -> private hides the team immediately; pending requests survive", async () => {
    const app = await getApp();
    // outsider requests to join the public team
    const req = await request(app.server)
      .post(`/api/v1/teams/${publicTeamId}/join-requests`)
      .set(cookieHeader(outsider));
    expect(req.status).toBe(201);

    // coach flips to private
    await request(app.server)
      .patch(`/api/v1/teams/${publicTeamId}`)
      .set(cookieHeader(coach))
      .send({ visibility: "PRIVATE" });

    const dir = await request(app.server)
      .get("/api/v1/teams/directory")
      .set(cookieHeader(outsider));
    expect(dir.body.total).toBe(0);

    const preview = await request(app.server)
      .get(`/api/v1/teams/${publicTeamId}/public`)
      .set(cookieHeader(outsider));
    expect(preview.status).toBe(404);

    // pending request still visible to the coach
    const pending = await request(app.server)
      .get(`/api/v1/teams/${publicTeamId}/join-requests`)
      .set(cookieHeader(coach));
    expect(pending.status).toBe(200);
    expect(
      pending.body.requests.filter((r: { status: string }) => r.status === "PENDING"),
    ).toHaveLength(1);
  });

  it("join-request flow works on public teams (coach approval required)", async () => {
    const app = await getApp();
    const req = await request(app.server)
      .post(`/api/v1/teams/${publicTeamId}/join-requests`)
      .set(cookieHeader(outsider));
    expect(req.status).toBe(201);

    // still a non-member: no internals
    const detail = await request(app.server)
      .get(`/api/v1/teams/${publicTeamId}`)
      .set(cookieHeader(outsider));
    expect(detail.status).toBe(404);

    // coach approves
    const pending = await request(app.server)
      .get(`/api/v1/teams/${publicTeamId}/join-requests`)
      .set(cookieHeader(coach));
    const requestId = pending.body.requests[0].id as string;
    const approve = await request(app.server)
      .post(`/api/v1/teams/${publicTeamId}/join-requests/${requestId}/approve`)
      .set(cookieHeader(coach))
      .send({ role: "RUNNER" });
    expect(approve.status).toBe(200);

    const now = await request(app.server)
      .get(`/api/v1/teams/${publicTeamId}`)
      .set(cookieHeader(outsider));
    expect(now.status).toBe(200);
    expect(now.body.team.myRole).toBe("RUNNER");
  });

  it("similar-teams nudge surfaces public AND private teams (name+description only)", async () => {
    const app = await getApp();
    const res = await request(app.server)
      .get("/api/v1/teams/similar?name=Harriers")
      .set(cookieHeader(outsider));
    expect(res.status).toBe(200);
    const names = res.body.teams.map((t: { name: string }) => t.name);
    expect(names).toContain("Hidden Harriers");
    // ...but still only safe fields, never roster/internals
    expect(Object.keys(res.body.teams[0]).sort()).toEqual(
      ["description", "id", "name"].sort(),
    );
  });

  it("visibility change is audit-logged", async () => {
    const { db } = await import("../src/db.js");
    const app = await getApp();
    await request(app.server)
      .patch(`/api/v1/teams/${privateTeamId}`)
      .set(cookieHeader(coach))
      .send({ visibility: "PUBLIC" });
    const entry = await db.auditLog.findFirst({
      where: {
        entityType: "Team",
        entityId: privateTeamId,
        action: "TEAM_VISIBILITY_CHANGED",
      },
    });
    expect(entry).not.toBeNull();
    expect((entry!.metadata as { visibility: string }).visibility).toBe("PUBLIC");
  });
});
