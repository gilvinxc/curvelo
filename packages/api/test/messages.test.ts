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

async function setup() {
  const app = await getApp();
  const coach = await registerUser("COACH", "mcoach");
  const teamId = await createTeamAs(coach, "Message Team");
  const runner = await registerUser("RUNNER", "mrunner");
  const runner2 = await registerUser("RUNNER", "mrunner2");
  const parent = await registerUser("PARENT", "mparent");
  const outsider = await registerUser("RUNNER", "moutsider");
  await addRunnerToTeam(coach, teamId, runner);
  await addRunnerToTeam(coach, teamId, runner2);

  // Link the parent to the runner.
  const app2 = await getApp();
  const invite = await request(app2.server)
    .post(`/api/v1/teams/${teamId}/athletes/${runner.id}/guardians/invite`)
    .set(cookieHeader(coach))
    .send({ email: parent.email, relationship: "parent" });
  const token = invite.body.invite.token;
  await request(app2.server)
    .post(`/api/v1/guardian-invites/${token}/accept`)
    .set(cookieHeader(parent))
    .send({ consents: ["PARTICIPATION"] });

  return { app, coach, teamId, runner, runner2, parent, outsider };
}

async function conversations(user: TestUser, teamId: string) {
  const app = await getApp();
  const res = await request(app.server)
    .get(`/api/v1/teams/${teamId}/conversations`)
    .set(cookieHeader(user));
  if (res.status !== 200) {
    throw new Error(`conversations failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.conversations;
}

describe("messages", () => {
  beforeEach(truncate);

  it("new teams get announcements + team chat channels", async () => {
    const { coach, teamId, runner } = await setup();
    const convs = await conversations(runner, teamId);
    const kinds = convs.map((c: { kind: string }) => c.kind).sort();
    expect(kinds).toEqual(["ANNOUNCEMENT", "TEAM_CHAT"]);
    const ann = convs.find((c: { kind: string }) => c.kind === "ANNOUNCEMENT");
    expect(ann.canPost).toBe(false); // runner cannot post announcements
    const chat = convs.find((c: { kind: string }) => c.kind === "TEAM_CHAT");
    expect(chat.canPost).toBe(true);

    const coachConvs = await conversations(coach, teamId);
    expect(
      coachConvs.find((c: { kind: string }) => c.kind === "ANNOUNCEMENT").canPost,
    ).toBe(true);
  });

  it("coach posts announcement; runner reads but cannot post", async () => {
    const { app, coach, teamId, runner } = await setup();
    const [ann] = (await conversations(coach, teamId)).filter(
      (c: { kind: string }) => c.kind === "ANNOUNCEMENT",
    );

    const posted = await request(app.server)
      .post(`/api/v1/teams/${teamId}/conversations/${ann.id}/messages`)
      .set(cookieHeader(coach))
      .send({ body: "Practice moved to 6pm" });
    expect(posted.status).toBe(201);
    expect(posted.body.message.body).toBe("Practice moved to 6pm");

    const denied = await request(app.server)
      .post(`/api/v1/teams/${teamId}/conversations/${ann.id}/messages`)
      .set(cookieHeader(runner))
      .send({ body: "Can I bring a friend?" });
    expect(denied.status).toBe(403);

    const read = await request(app.server)
      .get(`/api/v1/teams/${teamId}/conversations/${ann.id}/messages`)
      .set(cookieHeader(runner));
    expect(read.status).toBe(200);
    expect(read.body.messages).toHaveLength(1);
    expect(read.body.messages[0].authorRole).toBe("COACH");
  });

  it("runners chat freely in team chat; messages paginate", async () => {
    const { app, teamId, runner, runner2 } = await setup();
    const [chat] = (await conversations(runner, teamId)).filter(
      (c: { kind: string }) => c.kind === "TEAM_CHAT",
    );

    for (let i = 1; i <= 3; i++) {
      const r = await request(app.server)
        .post(`/api/v1/teams/${teamId}/conversations/${chat.id}/messages`)
        .set(cookieHeader(i % 2 ? runner : runner2))
        .send({ body: `message ${i}` });
      expect(r.status).toBe(201);
    }

    const page1 = await request(app.server)
      .get(`/api/v1/teams/${teamId}/conversations/${chat.id}/messages?limit=2`)
      .set(cookieHeader(runner));
    expect(page1.body.messages).toHaveLength(2);
    expect(page1.body.hasMore).toBe(true);
    expect(page1.body.messages[0].body).toBe("message 2"); // oldest first within page

    const before = page1.body.messages[0].createdAt;
    const page2 = await request(app.server)
      .get(
        `/api/v1/teams/${teamId}/conversations/${chat.id}/messages?limit=2&before=${before}`,
      )
      .set(cookieHeader(runner));
    expect(page2.body.messages).toHaveLength(1);
    expect(page2.body.hasMore).toBe(false);
  });

  it("group chats are scoped to group members (+ coaches)", async () => {
    const { app, coach, teamId, runner, runner2 } = await setup();
    const groupRes = await request(app.server)
      .post(`/api/v1/teams/${teamId}/groups`)
      .set(cookieHeader(coach))
      .send({ name: "Sprinters", memberIds: [runner.id] });
    expect(groupRes.status).toBe(201);

    const convs = await conversations(runner, teamId);
    const groupChat = convs.find((c: { kind: string }) => c.kind === "GROUP_CHAT");
    expect(groupChat).toBeDefined();
    expect(groupChat.canPost).toBe(true);

    const outsiderConvs = await conversations(runner2, teamId);
    const outsiderView = outsiderConvs.find((c: { kind: string }) => c.kind === "GROUP_CHAT");
    expect(outsiderView.canPost).toBe(false);
    const denied = await request(app.server)
      .post(`/api/v1/teams/${teamId}/conversations/${groupChat.id}/messages`)
      .set(cookieHeader(runner2))
      .send({ body: "not my group" });
    expect(denied.status).toBe(403);

    const ok = await request(app.server)
      .post(`/api/v1/teams/${teamId}/conversations/${groupChat.id}/messages`)
      .set(cookieHeader(runner))
      .send({ body: "sprint day" });
    expect(ok.status).toBe(201);
  });

  it("guardians get read-only access; non-members get 404", async () => {
    const { app, coach, teamId, parent, outsider } = await setup();
    const convs = await conversations(parent, teamId);
    expect(convs.length).toBeGreaterThan(0);
    expect(convs.every((c: { canPost: boolean }) => c.canPost === false)).toBe(true);

    const [chat] = convs.filter((c: { kind: string }) => c.kind === "TEAM_CHAT");
    const post = await request(app.server)
      .post(`/api/v1/teams/${teamId}/conversations/${chat.id}/messages`)
      .set(cookieHeader(parent))
      .send({ body: "go team" });
    expect(post.status).toBe(403);

    const read = await request(app.server)
      .get(`/api/v1/teams/${teamId}/conversations/${chat.id}/messages`)
      .set(cookieHeader(parent));
    expect(read.status).toBe(200);

    // Coach posts first so the parent has something to read.
    await request(app.server)
      .post(`/api/v1/teams/${teamId}/conversations/${chat.id}/messages`)
      .set(cookieHeader(coach))
      .send({ body: "hello team" });
    const read2 = await request(app.server)
      .get(`/api/v1/teams/${teamId}/conversations/${chat.id}/messages`)
      .set(cookieHeader(parent));
    expect(read2.body.messages).toHaveLength(1);

    const blocked = await request(app.server)
      .get(`/api/v1/teams/${teamId}/conversations`)
      .set(cookieHeader(outsider));
    expect(blocked.status).toBe(404);
  });

  it("authors edit own messages; coaches moderate any message", async () => {
    const { app, coach, teamId, runner, runner2 } = await setup();
    const [chat] = (await conversations(runner, teamId)).filter(
      (c: { kind: string }) => c.kind === "TEAM_CHAT",
    );
    const posted = await request(app.server)
      .post(`/api/v1/teams/${teamId}/conversations/${chat.id}/messages`)
      .set(cookieHeader(runner))
      .send({ body: "typo heree" });
    const msgId = posted.body.message.id;

    const edited = await request(app.server)
      .patch(`/api/v1/messages/${msgId}`)
      .set(cookieHeader(runner))
      .send({ body: "typo here" });
    expect(edited.status).toBe(200);
    expect(edited.body.message.body).toBe("typo here");
    expect(edited.body.message.editedAt).not.toBeNull();

    // Another runner cannot edit it.
    const blocked = await request(app.server)
      .patch(`/api/v1/messages/${msgId}`)
      .set(cookieHeader(runner2))
      .send({ body: "hijacked" });
    expect(blocked.status).toBe(403);

    // Coach moderates it away.
    const deleted = await request(app.server)
      .delete(`/api/v1/messages/${msgId}`)
      .set(cookieHeader(coach));
    expect(deleted.status).toBe(200);

    const read = await request(app.server)
      .get(`/api/v1/teams/${teamId}/conversations/${chat.id}/messages`)
      .set(cookieHeader(runner));
    expect(read.body.messages[0].deleted).toBe(true);
    expect(read.body.messages[0].body).toBeNull();
  });
});
