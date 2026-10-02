import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export type Units = "metric" | "imperial";

export const M_PER_KM = 1000;
export const M_PER_MI = 1609.344;

/**
 * The signed-in user's distance units (defaults to imperial).
 * Shares the cached ["profile"] query, so changing units in Settings
 * re-renders every distance/pace display with no extra requests.
 */
export function useUnits(): Units {
  const { data } = useQuery({
    queryKey: ["profile"],
    queryFn: () => api.getProfile(),
    staleTime: 5 * 60 * 1000,
  });
  return data?.user.profile?.units === "metric" ? "metric" : "imperial";
}

export function distanceUnitLabel(units: Units): "km" | "mi" {
  return units === "metric" ? "km" : "mi";
}

/** Meters → the user's unit (km or mi), for input fields. */
export function fromMeters(meters: number, units: Units): number {
  return meters / (units === "metric" ? M_PER_KM : M_PER_MI);
}

/** The user's unit (km or mi) → meters, for API payloads. */
export function toMeters(value: number, units: Units): number {
  return value * (units === "metric" ? M_PER_KM : M_PER_MI);
}

/** 800 → "800m", 1500 → "1.5km" (metric) or "0.93 mi" (imperial). */
export function formatDistance(meters: number, units: Units): string {
  if (units === "metric") {
    if (meters >= 1000) {
      const km = meters / M_PER_KM;
      return `${Number.isInteger(km) ? km.toFixed(0) : trimDec(km, 1)}km`;
    }
    return `${Math.round(meters)}m`;
  }
  const mi = meters / M_PER_MI;
  if (mi >= 0.1) return `${trimDec(mi, 2)} mi`;
  const ft = meters * 3.28084;
  return `${Math.round(ft)} ft`;
}

/** Pace stored as sec/km → "3:20/km" or "5:12/mi". */
export function formatPace(paceSecPerKm: number, units: Units): string {
  const perUnit = units === "metric" ? paceSecPerKm : paceSecPerKm * (M_PER_MI / M_PER_KM);
  const total = Math.round(perUnit);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}/${distanceUnitLabel(units)}`;
}

/** Parse a "m:ss" pace in the user's unit → sec/km for the API. */
export function parsePaceToSecPerKm(raw: string, units: Units): number | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const parts = t.split(":");
  let secPerUnit: number;
  if (parts.length === 2) {
    const m = Number(parts[0]);
    const s = Number(parts[1]);
    if (!Number.isFinite(m) || !Number.isFinite(s) || m < 0 || s < 0 || s >= 60) return undefined;
    secPerUnit = m * 60 + s;
  } else if (parts.length === 1) {
    // Decimal minutes, e.g. "5.5" → 5:30.
    const m = Number(parts[0]);
    if (!Number.isFinite(m) || m <= 0) return undefined;
    secPerUnit = m * 60;
  } else {
    return undefined;
  }
  if (secPerUnit <= 0) return undefined;
  return units === "metric" ? secPerUnit : secPerUnit / (M_PER_MI / M_PER_KM);
}

/** sec/km → "m:ss" in the user's unit, for pace inputs. */
export function formatPaceInput(paceSecPerKm: number, units: Units): string {
  return formatPace(paceSecPerKm, units).replace(`/${distanceUnitLabel(units)}`, "");
}

function trimDec(n: number, decimals: number): string {
  return String(parseFloat(n.toFixed(decimals)));
}
