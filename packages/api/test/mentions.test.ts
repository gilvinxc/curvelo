import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  addRunnerToTeam,
  createTeamAs,
  getApp,
  registerUser,
  truncate,
  cookieHeader,
} from "./helpers.js";

async function setName(user: { cookies: string[] }, name: string) {
  const app = await getApp();
  await request(app.server)
    .patch("/api/v1/users/me")
    .set(cookieHeader(user as never))
    .send({ displayName: name });
}

async function setup() {
  const app = await getApp();
  const coach = await registerUser("COACH", "menCoach");
  const runnerA = await registerUser("RUNNER", "menA");
  const runnerB = await registerUser("RUNNER", "menB");
  await setName(runnerA, "Alex Rivera");
  await setName(runnerB, "Sam Rivera");
  const teamId = await createTeamAs(coach, "Mention Team");
  await addRunnerToTeam(coach, teamId, runnerA);
  await addRunnerToTeam(coach, teamId, runnerB);
  return { app, coach, runnerA, runnerB, teamId };
}

describe("mentions and notifications", () => {
  beforeEach(truncate);

  it("tags a teammate in a post, creates a notification, and returns mention refs", async () => {
    const { app, runnerA, runnerB, teamId } = await setup();

    const post = await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(runnerA))
      .send({ body: "Great run today @Sam Rivera!" });
    expect(post.status).toBe(201);
    expect(post.body.post.mentions).toEqual([
      { userId: runnerB.id, displayName: "Sam Rivera" },
    ]);

    // Notification for the tagged teammate.
    const unread = await request(app.server)
      .get("/api/v1/notifications/unread-count")
      .set(cookieHeader(runnerB));
    expect(unread.body.unread).toBe(1);

    const list = await request(app.server)
      .get("/api/v1/notifications")
      .set(cookieHeader(runnerB));
    expect(list.body.notifications).toHaveLength(1);
    expect(list.body.notifications[0].title).toContain("mentioned you");
    expect(list.body.notifications[0].link).toContain(`/teams/${teamId}/feed`);

    // Tagger gets nothing.
    const taggerUnread = await request(app.server)
      .get("/api/v1/notifications/unread-count")
      .set(cookieHeader(runnerA));
    expect(taggerUnread.body.unread).toBe(0);
  });

  it("ignores self-mentions and unknown names", async () => {
    const { app, runnerA, teamId } = await setup();

    const post = await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(runnerA))
      .send({ body: "Hello @Alex Rivera and @Nobody Here" });
    expect(post.status).toBe(201);
    expect(post.body.post.mentions).toEqual([]);

    const unread = await request(app.server)
      .get("/api/v1/notifications/unread-count")
      .set(cookieHeader(runnerA));
    expect(unread.body.unread).toBe(0);
  });

  it("tags in comments, messages, and activity notes", async () => {
    const { app, coach, runnerA, runnerB, teamId } = await setup();

    // Comment.
    const post = await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(runnerA))
      .send({ body: "Morning run" });
    const comment = await request(app.server)
      .post(`/api/v1/posts/${post.body.post.id}/comments`)
      .set(cookieHeader(runnerB))
      .send({ body: "Nice @Alex Rivera!" });
    expect(comment.status).toBe(201);
    expect(comment.body.comment.mentions).toEqual([
      { userId: runnerA.id, displayName: "Alex Rivera" },
    ]);

    // Announcement message (coach posts).
    const convs = await request(app.server)
      .get(`/api/v1/teams/${teamId}/conversations`)
      .set(cookieHeader(coach));
    const ann = convs.body.conversations.find(
      (c: { kind: string }) => c.kind === "ANNOUNCEMENT",
    );
    const msg = await request(app.server)
      .post(`/api/v1/teams/${teamId}/conversations/${ann.id}/messages`)
      .set(cookieHeader(coach))
      .send({ body: "Practice moved — @Sam Rivera bring the cones" });
    expect(msg.status).toBe(201);
    expect(msg.body.message.mentions).toEqual([
      { userId: runnerB.id, displayName: "Sam Rivera" },
    ]);

    // Activity notes (team activity).
    const act = await request(app.server)
      .post("/api/v1/activities")
      .set(cookieHeader(runnerA))
      .send({
        kind: "RUN",
        startedAt: new Date(Date.now() - 3600000).toISOString(),
        distanceM: 5000,
        durationS: 1500,
        teamId,
        notes: "Easy miles with @Sam Rivera",
      });
    expect(act.status).toBe(201);
    expect(act.body.activity.mentions).toEqual([
      { userId: runnerB.id, displayName: "Sam Rivera" },
    ]);
  });

  it("mark read clears the unread count", async () => {
    const { app, runnerA, runnerB, teamId } = await setup();

    await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(runnerA))
      .send({ body: "Hey @Sam Rivera" });

    const list = await request(app.server)
      .get("/api/v1/notifications")
      .set(cookieHeader(runnerB));
    const id = list.body.notifications[0].id;

    await request(app.server)
      .post(`/api/v1/notifications/${id}/read`)
      .set(cookieHeader(runnerB))
      .expect(200);

    const unread = await request(app.server)
      .get("/api/v1/notifications/unread-count")
      .set(cookieHeader(runnerB));
    expect(unread.body.unread).toBe(0);
  });
});
