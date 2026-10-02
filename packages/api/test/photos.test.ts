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

// Minimal valid JPEG (magic bytes only — the validator checks headers).
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.alloc(100),
]);
const NOT_IMAGE = Buffer.from("this is not an image at all");

async function setup() {
  const app = await getApp();
  const coach = await registerUser("COACH", "phCoach");
  const runner = await registerUser("RUNNER", "phRunner");
  const teamId = await createTeamAs(coach, "Photo Team");
  await addRunnerToTeam(coach, teamId, runner);
  return { app, coach, runner, teamId };
}

async function upload(
  app: Awaited<ReturnType<typeof getApp>>,
  user: { cookies: string[] },
  teamId: string,
  buf: Buffer = JPEG,
  fileName = "photo.jpg",
) {
  return request(app.server)
    .post(`/api/v1/teams/${teamId}/photos`)
    .set(cookieHeader(user as never))
    .attach("file", buf, { filename: fileName, contentType: "image/jpeg" })
    .field("caption", "Finish line");
}

describe("photos and albums", () => {
  beforeEach(truncate);

  it("upload goes to PENDING; invisible until a coach approves", async () => {
    const { app, coach, runner, teamId } = await setup();

    const up = await upload(app, runner, teamId);
    expect(up.status).toBe(201);
    expect(up.body.photo.status).toBe("PENDING");

    // Runner's list is empty (pending hidden from members).
    const list = await request(app.server)
      .get(`/api/v1/teams/${teamId}/photos`)
      .set(cookieHeader(runner));
    expect(list.body.photos).toHaveLength(0);

    // Coach sees the pending queue and approves.
    const pending = await request(app.server)
      .get(`/api/v1/teams/${teamId}/photos/pending`)
      .set(cookieHeader(coach));
    expect(pending.body.photos).toHaveLength(1);

    const review = await request(app.server)
      .post(`/api/v1/photos/${up.body.photo.id}/review`)
      .set(cookieHeader(coach))
      .send({ approve: true });
    expect(review.body.photo.status).toBe("APPROVED");

    const list2 = await request(app.server)
      .get(`/api/v1/teams/${teamId}/photos`)
      .set(cookieHeader(runner));
    expect(list2.body.photos).toHaveLength(1);
    expect(list2.body.photos[0].caption).toBe("Finish line");
  });

  it("non-coaches cannot review; invalid files are rejected", async () => {
    const { app, runner, teamId } = await setup();
    const up = await upload(app, runner, teamId);

    const denied = await request(app.server)
      .post(`/api/v1/photos/${up.body.photo.id}/review`)
      .set(cookieHeader(runner))
      .send({ approve: true });
    expect(denied.status).toBe(403);

    const bad = await upload(app, runner, teamId, NOT_IMAGE, "evil.txt");
    expect(bad.status).toBe(422);
  });

  it("albums group photos; approved photos attach to posts", async () => {
    const { app, coach, runner, teamId } = await setup();

    const album = await request(app.server)
      .post(`/api/v1/teams/${teamId}/albums`)
      .set(cookieHeader(coach))
      .send({ title: "Race Day" });
    expect(album.status).toBe(201);

    const up = await request(app.server)
      .post(`/api/v1/teams/${teamId}/photos`)
      .set(cookieHeader(runner as never))
      .attach("file", JPEG, { filename: "p.jpg", contentType: "image/jpeg" })
      .field("albumId", album.body.album.id);
    expect(up.status).toBe(201);

    await request(app.server)
      .post(`/api/v1/photos/${up.body.photo.id}/review`)
      .set(cookieHeader(coach))
      .send({ approve: true });

    const albums = await request(app.server)
      .get(`/api/v1/teams/${teamId}/albums`)
      .set(cookieHeader(runner));
    expect(albums.body.albums[0].photoCount).toBe(1);
    expect(albums.body.albums[0].coverPhotoId).toBe(up.body.photo.id);

    // Attach to a feed post.
    const post = await request(app.server)
      .post(`/api/v1/teams/${teamId}/feed`)
      .set(cookieHeader(runner))
      .send({ body: "Race day!", photoIds: [up.body.photo.id] });
    expect(post.status).toBe(201);
    expect(post.body.post.photos).toHaveLength(1);
    expect(post.body.post.photos[0].id).toBe(up.body.photo.id);
  });

  it("photo bytes are served to team members only", async () => {
    const { app, coach, runner, teamId } = await setup();
    const outsider = await registerUser("RUNNER", "phOut");

    const up = await upload(app, runner, teamId);
    await request(app.server)
      .post(`/api/v1/photos/${up.body.photo.id}/review`)
      .set(cookieHeader(coach))
      .send({ approve: true });

    const ok = await request(app.server)
      .get(`/api/v1/photos/${up.body.photo.id}/file`)
      .set(cookieHeader(runner));
    expect(ok.status).toBe(200);
    expect(ok.headers["content-type"]).toBe("image/jpeg");

    const denied = await request(app.server)
      .get(`/api/v1/photos/${up.body.photo.id}/file`)
      .set(cookieHeader(outsider));
    expect(denied.status).toBe(404); // existence hidden from non-members
  });
});
