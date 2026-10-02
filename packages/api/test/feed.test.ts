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

const RUN_BODY = {
  kind: "RUN",
  startedAt: "2026-09-18T13:00:00Z",
  distanceM: 8000,
  durationS: 2400,
};

async function setup() {
  const app = await getApp();
  const coach = await registerUser("COACH", "fcoach");
  const teamId = await createTeamAs(coach, "Feed Team");
  const r1 = await registerUser("RUNNER", "fr1");
  const r2 = await registerUser("RUNNER", "fr2");
  await addRunnerToTeam(coach, teamId, r1);
  await addRunnerToTeam(coach, teamId, r2);
  return { app, coach, teamId, r1, r2 };
}

async function logActivity(user: TestUser, teamId: string, visibility = "TEAM") {
  const app = await getApp();
  const res = await request(app.server)
    .post("/api/v1/activities")
    .set(cookieHeader(user))
    .send({ ...RUN_BODY, teamId, visibility });
  if (res.status !== 201) throw new Error("logActivity failed");
  return res.body.activity;
}

describe("team feed", () => {
  beforeEach(truncate);

  it("members post text and share TEAM-visible activities", async () => {
    const { app, teamId, r1 } = await setup();
    const auth = cookieHeader(r1);

    const text = await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set(auth)
      .send({ body: "Great practice today!" });
    expect(text.status).toBe(201);
    expect(text.body.post.kind).toBe("TEXT");

    const activity = await logActivity(r1, teamId);
    const shared = await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set(auth)
      .send({ body: "Proud of this one", activityId: activity.id });
    expect(shared.status).toBe(201);
    expect(shared.body.post.kind).toBe("ACTIVITY_SHARE");
    expect(shared.body.post.activity.id).toBe(activity.id);
    expect(shared.body.post.activity.distanceM).toBe(8000);

    const empty = await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set(auth)
      .send({});
    expect(empty.status).toBe(400);
  });

  it("cannot share PRIVATE or someone else's activity", async () => {
    const { app, teamId, r1, r2 } = await setup();
    const auth1 = cookieHeader(r1);
    const auth2 = cookieHeader(r2);

    const priv = await logActivity(r1, teamId, "PRIVATE");
    const sharePriv = await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set(auth1)
      .send({ activityId: priv.id });
    expect(sharePriv.status).toBe(422);
    expect(sharePriv.body.error.code).toBe("INVALID_ACTIVITY");

    const theirs = await logActivity(r1, teamId);
    const shareTheirs = await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set(auth2)
      .send({ activityId: theirs.id });
    expect(shareTheirs.status).toBe(422);
  });

  it("feed lists newest first with reaction summaries", async () => {
    const { app, teamId, r1, r2 } = await setup();
    const auth1 = cookieHeader(r1);

    await request(app.server).post(`/api/v1/teams/${teamId}/feed`).set(auth1).send({ body: "First" });
    await request(app.server).post(`/api/v1/teams/${teamId}/feed`).set(auth1).send({ body: "Second" });

    const feed = await request(app.server)
      .get(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(r2));
    expect(feed.status).toBe(200);
    // Welcome posts for the two runners also appear; assert on TEXT posts.
    const texts = feed.body.posts.filter((p: any) => p.kind === "TEXT");
    expect(texts).toHaveLength(2);
    expect(texts[0].body).toBe("Second");
    expect(feed.body.posts[0].commentCount).toBe(0);
    expect(feed.body.posts[0].reactions).toEqual([]);
  });

  it("non-members cannot read or post to the feed", async () => {
    const { app, teamId } = await setup();
    const outsider = await registerUser("RUNNER", "fout");

    const read = await request(app.server)
      .get(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(outsider));
    expect(read.status).toBe(404);

    const post = await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(outsider))
      .send({ body: "Hello" });
    expect(post.status).toBe(404);
  });

  it("comments: create, list, delete by author or coach", async () => {
    const { app, coach, teamId, r1, r2 } = await setup();

    const post = await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(r1))
      .send({ body: "Comment on this" });

    const c1 = await request(app.server)
      .post(`/api/v1/posts/${post.body.post.id}/comments`)
      .set(cookieHeader(r2))
      .send({ body: "Nice!" });
    expect(c1.status).toBe(201);

    const list = await request(app.server)
      .get(`/api/v1/posts/${post.body.post.id}/comments`)
      .set(cookieHeader(r1));
    expect(list.body.comments).toHaveLength(1);
    expect(list.body.comments[0].authorName).toBeDefined();

    // Another runner cannot delete r2's comment
    const blocked = await request(app.server)
      .delete(`/api/v1/comments/${c1.body.comment.id}`)
      .set(cookieHeader(r1));
    expect(blocked.status).toBe(403);

    // Coach can moderate it
    const moderated = await request(app.server)
      .delete(`/api/v1/comments/${c1.body.comment.id}`)
      .set(cookieHeader(coach));
    expect(moderated.status).toBe(200);
  });

  it("reactions toggle and aggregate", async () => {
    const { app, teamId, r1, r2 } = await setup();

    const post = await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(r1))
      .send({ body: "React to this" });
    const postId = post.body.post.id;

    const react = (u: TestUser, emoji: string) =>
      request(app.server)
        .post(`/api/v1/posts/${postId}/reactions`)
        .set(cookieHeader(u))
        .send({ emoji });

    const first = await react(r2, "🔥");
    expect(first.body.reactions).toEqual([{ emoji: "🔥", count: 1 }]);
    expect(first.body.myReactions).toEqual(["🔥"]);

    await react(r1, "🔥");
    await react(r2, "👍");
    // Toggling off
    const toggled = await react(r2, "🔥");
    const fire = toggled.body.reactions.find((r: { emoji: string }) => r.emoji === "🔥");
    expect(fire.count).toBe(1); // only r1's remains
    expect(toggled.body.myReactions).toEqual(["👍"]);

    const bad = await react(r2, "💩");
    expect(bad.status).toBe(400);
  });

  it("report flow: runner reports, coach resolves", async () => {
    const { app, coach, teamId, r1, r2 } = await setup();

    const post = await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(r1))
      .send({ body: "Questionable content" });

    const report = await request(app.server)
      .post(`/api/v1/posts/${post.body.post.id}/report`)
      .set(cookieHeader(r2))
      .send({ reason: "Inappropriate" });
    expect(report.status).toBe(201);
    expect(report.body.report.status).toBe("OPEN");

    const dupe = await request(app.server)
      .post(`/api/v1/posts/${post.body.post.id}/report`)
      .set(cookieHeader(r2))
      .send({ reason: "Again" });
    expect(dupe.status).toBe(409);

    const queue = await request(app.server)
      .get(`/api/v1/teams/${teamId}/reports`)
      .set(cookieHeader(coach));
    expect(queue.body.reports).toHaveLength(1);

    const runnerQueue = await request(app.server)
      .get(`/api/v1/teams/${teamId}/reports`)
      .set(cookieHeader(r1));
    expect(runnerQueue.status).toBe(403);

    const resolved = await request(app.server)
      .post(`/api/v1/reports/${report.body.report.id}/resolve`)
      .set(cookieHeader(coach))
      .send({ status: "RESOLVED" });
    expect(resolved.body.report.status).toBe("RESOLVED");
  });

  it("coach can delete any post; author can delete own", async () => {
    const { app, coach, teamId, r1, r2 } = await setup();

    const post = await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(r1))
      .send({ body: "Delete me" });

    const peerBlocked = await request(app.server)
      .delete(`/api/v1/posts/${post.body.post.id}`)
      .set(cookieHeader(r2));
    expect(peerBlocked.status).toBe(403);

    const coachDelete = await request(app.server)
      .delete(`/api/v1/posts/${post.body.post.id}`)
      .set(cookieHeader(coach));
    expect(coachDelete.status).toBe(200);

    const post2 = await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(r1))
      .send({ body: "Delete me too" });
    const ownDelete = await request(app.server)
      .delete(`/api/v1/posts/${post2.body.post.id}`)
      .set(cookieHeader(r1));
    expect(ownDelete.status).toBe(200);
  });
});
