import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  getApp,
  registerUser,
  truncate,
  cookieHeader,
  createTeamAs,
  addRunnerToTeam,
} from "./helpers.js";

async function setup() {
  const app = await getApp();
  const coach = await registerUser("COACH", "evcoach");
  const teamId = await createTeamAs(coach, "Event Team");
  const r1 = await registerUser("RUNNER", "evr1");
  await addRunnerToTeam(coach, teamId, r1);
  return { app, coach, teamId, r1 };
}

describe("team events", () => {
  beforeEach(truncate);

  it("coach creates a single event; runner sees it on the calendar", async () => {
    const { app, coach, teamId, r1 } = await setup();

    const created = await request(app.server)
      .post(`/api/v1/teams/${teamId}/events`)
      .set(cookieHeader(coach))
      .send({
        title: "Tuesday practice",
        eventType: "PRACTICE",
        date: "2026-11-03",
        startTime: "17:00",
        endTime: "18:30",
        location: "High school track",
      });
    expect(created.status).toBe(201);
    expect(created.body.event.title).toBe("Tuesday practice");
    expect(created.body.event.startAt).toContain("2026-11-03");

    const denied = await request(app.server)
      .post(`/api/v1/teams/${teamId}/events`)
      .set(cookieHeader(r1))
      .send({
        title: "Sneaky meeting",
        date: "2026-11-04",
        startTime: "17:00",
      });
    expect(denied.status).toBe(403);

    const cal = await request(app.server)
      .get(`/api/v1/teams/${teamId}/calendar?from=2026-11-01&to=2026-11-30`)
      .set(cookieHeader(r1));
    expect(cal.status).toBe(200);
    expect(cal.body.events).toHaveLength(1);
    expect(cal.body.events[0].location).toBe("High school track");
  });

  it("weekly recurring practice expands across the range", async () => {
    const { app, coach, teamId } = await setup();

    const created = await request(app.server)
      .post(`/api/v1/teams/${teamId}/events`)
      .set(cookieHeader(coach))
      .send({
        title: "Morning run",
        eventType: "PRACTICE",
        date: "2026-11-02",
        startTime: "06:30",
        recurrence: { freq: "WEEKLY", days: [0, 2], until: "2026-11-30" },
      });
    expect(created.status).toBe(201);
    expect(created.body.event.recurring).toBe(true);

    const list = await request(app.server)
      .get(`/api/v1/teams/${teamId}/events?from=2026-11-01&to=2026-11-30`)
      .set(cookieHeader(coach));
    expect(list.status).toBe(200);
    // Mon/Wed in Nov 2026 from the 2nd: 9 occurrences.
    expect(list.body.events).toHaveLength(9);
    const dates = list.body.events.map((e: { startAt: string }) =>
      e.startAt.slice(0, 10),
    );
    expect(dates[0]).toBe("2026-11-02");
    expect(dates).toContain("2026-11-30");
  });

  it("race day with itinerary; update and delete", async () => {
    const { app, coach, teamId, r1 } = await setup();

    const created = await request(app.server)
      .post(`/api/v1/teams/${teamId}/events`)
      .set(cookieHeader(coach))
      .send({
        title: "Regional championships",
        eventType: "RACE",
        date: "2026-11-14",
        startTime: "08:00",
        location: "State park",
        itinerary: "7:00 — Arrive\n7:30 — Warmup\n8:00 — Race start",
      });
    expect(created.status).toBe(201);
    const eventId = created.body.event.id as string;

    const seen = await request(app.server)
      .get(`/api/v1/teams/${teamId}/events?from=2026-11-01&to=2026-11-30`)
      .set(cookieHeader(r1));
    expect(seen.body.events[0].itinerary).toContain("Warmup");

    const updated = await request(app.server)
      .patch(`/api/v1/teams/${teamId}/events/${eventId}`)
      .set(cookieHeader(coach))
      .send({ location: "New venue" });
    expect(updated.status).toBe(200);
    expect(updated.body.event.location).toBe("New venue");

    const runnerDelete = await request(app.server)
      .delete(`/api/v1/teams/${teamId}/events/${eventId}`)
      .set(cookieHeader(r1));
    expect(runnerDelete.status).toBe(403);

    const del = await request(app.server)
      .delete(`/api/v1/teams/${teamId}/events/${eventId}`)
      .set(cookieHeader(coach));
    expect(del.status).toBe(200);
  });
});
