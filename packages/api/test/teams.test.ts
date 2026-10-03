import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { getApp, registerUser, truncate, cookieHeader } from "./helpers.js";

async function createTeam(user: { cookies: string[] }, body: object) {
  const app = await getApp();
  return request(app.server)
    .post("/api/v1/teams")
    .set(cookieHeader(user))
    .send(body);
}

describe("teams", () => {
  beforeEach(truncate);

  it("coach creates a team and becomes its coach", async () => {
    const coach = await registerUser("COACH", "tcoach");
    const res = await createTeam(coach, { name: "Springfield Harriers" });
    expect(res.status).toBe(201);
    expect(res.body.team.slug).toMatch(/^springfield-harriers/);
    expect(res.body.team.myRole).toBe("COACH");
    expect(res.body.team.memberCount).toBe(1);
  });

  it("similar-teams lookup returns name and description only", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "simcoach");
    const runner = await registerUser("RUNNER", "simrunner");
    const created = await createTeam(coach, {
      name: "Winchester Track Club",
      description: "Fall XC squad",
    });
    const teamId = created.body.team.id;

    const res = await request(app.server)
      .get("/api/v1/teams/similar?name=winchester")
      .set(cookieHeader(runner));
    expect(res.status).toBe(200);
    expect(res.body.teams).toHaveLength(1);
    // Access stays limited: only name + description, no roster/members.
    expect(Object.keys(res.body.teams[0]).sort()).toEqual([
      "description",
      "id",
      "name",
    ]);
    expect(res.body.teams[0].description).toBe("Fall XC squad");

    // Teams the caller is already on are excluded.
    const own = await request(app.server)
      .get("/api/v1/teams/similar?name=winchester")
      .set(cookieHeader(coach));
    expect(own.body.teams).toHaveLength(0);

    // Direct join request needs coach approval — not auto-join.
    const jr = await request(app.server)
      .post(`/api/v1/teams/${teamId}/join-requests`)
      .set(cookieHeader(runner));
    expect(jr.status).toBe(201);
    expect(jr.body.teamName).toBe("Winchester Track Club");

    // Duplicate request rejected.
    const dup = await request(app.server)
      .post(`/api/v1/teams/${teamId}/join-requests`)
      .set(cookieHeader(runner));
    expect(dup.status).toBe(409);

    // Runner is still not a member until a coach approves.
    const page = await request(app.server)
      .get(`/api/v1/teams/${teamId}`)
      .set(cookieHeader(runner));
    expect([403, 404]).toContain(page.status);
  });

  it("discover shows public teams (name and description only), hides private ones", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "disccoaach");
    const runner = await registerUser("RUNNER", "discrunner");
    await createTeam(coach, { name: "Springfield Public XC", visibility: "PUBLIC", description: "Open squad" });
    await createTeam(coach, { name: "Springfield Private XC", visibility: "PRIVATE" });

    const res = await request(app.server)
      .get("/api/v1/teams/discover?q=springfield")
      .set(cookieHeader(runner));
    expect(res.status).toBe(200);
    expect(res.body.teams).toHaveLength(1);
    expect(res.body.teams[0].name).toBe("Springfield Public XC");
    expect(Object.keys(res.body.teams[0]).sort()).toEqual([
      "description",
      "id",
      "name",
    ]);
  });

  it("rejects duplicate slugs", async () => {
    const coach = await registerUser("COACH", "slugcoach");
    const first = await createTeam(coach, { name: "Riverside RC", slug: "riverside-rc" });
    expect(first.status).toBe(201);
    const second = await createTeam(coach, { name: "Riverside RC 2", slug: "riverside-rc" });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("SLUG_TAKEN");
  });

  it("lists only the caller's teams", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "listcoach");
    const other = await registerUser("COACH", "othercoach");
    await createTeam(coach, { name: "Team Alpha" });

    const mine = await request(app.server).get("/api/v1/teams").set(cookieHeader(coach));
    expect(mine.body.teams).toHaveLength(1);

    const theirs = await request(app.server).get("/api/v1/teams").set(cookieHeader(other));
    expect(theirs.body.teams).toHaveLength(0);
  });

  it("hides team existence from non-members", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "hidecoach");
    const stranger = await registerUser("RUNNER", "stranger");
    const created = await createTeam(coach, { name: "Secret Squad" });
    const teamId = created.body.team.id;

    for (const path of [`/api/v1/teams/${teamId}`, `/api/v1/teams/${teamId}/roster`]) {
      const res = await request(app.server).get(path).set(cookieHeader(stranger));
      expect(res.status).toBe(404);
    }
  });

  it("runner cannot update the team; coach can", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "updcoach");
    const created = await createTeam(coach, { name: "Update Me" });
    const teamId = created.body.team.id;

    const stranger = await registerUser("RUNNER", "updstranger");
    const forbidden = await request(app.server)
      .patch(`/api/v1/teams/${teamId}`)
      .set(cookieHeader(stranger))
      .send({ description: "hacked" });
    expect(forbidden.status).toBe(404); // not a member → 404, not 403

    const ok = await request(app.server)
      .patch(`/api/v1/teams/${teamId}`)
      .set(cookieHeader(coach))
      .send({ description: "Official team" });
    expect(ok.status).toBe(200);
    expect(ok.body.team.description).toBe("Official team");
  });

  it("roster shows emails to coaches but not to runners", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "roscoach");
    const runner = await registerUser("RUNNER", "rosrunner");
    const created = await createTeam(coach, { name: "Roster Team" });
    const teamId = created.body.team.id;

    // Invite + accept to get the runner on the roster.
    const invite = await request(app.server)
      .post(`/api/v1/teams/${teamId}/invitations`)
      .set(cookieHeader(coach))
      .send({ email: runner.email, role: "RUNNER" });
    expect(invite.status).toBe(201);
    const accept = await request(app.server)
      .post(`/api/v1/invitations/${invite.body.invitation.token}/accept`)
      .set(cookieHeader(runner));
    expect(accept.status).toBe(200);

    const coachView = await request(app.server)
      .get(`/api/v1/teams/${teamId}/roster`)
      .set(cookieHeader(coach));
    expect(coachView.status).toBe(200);
    expect(coachView.body.roster).toHaveLength(2);
    expect(coachView.body.roster[1]).toHaveProperty("email", runner.email);

    const runnerView = await request(app.server)
      .get(`/api/v1/teams/${teamId}/roster`)
      .set(cookieHeader(runner));
    expect(runnerView.status).toBe(200);
    expect(runnerView.body.roster[1]).not.toHaveProperty("email");
    expect(runnerView.body.roster[1].displayName).toBeDefined();
  });
});
