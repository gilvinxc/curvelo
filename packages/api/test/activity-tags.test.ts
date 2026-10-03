import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { getApp, registerUser, truncate, cookieHeader, createTeamAs, addRunnerToTeam } from "./helpers.js";

const RUN_BODY = {
  kind: "RUN",
  title: "Group long run",
  startedAt: "2026-09-18T13:00:00Z",
  distanceM: 12000,
  durationS: 3600,
};

async function setup() {
  const app = await getApp();
  const coach = await registerUser("COACH", "tagcoach");
  const teamId = await createTeamAs(coach, "Tag Team");
  const r1 = await registerUser("RUNNER", "tagr1");
  const r2 = await registerUser("RUNNER", "tagr2");
  const outsider = await registerUser("RUNNER", "tagout");
  await addRunnerToTeam(coach, teamId, r1);
  await addRunnerToTeam(coach, teamId, r2);
  return { app, coach, teamId, r1, r2, outsider };
}

async function tagRun(app: any, tagger: any, teamId: string, taggedUserIds: string[], extra = {}) {
  return request(app.server)
    .post("/api/v1/activities")
    .set(cookieHeader(tagger))
    .send({ ...RUN_BODY, teamId, visibility: "TEAM", taggedUserIds, ...extra });
}

describe("activity tags", () => {
  beforeEach(truncate);

  it("tagging teammates creates PENDING tags + RUN_TAGGED notifications", async () => {
    const { app, teamId, r1, r2 } = await setup();
    const res = await tagRun(app, r1, teamId, [r2.id]);
    expect(res.status).toBe(201);

    const tagRes = await request(app.server)
      .get(`/api/v1/notifications`)
      .set(cookieHeader(r2));
    const tagged = tagRes.body.notifications.filter((n: any) => n.type === "RUN_TAGGED");
    expect(tagged).toHaveLength(1);
    expect(tagged[0].title).toContain("tagged you in their run");
    expect(tagged[0].link).toMatch(/^\/activities\/new\?fromTag=/);
  });

  it("tagged user reads prefill; accepts with edited values creating their own activity", async () => {
    const { app, teamId, r1, r2 } = await setup();
    await tagRun(app, r1, teamId, [r2.id]);

    const tagId = (
      await request(app.server).get("/api/v1/notifications").set(cookieHeader(r2))
    ).body.notifications.find((n: any) => n.type === "RUN_TAGGED").link.split("fromTag=")[1];

    const prefill = await request(app.server)
      .get(`/api/v1/activity-tags/${tagId}`)
      .set(cookieHeader(r2));
    expect(prefill.status).toBe(200);
    expect(prefill.body.tag.status).toBe("PENDING");
    expect(prefill.body.tag.prefill.distanceM).toBe(12000);

    // Accept with edited values (slower pace, own notes).
    const save = await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(r2))
      .send({ ...RUN_BODY, distanceM: 12000, durationS: 3900, notes: "My effort", fromTagId: tagId });
    expect(save.status).toBe(201);
    expect(save.body.activity.userId).toBe(r2.id);
    expect(save.body.activity.durationS).toBe(3900);

    const after = await request(app.server)
      .get(`/api/v1/activity-tags/${tagId}`)
      .set(cookieHeader(r2));
    expect(after.body.tag.status).toBe("ACCEPTED");
  });

  it("decline creates nothing and marks DECLINED", async () => {
    const { app, teamId, r1, r2 } = await setup();
    await tagRun(app, r1, teamId, [r2.id]);
    const tagId = (
      await request(app.server).get("/api/v1/notifications").set(cookieHeader(r2))
    ).body.notifications.find((n: any) => n.type === "RUN_TAGGED").link.split("fromTag=")[1];

    const decline = await request(app.server)
      .post(`/api/v1/activity-tags/${tagId}/decline`)
      .set(cookieHeader(r2))
      .send({});
    expect(decline.status).toBe(200);

    const after = await request(app.server)
      .get(`/api/v1/activity-tags/${tagId}`)
      .set(cookieHeader(r2));
    expect(after.body.tag.status).toBe("DECLINED");

    const mine = await request(app.server)
      .get("/api/v1/activities?from=2026-09-01&to=2026-09-30")
      .set(cookieHeader(r2));
    expect(mine.body.activities).toHaveLength(0);
  });

  it("only the tagged user can read/decline/accept (others get 404)", async () => {
    const { app, teamId, r1, r2, outsider } = await setup();
    await tagRun(app, r1, teamId, [r2.id]);
    const tagId = (
      await request(app.server).get("/api/v1/notifications").set(cookieHeader(r2))
    ).body.notifications.find((n: any) => n.type === "RUN_TAGGED").link.split("fromTag=")[1];

    // The tagger themselves cannot accept via fromTagId.
    const stolen = await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(r1))
      .send({ ...RUN_BODY, fromTagId: tagId });
    expect(stolen.status).toBe(404);

    const readOther = await request(app.server)
      .get(`/api/v1/activity-tags/${tagId}`)
      .set(cookieHeader(outsider));
    expect(readOther.status).toBe(404);

    const declineOther = await request(app.server)
      .post(`/api/v1/activity-tags/${tagId}/decline`)
      .set(cookieHeader(r1))
      .send({});
    expect(declineOther.status).toBe(404);
  });

  it("rejects self-tags", async () => {
    const { app, teamId, r1 } = await setup();
    const res = await tagRun(app, r1, teamId, [r1.id]);
    expect(res.status).toBe(400);
  });

  it("blocks tagging on private runs", async () => {
    const { app, teamId, r1, r2 } = await setup();
    const res = await tagRun(app, r1, teamId, [r2.id], { visibility: "PRIVATE" });
    expect(res.status).toBe(400);
  });

  it("rejects tagging non-members", async () => {
    const { app, teamId, r1, outsider } = await setup();
    const res = await tagRun(app, r1, teamId, [outsider.id]);
    expect(res.status).toBe(403);
  });

  it("deleting the activity cascades the tags", async () => {
    const { app, teamId, r1, r2 } = await setup();
    const created = await tagRun(app, r1, teamId, [r2.id]);
    const activityId = created.body.activity.id;
    const tagId = (
      await request(app.server).get("/api/v1/notifications").set(cookieHeader(r2))
    ).body.notifications.find((n: any) => n.type === "RUN_TAGGED").link.split("fromTag=")[1];

    await request(app.server)
      .delete(`/api/v1/activities/${activityId}`)
      .set(cookieHeader(r1));

    const read = await request(app.server)
      .get(`/api/v1/activity-tags/${tagId}`)
      .set(cookieHeader(r2));
    expect(read.status).toBe(404);
  });

  it("making the run private invalidates pending tags (410 on read)", async () => {
    const { app, teamId, r1, r2 } = await setup();
    const created = await tagRun(app, r1, teamId, [r2.id]);
    const activityId = created.body.activity.id;
    const tagId = (
      await request(app.server).get("/api/v1/notifications").set(cookieHeader(r2))
    ).body.notifications.find((n: any) => n.type === "RUN_TAGGED").link.split("fromTag=")[1];

    await request(app.server)
      .patch(`/api/v1/activities/${activityId}`)
      .set(cookieHeader(r1))
      .send({ visibility: "PRIVATE" });

    const read = await request(app.server)
      .get(`/api/v1/activity-tags/${tagId}`)
      .set(cookieHeader(r2));
    expect(read.status).toBe(410);
  });
});
