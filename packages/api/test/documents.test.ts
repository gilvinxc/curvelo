import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  addRunnerToTeam,
  cookieHeader,
  createTeamAs,
  getApp,
  registerUser,
  truncate,
} from "./helpers.js";

async function setup() {
  const app = await getApp();
  const coach = await registerUser("COACH", "doccoach");
  const runner = await registerUser("RUNNER", "docrunner");
  const teamId = await createTeamAs(coach, "Doc Team");
  await addRunnerToTeam(coach, teamId, runner);
  return { app, coach, runner, teamId };
}

const pdf = Buffer.from("%PDF-1.4 fake physical");

function uploadDoc(
  app: Awaited<ReturnType<typeof getApp>>,
  user: { cookies: string[] },
  fields: Record<string, string>,
) {
  let req = request(app.server).post("/api/v1/documents/upload");
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req.set(cookieHeader(user as never)).attach("file", pdf, "physical.pdf");
}

describe("documents", () => {
  beforeEach(truncate);

  it("coach sets checklist; runner uploads physical; status board shows cleared", async () => {
    const { app, coach, runner, teamId } = await setup();

    const req = await request(app.server)
      .post(`/api/v1/teams/${teamId}/document-requirements`)
      .set(cookieHeader(coach))
      .send({ kind: "PHYSICAL", label: "Annual physical", validDays: 365 });
    expect(req.status).toBe(201);

    // Runner cannot set requirements.
    const denied = await request(app.server)
      .post(`/api/v1/teams/${teamId}/document-requirements`)
      .set(cookieHeader(runner))
      .send({ kind: "WAIVER", label: "Waiver" });
    expect(denied.status).toBe(403);

    const up = await uploadDoc(app, runner, {
      teamId,
      kind: "PHYSICAL",
      label: "Annual physical",
      requirementId: req.body.requirement.id,
      issuedAt: new Date().toISOString(),
    });
    expect(up.status).toBe(201);
    expect(up.body.document.kind).toBe("PHYSICAL");
    expect(up.body.document.expiresAt).toBeTruthy();

    const status = await request(app.server)
      .get(`/api/v1/teams/${teamId}/document-status`)
      .set(cookieHeader(coach));
    expect(status.status).toBe(200);
    const row = status.body.athletes.find(
      (a: { userId: string }) => a.userId === runner.id,
    );
    expect(row.requirements[0].status).toBe("current");
    expect(row.cleared).toBe(true);

    // Runner cannot see the coach status board.
    const noBoard = await request(app.server)
      .get(`/api/v1/teams/${teamId}/document-status`)
      .set(cookieHeader(runner));
    expect(noBoard.status).toBe(403);
  });

  it("birth certificate upload + coach verification; access matrix holds", async () => {
    const { app, coach, runner, teamId } = await setup();
    const other = await registerUser("RUNNER", "docother");
    await addRunnerToTeam(coach, teamId, other);

    const up = await uploadDoc(app, runner, {
      teamId,
      kind: "BIRTH_CERTIFICATE",
      label: "Birth certificate",
    });
    expect(up.status).toBe(201);
    const docId = up.body.document.id as string;

    // Teammate cannot view another athlete's birth certificate.
    const snoop = await request(app.server)
      .get(`/api/v1/documents/${docId}`)
      .set(cookieHeader(other));
    expect(snoop.status).toBe(403);

    // Coach verifies it.
    const verified = await request(app.server)
      .post(`/api/v1/documents/${docId}/verify`)
      .set(cookieHeader(coach));
    expect(verified.status).toBe(200);
    expect(verified.body.document.verifiedAt).toBeTruthy();

    // Coach can download; teammate cannot.
    const dl = await request(app.server)
      .get(`/api/v1/documents/${docId}/file`)
      .set(cookieHeader(coach));
    expect(dl.status).toBe(200);
    const noDl = await request(app.server)
      .get(`/api/v1/documents/${docId}/file`)
      .set(cookieHeader(other));
    expect(noDl.status).toBe(403);
  });

  it("waiver signing records explicit intent; background check stores pass/fail only", async () => {
    const { app, coach, runner, teamId } = await setup();

    const up = await uploadDoc(app, runner, {
      teamId,
      kind: "WAIVER",
      label: "Season waiver",
    });
    expect(up.status).toBe(201);
    const docId = up.body.document.id as string;

    const signed = await request(app.server)
      .post(`/api/v1/documents/${docId}/sign`)
      .set(cookieHeader(runner))
      .send({ signedByName: "Runner Doc", intentConfirmed: true });
    expect(signed.status).toBe(200);
    expect(signed.body.document.signedByName).toBe("Runner Doc");

    // Missing intent checkbox is rejected.
    const noIntent = await request(app.server)
      .post(`/api/v1/documents/${docId}/sign`)
      .set(cookieHeader(runner))
      .send({ signedByName: "Runner Doc", intentConfirmed: false });
    expect(noIntent.status).toBe(400);

    // Background check: pass/fail only, no file bytes of a report.
    const bg = await request(app.server)
      .post("/api/v1/documents/background-check")
      .set(cookieHeader(coach))
      .send({ checkResult: "PASS", checkProvider: "Checkr" });
    expect(bg.status).toBe(201);
    expect(bg.body.document.checkResult).toBe("PASS");
    expect(bg.body.document.kind).toBe("BACKGROUND_CHECK");
  });

  it("team docs: coach uploads, members read team-visible, coach-only hidden", async () => {
    const { app, coach, runner, teamId } = await setup();

    const pub = await uploadDoc(app, coach, {
      teamId,
      kind: "TEAM_DOC",
      label: "Team handbook",
      visibility: "TEAM",
    });
    expect(pub.status).toBe(201);

    const priv = await uploadDoc(app, coach, {
      teamId,
      kind: "TEAM_DOC",
      label: "Incident notes",
      visibility: "COACH_ONLY",
    });
    expect(priv.status).toBe(201);

    const list = await request(app.server)
      .get(`/api/v1/teams/${teamId}/documents/team`)
      .set(cookieHeader(runner));
    expect(list.status).toBe(200);
    expect(list.body.documents).toHaveLength(1);
    expect(list.body.documents[0].label).toBe("Team handbook");

    const coachList = await request(app.server)
      .get(`/api/v1/teams/${teamId}/documents/team`)
      .set(cookieHeader(coach));
    expect(coachList.body.documents).toHaveLength(2);

    // Runner cannot upload team docs.
    const denied = await uploadDoc(app, runner, {
      teamId,
      kind: "TEAM_DOC",
      label: "Sneaky",
    });
    expect(denied.status).toBe(403);
  });

  it("coach cert upload + delete requires a reason for others' docs", async () => {
    const { app, coach, runner, teamId } = await setup();

    const cert = await uploadDoc(app, coach, {
      teamId,
      kind: "CERTIFICATION",
      label: "CPR/AED",
      expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    });
    expect(cert.status).toBe(201);

    const mine = await request(app.server)
      .get("/api/v1/users/me/certifications")
      .set(cookieHeader(coach));
    expect(mine.body.documents).toHaveLength(1);

    // Runner uploads a physical; coach deletes it with a reason.
    const phys = await uploadDoc(app, runner, {
      teamId,
      kind: "PHYSICAL",
      label: "Annual physical",
    });
    const del = await request(app.server)
      .delete(`/api/v1/documents/${phys.body.document.id}`)
      .set(cookieHeader(coach))
      .send({ reason: "Duplicate upload" });
    expect(del.status).toBe(200);

    // Runner cannot delete the coach's cert.
    const noDel = await request(app.server)
      .delete(`/api/v1/documents/${cert.body.document.id}`)
      .set(cookieHeader(runner))
      .send({ reason: "x" });
    expect(noDel.status).toBe(403);
  });
});
