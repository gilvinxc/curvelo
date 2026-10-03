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
import { db } from "../src/db.js";

const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.alloc(100),
]);

let counter = 0;
async function registerMinor(emailPrefix: string): Promise<TestUser> {
  const app = await getApp();
  counter += 1;
  const email = `${emailPrefix}${counter}@example.com`;
  const res = await request(app.server).post("/api/v1/auth/register").send({
    email,
    password: "TestPass123!",
    displayName: `${emailPrefix} ${counter}`,
    role: "RUNNER",
    dateOfBirth: "2012-06-15", // minor
  });
  if (res.status !== 201) throw new Error(`register minor failed: ${res.status}`);
  return { id: res.body.user.id, email, cookies: res.headers["set-cookie"] };
}

async function setup() {
  const app = await getApp();
  const coach = await registerUser("COACH", "pcoach");
  const teamId = await createTeamAs(coach, "Parent Team");
  const kid1 = await registerMinor("pkid1");
  const kid2 = await registerMinor("pkid2");
  const kid3 = await registerMinor("pkid3");
  const adult = await registerUser("RUNNER", "padult");
  // adult athlete: definitely over 18
  await db.user.update({
    where: { id: adult.id },
    data: { dateOfBirth: new Date("1990-01-01") },
  });
  const parent = await registerUser("PARENT", "pparent");
  for (const kid of [kid1, kid2, kid3]) await addRunnerToTeam(coach, teamId, kid);
  await addRunnerToTeam(coach, teamId, adult);
  return { app, coach, teamId, kid1, kid2, kid3, adult, parent };
}

async function linkParent(
  app: Awaited<ReturnType<typeof getApp>>,
  coach: TestUser,
  teamId: string,
  athlete: TestUser,
  parent: TestUser,
  consents: string[] = ["PARTICIPATION", "DATA_SHARING", "PHOTO_SHARING"],
) {
  const invite = await request(app.server)
    .post(`/api/v1/teams/${teamId}/athletes/${athlete.id}/guardians/invite`)
    .set(cookieHeader(coach))
    .send({ email: parent.email, relationship: "parent" });
  if (invite.status !== 201) throw new Error("invite failed");
  const accept = await request(app.server)
    .post(`/api/v1/guardian-invites/${invite.body.invite.token}/accept`)
    .set(cookieHeader(parent))
    .send({ consents });
  if (accept.status !== 200) throw new Error(`accept failed: ${accept.status}`);
  return accept.body.link;
}

async function grantPhotoConsentDirect(
  app: Awaited<ReturnType<typeof getApp>>,
  parent: TestUser,
  athleteId: string,
) {
  const res = await request(app.server)
    .post(`/api/v1/guardian/children/${athleteId}/photo-consent`)
    .set(cookieHeader(parent))
    .send({ granted: true });
  if (res.status !== 200) throw new Error(`grant failed: ${res.status}`);
}

function upload(
  app: Awaited<ReturnType<typeof getApp>>,
  user: TestUser,
  teamId: string,
  pictured: string[] = [],
) {
  const req = request(app.server)
    .post(`/api/v1/teams/${teamId}/photos`)
    .set(cookieHeader(user))
    .attach("file", JPEG, { filename: "p.jpg", contentType: "image/jpeg" })
    .field("caption", "Team photo");
  if (pictured.length > 0) req.field("picturedAthleteIds", JSON.stringify(pictured));
  return req;
}

async function approve(app: Awaited<ReturnType<typeof getApp>>, coach: TestUser, photoId: string) {
  const res = await request(app.server)
    .post(`/api/v1/photos/${photoId}/review`)
    .set(cookieHeader(coach))
    .send({ approve: true });
  if (res.status !== 200) throw new Error(`approve failed: ${res.status}`);
}

describe("parent team memberships", () => {
  beforeEach(truncate);

  it("verified link grants PARENT membership on the athlete's teams", async () => {
    const { app, coach, teamId, kid1, parent } = await setup();
    await linkParent(app, coach, teamId, kid1, parent);

    const membership = await db.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId: parent.id } },
    });
    expect(membership?.role).toBe("PARENT");
    expect(membership?.status).toBe("ACTIVE");
  });

  it("parent joins a second team when their athlete does", async () => {
    const { app, coach, teamId, kid1, parent } = await setup();
    await linkParent(app, coach, teamId, kid1, parent);

    const team2 = await createTeamAs(coach, "Second Team");
    await addRunnerToTeam(coach, team2, kid1);

    const membership = await db.teamMembership.findUnique({
      where: { teamId_userId: { teamId: team2, userId: parent.id } },
    });
    expect(membership?.role).toBe("PARENT");
    expect(membership?.status).toBe("ACTIVE");
  });

  it("revoking the link removes the PARENT membership", async () => {
    const { app, coach, teamId, kid1, parent } = await setup();
    const link = await linkParent(app, coach, teamId, kid1, parent);

    const revoke = await request(app.server)
      .delete(`/api/v1/guardian-links/${link.id}`)
      .set(cookieHeader(parent));
    expect(revoke.status).toBe(200);

    const membership = await db.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId: parent.id } },
    });
    expect(membership?.status).toBe("REMOVED");
  });

  it("revoking one link keeps membership when another kid is on the team", async () => {
    const { app, coach, teamId, kid1, kid2, parent } = await setup();
    const link1 = await linkParent(app, coach, teamId, kid1, parent);
    await linkParent(app, coach, teamId, kid2, parent);

    await request(app.server)
      .delete(`/api/v1/guardian-links/${link1.id}`)
      .set(cookieHeader(parent));

    const membership = await db.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId: parent.id } },
    });
    expect(membership?.status).toBe("ACTIVE");
  });

  it("a parent who is also a coach keeps their COACH role", async () => {
    const { app, coach, teamId, kid1, parent } = await setup();
    // Parent is separately added as a coach.
    await addRunnerToTeam(coach, teamId, parent);
    await db.teamMembership.update({
      where: { teamId_userId: { teamId, userId: parent.id } },
      data: { role: "COACH" },
    });

    await linkParent(app, coach, teamId, kid1, parent);

    const membership = await db.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId: parent.id } },
    });
    expect(membership?.role).toBe("COACH");
    expect(membership?.status).toBe("ACTIVE");
  });

  it("roster excludes PARENT memberships", async () => {
    const { app, coach, teamId, kid1, parent } = await setup();
    await linkParent(app, coach, teamId, kid1, parent);

    const res = await request(app.server)
      .get(`/api/v1/teams/${teamId}/roster`)
      .set(cookieHeader(coach));
    expect(res.status).toBe(200);
    const ids = res.body.roster.map((m: { userId: string }) => m.userId);
    expect(ids).not.toContain(parent.id);
    expect(ids).toContain(kid1.id);
  });

  it("parents cannot be added to training groups", async () => {
    const { app, coach, teamId, kid1, parent } = await setup();
    await linkParent(app, coach, teamId, kid1, parent);

    const group = await request(app.server)
      .post(`/api/v1/teams/${teamId}/groups`)
      .set(cookieHeader(coach))
      .send({ name: "Sprinters" });
    expect(group.status).toBe(201);

    const add = await request(app.server)
      .post(`/api/v1/groups/${group.body.group.id}/members`)
      .set(cookieHeader(coach))
      .send({ memberIds: [parent.id] });
    expect(add.status).toBe(422);
  });
});

describe("parent feed participation", () => {
  beforeEach(truncate);

  it("parent can view feed, comment, and react (including good luck)", async () => {
    const { app, coach, teamId, kid1, parent } = await setup();
    await linkParent(app, coach, teamId, kid1, parent);

    // Coach posts something.
    const post = await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(coach))
      .send({ body: "Great practice today" });
    expect(post.status).toBe(201);
    const postId = post.body.post.id;

    // Parent views the feed.
    const feed = await request(app.server)
      .get(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(parent));
    expect(feed.status).toBe(200);
    expect(feed.body.posts.some((p: { id: string }) => p.id === postId)).toBe(true);

    // Parent comments.
    const comment = await request(app.server)
      .post(`/api/v1/posts/${postId}/comments`)
      .set(cookieHeader(parent))
      .send({ body: "Way to go team!" });
    expect(comment.status).toBe(201);

    // Parent reacts with good luck.
    const react = await request(app.server)
      .post(`/api/v1/posts/${postId}/reactions`)
      .set(cookieHeader(parent))
      .send({ emoji: "🍀" });
    expect(react.status).toBe(200);
    expect(react.body.myReactions).toContain("🍀");
  });

  it("parent can share photos but not text posts", async () => {
    const { app, coach, teamId, kid1, parent } = await setup();
    await linkParent(app, coach, teamId, kid1, parent);

    const text = await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(parent))
      .send({ body: "Hello team" });
    expect(text.status).toBe(403);

    // Photo post works (no pictured minors).
    const up = await upload(app, parent, teamId);
    expect(up.status).toBe(201);
    await approve(app, coach, up.body.photo.id);
    const photo = await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(parent))
      .send({ photoIds: [up.body.photo.id], body: "Race day!" });
    expect(photo.status).toBe(201);
    expect(photo.body.post.kind).toBe("PHOTO");
  });

  it("parent can delete own post/comment but not others'", async () => {
    const { app, coach, teamId, kid1, parent } = await setup();
    await linkParent(app, coach, teamId, kid1, parent);

    const coachPost = await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(coach))
      .send({ body: "Coach post" });

    // Parent can't delete the coach's post.
    const del1 = await request(app.server)
      .delete(`/api/v1/posts/${coachPost.body.post.id}`)
      .set(cookieHeader(parent));
    expect(del1.status).toBe(403);

    // Parent comments, then deletes their own comment.
    const comment = await request(app.server)
      .post(`/api/v1/posts/${coachPost.body.post.id}/comments`)
      .set(cookieHeader(parent))
      .send({ body: "Nice!" });
    const del2 = await request(app.server)
      .delete(`/api/v1/comments/${comment.body.comment.id}`)
      .set(cookieHeader(parent));
    expect(del2.status).toBe(200);
  });

  it("parent is read-only in team chat", async () => {
    const { app, coach, teamId, kid1, parent } = await setup();
    await linkParent(app, coach, teamId, kid1, parent);

    const convs = await request(app.server)
      .get(`/api/v1/teams/${teamId}/conversations`)
      .set(cookieHeader(parent));
    expect(convs.status).toBe(200);
    const huddle = convs.body.conversations.find(
      (c: { kind: string }) => c.kind === "TEAM_CHAT",
    );
    expect(huddle).toBeDefined();
    expect(huddle.canPost).toBe(false);
  });
});

describe("photo consent gate", () => {
  beforeEach(truncate);

  it("blocks upload when a pictured minor lacks consent, naming them", async () => {
    const { app, coach, teamId, kid1, kid2, kid3, parent } = await setup();
    // Consent for kid1 and kid2 only.
    await linkParent(app, coach, teamId, kid1, parent);
    await linkParent(app, coach, teamId, kid2, parent);
    await linkParent(app, coach, teamId, kid3, parent, ["PARTICIPATION"]);

    const kid3Name = (await db.user.findUnique({ where: { id: kid3.id } }))!.displayName;
    const up = await upload(app, parent, teamId, [kid1.id, kid2.id, kid3.id]);
    expect(up.status).toBe(422);
    expect(up.body.error.code).toBe("PHOTO_CONSENT_MISSING");
    expect(up.body.error.message).toContain(kid3Name);
  });

  it("publishes when every pictured minor has consent", async () => {
    const { app, coach, teamId, kid1, kid2, parent } = await setup();
    await linkParent(app, coach, teamId, kid1, parent);
    await linkParent(app, coach, teamId, kid2, parent);

    const up = await upload(app, parent, teamId, [kid1.id, kid2.id]);
    expect(up.status).toBe(201);
    expect(up.body.photo.picturedAthleteIds).toEqual(
      expect.arrayContaining([kid1.id, kid2.id]),
    );
    await approve(app, coach, up.body.photo.id);

    const post = await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(parent))
      .send({ photoIds: [up.body.photo.id], body: "Podium!" });
    expect(post.status).toBe(201);
  });

  it("inline grant for own kid unblocks the share", async () => {
    const { app, coach, teamId, kid1, parent } = await setup();
    await linkParent(app, coach, teamId, kid1, parent, ["PARTICIPATION"]);

    const up = await upload(app, parent, teamId);
    expect(up.status).toBe(201);
    await approve(app, coach, up.body.photo.id);

    const post = await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(parent))
      .send({
        photoIds: [up.body.photo.id],
        picturedAthleteIds: [kid1.id],
        grantPhotoConsentFor: [kid1.id],
      });
    expect(post.status).toBe(201);

    // Consent record now exists.
    const consent = await db.consent.findFirst({
      where: { athleteId: kid1.id, guardianId: parent.id, type: "PHOTO_SHARING" },
    });
    expect(consent?.status).toBe("GRANTED");
  });

  it("non-guardian cannot grant photo consent", async () => {
    const { app, coach, teamId, kid1, kid2, parent } = await setup();
    await linkParent(app, coach, teamId, kid1, parent);
    // kid2 is on the team but has no link to this parent.

    const res = await request(app.server)
      .post(`/api/v1/guardian/children/${kid2.id}/photo-consent`)
      .set(cookieHeader(parent))
      .send({ granted: true });
    expect(res.status).toBe(403);
  });

  it("revocation blocks future shares (per-share check, never cached)", async () => {
    const { app, coach, teamId, kid1, parent } = await setup();
    await linkParent(app, coach, teamId, kid1, parent);

    const up1 = await upload(app, parent, teamId, [kid1.id]);
    expect(up1.status).toBe(201);
    await approve(app, coach, up1.body.photo.id);
    const post1 = await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(parent))
      .send({ photoIds: [up1.body.photo.id] });
    expect(post1.status).toBe(201);

    // Revoke.
    const revoke = await request(app.server)
      .post(`/api/v1/guardian/children/${kid1.id}/photo-consent`)
      .set(cookieHeader(parent))
      .send({ granted: false });
    expect(revoke.status).toBe(200);

    // A second photo with the same pictured kid is now blocked.
    const up2 = await upload(app, parent, teamId, [kid1.id]);
    expect(up2.status).toBe(422);
    expect(up2.body.error.code).toBe("PHOTO_CONSENT_MISSING");
  });

  it("adults pictured never need consent", async () => {
    const { app, coach, teamId, adult, parent } = await setup();
    await linkParent(app, coach, teamId, adult, parent, ["PARTICIPATION"]);

    const up = await upload(app, parent, teamId, [adult.id]);
    expect(up.status).toBe(201);
  });

  it("caption @mention of a minor without consent blocks the post", async () => {
    const { app, coach, teamId, kid1, parent } = await setup();
    await linkParent(app, coach, teamId, kid1, parent, ["PARTICIPATION"]);

    const up = await upload(app, parent, teamId);
    await approve(app, coach, up.body.photo.id);

    // Mention kid1 (no photo consent) in the caption.
    const kidName = (await db.user.findUnique({ where: { id: kid1.id } }))!.displayName;
    const post = await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(parent))
      .send({ photoIds: [up.body.photo.id], body: `Great race @${kidName}!` });
    expect(post.status).toBe(422);
    expect(post.body.error.code).toBe("PHOTO_CONSENT_MISSING");
  });

  it("member photo shares are consent-gated too", async () => {
    const { app, coach, teamId, kid1, kid2 } = await setup();
    // A teammate (kid2's perspective): upload picturing kid1 without consent.
    const up = await upload(app, kid2, teamId, [kid1.id]);
    expect(up.status).toBe(422);
  });
});

describe("guardian log-for-child", () => {
  beforeEach(truncate);

  it("guardian logs a run for their kid; kid is notified", async () => {
    const { app, coach, teamId, kid1, parent } = await setup();
    await linkParent(app, coach, teamId, kid1, parent);

    const res = await request(app.server)
      .post(`/api/v1/guardian/children/${kid1.id}/activities`)
      .set(cookieHeader(parent))
      .send({
        kind: "RUN",
        startedAt: new Date().toISOString(),
        distanceM: 5000,
        durationS: 1500,
        teamId,
        visibility: "TEAM",
      });
    expect(res.status).toBe(201);
    expect(res.body.activity.userId).toBe(kid1.id);
    expect(res.body.activity.loggedByName).toBeTruthy();
    expect(res.body.activity.loggedByUserId).toBe(parent.id);

    const notif = await db.notification.findFirst({
      where: { userId: kid1.id, type: "ACTIVITY_LOGGED_BY_GUARDIAN" },
    });
    expect(notif).toBeTruthy();
    expect(notif!.link).toContain(res.body.activity.id);
  });

  it("guardian cannot log for a non-linked athlete", async () => {
    const { app, coach, teamId, kid1, kid2, parent } = await setup();
    await linkParent(app, coach, teamId, kid1, parent);

    const res = await request(app.server)
      .post(`/api/v1/guardian/children/${kid2.id}/activities`)
      .set(cookieHeader(parent))
      .send({
        kind: "RUN",
        startedAt: new Date().toISOString(),
        distanceM: 5000,
        durationS: 1500,
      });
    expect(res.status).toBe(403);
  });

  it("guardian cannot use another team's context", async () => {
    const { app, coach, teamId, kid1, parent } = await setup();
    await linkParent(app, coach, teamId, kid1, parent);
    const otherTeam = await createTeamAs(coach, "Other Team");

    const res = await request(app.server)
      .post(`/api/v1/guardian/children/${kid1.id}/activities`)
      .set(cookieHeader(parent))
      .send({
        kind: "RUN",
        startedAt: new Date().toISOString(),
        distanceM: 5000,
        durationS: 1500,
        teamId: otherTeam,
      });
    expect(res.status).toBe(422);
  });
});

describe("family calendar rollup", () => {
  beforeEach(truncate);

  it("merges kids' assignments labeled per kid", async () => {
    const { app, coach, teamId, kid1, kid2, parent } = await setup();
    await linkParent(app, coach, teamId, kid1, parent);
    await linkParent(app, coach, teamId, kid2, parent);

    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const res = await request(app.server)
      .get(`/api/v1/guardian/calendar?from=${from}&to=${to}`)
      .set(cookieHeader(parent));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    // Every item is labeled with its athlete.
    for (const item of res.body.items) {
      expect(item.athleteId).toBeDefined();
      expect(item.athleteName).toBeDefined();
    }
  });

  it("guardian teams lists PARENT memberships", async () => {
    const { app, coach, teamId, kid1, parent } = await setup();
    await linkParent(app, coach, teamId, kid1, parent);

    const res = await request(app.server)
      .get(`/api/v1/guardian/teams`)
      .set(cookieHeader(parent));
    expect(res.status).toBe(200);
    expect(res.body.teams.length).toBe(1);
    expect(res.body.teams[0].id).toBe(teamId);
  });
});
