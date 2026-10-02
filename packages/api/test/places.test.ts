import { describe, expect, it } from "vitest";
import { toPlace } from "../src/lib/places.js";

describe("toPlace", () => {
  it("builds a canonical City, State, Country label", () => {
    const p = toPlace({
      name: "Winchester",
      latitude: 37.99,
      longitude: -84.18,
      admin1: "Kentucky",
      country: "United States",
    });
    expect(p?.label).toBe("Winchester, Kentucky, United States");
    expect(p?.state).toBe("Kentucky");
    expect(p?.lat).toBeCloseTo(37.99);
  });

  it("omits missing state/country parts", () => {
    const p = toPlace({ name: "Paris", latitude: 48.85, longitude: 2.35 });
    expect(p?.label).toBe("Paris");
  });

  it("rejects results without coordinates", () => {
    expect(toPlace({ name: "Nowhere" })).toBeNull();
  });
});
