import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { getApp, registerUser, truncate, cookieHeader, addRunnerToTeam } from "./helpers.js";

describe("unified personal calendar", () => {
  beforeEach(truncate);

  it("returns team events across all my teams", async () => {
    const app = await getApp();
    const coach = await registerUser("COACH", "ucal1");
    const runner = await registerUser("RUNNER", "ucal2");
    const mkTeam = async (name: string, slug: string) => {
      const r = await request(app.server)
        .post("/api/v1/teams")
        .set("Cookie", cookieHeader(coach).Cookie)
        .send({ name, slug });
      return r.body.team.id as string;
    };
    const t1 = await mkTeam("UC Team 1", "uc-team-1");
    const t2 = await mkTeam("UC Team 2", "uc-team-2");
    await addRunnerToTeam(coach, t1, runner);
    await addRunnerToTeam(coach, t2, runner);

    for (const [tid, title] of [[t1, "Race A"], [t2, "Practice B"]] as const) {
      await request(app.server)
        .post(`/api/v1/teams/${tid}/events`)
        .set("Cookie", cookieHeader(coach).Cookie)
        .send({
          title,
          eventType: "RACE",
          date: "2026-11-15",
          startTime: "09:00",
        });
    }

    const res = await request(app.server)
      .get("/api/v1/team-events/mine?from=2026-11-01&to=2026-11-30")
      .set("Cookie", cookieHeader(runner).Cookie);
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(2);
    expect(res.body.events[0].teamName).toBeTruthy();
  });
});
