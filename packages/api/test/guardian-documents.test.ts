import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  getApp,
  registerUser,
  truncate,
  cookieHeader,
  TestUser,
  createTeamAs,
  addRunnerToTeam,
} from "./helpers.js";

const pdf = Buffer.from("%PDF-1.4 fake physical");

async function setup() {
  const app = await getApp();
  const coach = await registerUser("COACH", "gdcoach");
  const teamId = await createTeamAs(coach, "Guardian Doc Team");
  const athlete = await registerUser("RUNNER", "gdathlete");
  const other = await registerUser("RUNNER", "gdother");
  const parent = await registerUser("PARENT", "gdparent");
  await addRunnerToTeam(coach, teamId, athlete);
  await addRunnerToTeam(coach, teamId, other);

  // Coach invites the parent for the athlete; parent accepts.
  const inviteRes = await request(app.server)
    .post(`/api/v1/teams/${teamId}/athletes/${athlete.id}/guardians/invite`)
    .set(cookieHeader(coach))
    .send({ email: parent.email, relationship: "parent" });
  expect(inviteRes.status).toBe(201);
  const accept = await request(app.server)
    .post(`/api/v1/guardian-invites/${inviteRes.body.invite.token}/accept`)
    .set(cookieHeader(parent))
    .send({ consents: ["PARTICIPATION", "DATA_SHARING"] });
  expect(accept.status).toBe(200);

  return { app, coach, teamId, athlete, other, parent };
}

function uploadDoc(
  app: Awaited<ReturnType<typeof getApp>>,
  user: { cookies: string[] },
  fields: Record<string, string>,
) {
  let req = request(app.server).post("/api/v1/documents/upload");
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req.set(cookieHeader(user as never)).attach("file", pdf, "physical.pdf");
}

describe("guardian documents", () => {
  beforeEach(truncate);

  it("parent uploads for linked child, lists child's docs, cannot see others", async () => {
    const { app, teamId, athlete, other, parent } = await setup();

    // Parent (not a team member) uploads for their linked child.
    const up = await uploadDoc(app, parent, {
      teamId,
      ownerId: athlete.id,
      kind: "PHYSICAL",
      label: "Annual physical",
    });
    expect(up.status).toBe(201);
    expect(up.body.document.ownerId).toBe(athlete.id);

    // Parent sees the child's documents.
    const list = await request(app.server)
      .get(`/api/v1/teams/${teamId}/documents/athlete/${athlete.id}`)
      .set(cookieHeader(parent));
    expect(list.status).toBe(200);
    expect(list.body.documents).toHaveLength(1);

    // Parent cannot see another athlete's documents.
    const otherList = await request(app.server)
      .get(`/api/v1/teams/${teamId}/documents/athlete/${other.id}`)
      .set(cookieHeader(parent));
    expect(otherList.status).toBe(404);

    // Parent cannot upload for an athlete they are not linked to.
    const bad = await uploadDoc(app, parent, {
      teamId,
      ownerId: other.id,
      kind: "PHYSICAL",
      label: "Not my kid",
    });
    expect(bad.status).toBe(403);
  });

  it("unrelated parent is rejected", async () => {
    const { app, teamId, athlete } = await setup();
    const stranger = await registerUser("PARENT", "gdstranger");

    const list = await request(app.server)
      .get(`/api/v1/teams/${teamId}/documents/athlete/${athlete.id}`)
      .set(cookieHeader(stranger));
    expect(list.status).toBe(404);

    const up = await uploadDoc(app, stranger, {
      teamId,
      ownerId: athlete.id,
      kind: "PHYSICAL",
      label: "Nope",
    });
    expect(up.status).toBe(404);
  });

  it("parent can read the team requirement checklist", async () => {
    const { app, coach, teamId, parent } = await setup();
    const req = await request(app.server)
      .post(`/api/v1/teams/${teamId}/document-requirements`)
      .set(cookieHeader(coach))
      .send({ kind: "PHYSICAL", label: "Annual physical", validDays: 365 });
    expect(req.status).toBe(201);

    const list = await request(app.server)
      .get(`/api/v1/teams/${teamId}/document-requirements`)
      .set(cookieHeader(parent));
    expect(list.status).toBe(200);
    expect(list.body.requirements).toHaveLength(1);
  });

  it("removing an athlete from the team keeps the parent/child association", async () => {
    const { app, coach, teamId, athlete, parent } = await setup();

    // Parent sees the child while on the team.
    const before = await request(app.server)
      .get("/api/v1/users/me/children")
      .set(cookieHeader(parent));
    expect(before.status).toBe(200);
    expect(before.body.children).toHaveLength(1);
    expect(before.body.children[0].teamActive).toBe(true);

    // Coach removes the athlete from the team.
    const removed = await request(app.server)
      .delete(`/api/v1/teams/${teamId}/members/${athlete.id}`)
      .set(cookieHeader(coach));
    expect(removed.status).toBe(200);

    // The guardian link survives and the child is still listed, inactive.
    const after = await request(app.server)
      .get("/api/v1/users/me/children")
      .set(cookieHeader(parent));
    expect(after.status).toBe(200);
    expect(after.body.children).toHaveLength(1);
    expect(after.body.children[0].athleteId).toBe(athlete.id);
    expect(after.body.children[0].teamActive).toBe(false);

    // Parent can still view the child's documents via the link.
    const docs = await request(app.server)
      .get(`/api/v1/teams/${teamId}/documents/athlete/${athlete.id}`)
      .set(cookieHeader(parent));
    expect(docs.status).toBe(200);
  });
});
