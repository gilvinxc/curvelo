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

/**
 * Parse a duration typed as "h:mm:ss", "m:ss", "m:ss.ss" (fractional seconds),
 * or plain minutes ("45" / "45.5", kept for backward compatibility).
 * Returns whole seconds. undefined = blank, NaN = invalid.
 */
export function parseDurationInput(raw: string): number | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  if (!t.includes(":")) {
    const m = Number(t);
    return Number.isFinite(m) && m > 0 ? Math.round(m * 60) : NaN;
  }
  const parts = t.split(":");
  if (parts.length > 3 || parts.some((p) => p.trim() === "")) return NaN;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return NaN;
  const secs = nums[nums.length - 1];
  const mins = nums.length >= 2 ? nums[nums.length - 2] : 0;
  const hrs = nums.length >= 3 ? nums[nums.length - 3] : 0;
  if (!Number.isInteger(mins) || !Number.isInteger(hrs)) return NaN;
  const total = hrs * 3600 + mins * 60 + secs;
  return total > 0 ? Math.round(total) : NaN;
}

function trimDec(n: number, decimals: number): string {
  return String(parseFloat(n.toFixed(decimals)));
}

export const CM_PER_IN = 2.54;
export const KG_PER_LB = 0.45359237;

/** cm → the user's unit value (cm, or total inches for imperial). */
export function fromCm(cm: number, units: Units): number {
  return units === "metric" ? cm : cm / CM_PER_IN;
}

/** User's unit value → cm. Imperial input is total inches. */
export function toCm(value: number, units: Units): number {
  return units === "metric" ? value : value * CM_PER_IN;
}

/** Pretty height: 5'10" imperial, 178 cm metric. */
export function formatHeight(cm: number, units: Units): string {
  if (units === "metric") return `${Math.round(cm)} cm`;
  const totalIn = Math.round(cm / CM_PER_IN);
  return `${Math.floor(totalIn / 12)}'${totalIn % 12}"`;
}

/** Parse imperial height input: accepts 70, 5'10", 5'10, 5 ft 10 in. */
export function parseHeightInput(raw: string, units: Units): number | undefined {
  // Normalize curly quotes (iOS smart punctuation) to straight quotes.
  const t = raw.trim().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  if (!t) return undefined;
  if (units === "metric") {
    const v = Number(t);
    return Number.isFinite(v) && v > 0 ? v : undefined;
  }
  const m = t.match(/^(?:(\d+)\s*(?:'|ft))?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/);
  if (!m || (m[1] === undefined && m[2] === undefined)) return undefined;
  const feet = m[1] ? Number(m[1]) : 0;
  const inches = m[2] ? Number(m[2]) : 0;
  const total = feet * 12 + inches;
  return total > 0 ? total : undefined;
}

/** kg → the user's unit value (kg or lb), for input fields. */
export function fromKg(kg: number, units: Units): number {
  return units === "metric" ? kg : kg / KG_PER_LB;
}

/** User's unit value → kg. */
export function toKg(value: number, units: Units): number {
  return units === "metric" ? value : value * KG_PER_LB;
}

export function weightUnitLabel(units: Units): "kg" | "lb" {
  return units === "metric" ? "kg" : "lb";
}

/** Pretty weight: 154 lb imperial, 70 kg metric. */
export function formatWeight(kg: number, units: Units): string {
  const v = fromKg(kg, units);
  return `${Math.round(v)} ${weightUnitLabel(units)}`;
}

/** Celsius → the user's unit value (°C or °F), for input fields. */
export function fromTemp(celsius: number, units: Units): number {
  return units === "metric" ? celsius : (celsius * 9) / 5 + 32;
}

/** User's unit value → Celsius. */
export function toTemp(value: number, units: Units): number {
  return units === "metric" ? value : ((value - 32) * 5) / 9;
}

export function tempUnitLabel(units: Units): "°C" | "°F" {
  return units === "metric" ? "°C" : "°F";
}

export const M_PER_FT = 0.3048;

/** Meters → the user's elevation unit (m or ft), for input fields. */
export function fromMetersElev(meters: number, units: Units): number {
  return units === "metric" ? meters : meters / M_PER_FT;
}

/** The user's elevation unit (m or ft) → meters, for API payloads. */
export function toMetersElev(value: number, units: Units): number {
  return units === "metric" ? value : value * M_PER_FT;
}

export function elevationUnitLabel(units: Units): "m" | "ft" {
  return units === "metric" ? "m" : "ft";
}

/** Pretty elevation gain: 150 ft imperial, 46 m metric. */
export function formatElevation(meters: number, units: Units): string {
  const v = fromMetersElev(meters, units);
  return `${Math.round(v)} ${elevationUnitLabel(units)}`;
}
