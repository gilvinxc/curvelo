import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { getApp, registerUser, truncate, cookieHeader } from "./helpers.js";

const JPEG_DATA_URL =
  "data:image/jpeg;base64," +
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]).toString("base64");

describe("profile avatars", () => {
  beforeEach(truncate);

  it("uploads, serves, and removes an avatar", async () => {
    const app = await getApp();
    const t = await registerUser("RUNNER", "avatar1");
    const cookies = cookieHeader(t).Cookie;

    const put = await request(app.server)
      .put("/api/v1/users/me/avatar")
      .set("Cookie", cookies)
      .send({ image: JPEG_DATA_URL });
    expect(put.status).toBe(200);
    expect(put.body.hasAvatar).toBe(true);

    const me = await request(app.server).get("/api/v1/auth/me").set("Cookie", cookies);
    expect(me.body.user.hasAvatar).toBe(true);

    const img = await request(app.server)
      .get(`/api/v1/users/${t.id}/avatar`)
      .set("Cookie", cookies);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/jpeg");

    const del = await request(app.server)
      .delete("/api/v1/users/me/avatar")
      .set("Cookie", cookies);
    expect(del.body.hasAvatar).toBe(false);
  });

  it("rejects a non-image data URL", async () => {
    const app = await getApp();
    const t = await registerUser("RUNNER", "avatar2");
    const res = await request(app.server)
      .put("/api/v1/users/me/avatar")
      .set("Cookie", cookieHeader(t).Cookie)
      .send({ image: "data:image/jpeg;base64,aGVsbG8=" });
    expect(res.status).toBe(400);
  });
});
