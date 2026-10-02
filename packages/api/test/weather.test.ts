import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  getApp,
  registerUser,
  truncate,
  cookieHeader,
} from "./helpers.js";

const app = () => getApp();

function mockOpenMeteo(tempC: number, code: number) {
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = url.includes("geocoding-api")
        ? { results: [{ latitude: 38.0, longitude: -84.0 }] }
        : {
            hourly: {
              time: ["2026-10-02T12:00"],
              temperature_2m: [tempC],
              weathercode: [code],
            },
          };
      return { ok: true, json: async () => body } as Response;
    }),
  );
  return realFetch;
}

describe("weather auto-fill", () => {
  beforeEach(truncate);
  afterEach(() => vi.unstubAllGlobals());

  it("auto-pulls weather from Open-Meteo when a city is logged", async () => {
    const realFetch = mockOpenMeteo(18.5, 61); // 61 = Rain
    try {
      const a = await app();
      const user = await registerUser("RUNNER", "wx1");
      const res = await request(a.server)
        .post("/api/v1/activities")
        .set(cookieHeader(user))
        .send({
          kind: "RUN",
          startedAt: new Date("2026-10-02T12:00:00").toISOString(),
          distanceM: 5000,
          durationS: 1500,
          city: "Winchester",
        });
      expect(res.status).toBe(201);
      expect(res.body.activity.city).toBe("Winchester");
      expect(res.body.activity.weatherTempC).toBe(18.5);
      expect(res.body.activity.weatherCondition).toBe("Rain");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("manual weather wins; lookup failure leaves fields empty", async () => {
    const a = await app();
    const user = await registerUser("RUNNER", "wx2");

    // Manual values are stored as-is.
    const manual = await request(a.server)
      .post("/api/v1/activities")
      .set(cookieHeader(user))
      .send({
        kind: "RUN",
        startedAt: new Date(Date.now() - 3600000).toISOString(),
        durationS: 1800,
        city: "Winchester",
        weatherTempC: 30,
        weatherCondition: "Heat wave",
      });
    expect(manual.status).toBe(201);
    expect(manual.body.activity.weatherTempC).toBe(30);
    expect(manual.body.activity.weatherCondition).toBe("Heat wave");

    // Lookup failure (no geocode result) leaves fields null, activity still saves.
    const realFetch = mockOpenMeteo(0, 0);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response),
    );
    try {
      const res = await request(a.server)
        .post("/api/v1/activities")
        .set(cookieHeader(user))
        .send({
          kind: "RUN",
          startedAt: new Date(Date.now() - 3600000).toISOString(),
          durationS: 1800,
          city: "Nowhereville",
        });
      expect(res.status).toBe(201);
      expect(res.body.activity.weatherTempC).toBeNull();
      expect(res.body.activity.weatherCondition).toBeNull();
    } finally {
      globalThis.fetch = realFetch;
      vi.unstubAllGlobals();
    }
  });
});
