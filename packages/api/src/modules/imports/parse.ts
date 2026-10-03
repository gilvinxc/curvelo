import { XMLParser } from "fast-xml-parser";
import FitParser from "fit-file-parser";

export type ImportFormat = "FIT" | "GPX" | "TCX";

export interface ParsedSplit {
  distanceM: number | null;
  durationS: number | null;
}

export interface ParsedWorkout {
  format: ImportFormat;
  kind: string; // ActivityKind
  startedAt: Date;
  distanceM: number | null;
  durationS: number | null;
  avgHrBpm: number | null;
  maxHrBpm: number | null;
  calories: number | null;
  steps: number | null;
  elevationGainM: number | null;
  avgCadenceSpm: number | null;
  splits: ParsedSplit[];
  /** Simplified [lat, lon] track, max 500 points, or null when no GPS. */
  route: Array<[number, number]> | null;
}

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export function detectFormat(fileName: string, buf: Buffer): ImportFormat {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "fit" || ext === "gpx" || ext === "tcx") {
    return ext.toUpperCase() as ImportFormat;
  }
  // Fall back to content sniffing.
  const head = buf.subarray(0, 200).toString("latin1");
  if (head.includes(".FIT")) return "FIT";
  if (head.includes("<TrainingCenterDatabase")) return "TCX";
  if (head.includes("<gpx")) return "GPX";
  throw new Error("Unsupported file type. Upload a .fit, .gpx, or .tcx file.");
}

function mapSport(sport: string | undefined | null): string {
  const s = (sport ?? "").toLowerCase().replace(/[\s_]+/g, "");
  if (["running", "trailrunning", "treadmill"].includes(s)) return "RUN";
  if (["walking", "hiking", "casualwalking", "speedwalking"].includes(s)) return "WALK";
  if (["cycling", "mountainbiking", "cyclocross", "downhillskiing", "snowboarding", "skiing", "swimming", "openwaterswimming", "rowing", "paddling", "kayaking", "standuppaddleboarding", "elliptical", "stairclimbing"].includes(s))
    return "CROSS_TRAINING";
  if (["strengthtraining", "fitnessequipment", "yoga", "pilates"].includes(s)) return "STRENGTH";
  return "OTHER";
}

/** Average of per-point cadence values (steps/min), rounded. */
function avgCadenceSpm(cads: (number | null)[]): number | null {
  const vals = cads.filter((c): c is number => c !== null && Number.isFinite(c) && c > 0 && c <= 300);
  if (vals.length === 0) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/** Simplify a [lat, lon] track to at most `max` points (Douglas-Peucker). */
export function simplifyRoute(
  points: Array<[number, number]>,
  max = 500,
): Array<[number, number]> | null {
  const valid = points.filter(
    ([lat, lon]) =>
      Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180,
  );
  if (valid.length < 2) return null;
  let eps = 1e-7; // ~1cm in degrees; grows until we fit
  let simplified = valid;
  for (let i = 0; i < 24 && simplified.length > max; i++) {
    simplified = douglasPeucker(valid, eps);
    eps *= 2;
  }
  return simplified.length >= 2 ? simplified : null;
}

function perpDist(p: [number, number], a: [number, number], b: [number, number]): number {
  // Equirectangular-ish perpendicular distance in degrees; fine for simplification.
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function douglasPeucker(points: Array<[number, number]>, eps: number): Array<[number, number]> {
  if (points.length <= 2) return points;
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpDist(points[i], points[first], points[last]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (index !== -1 && maxDist > eps) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Total ascent: sum of positive elevation diffs between consecutive points. */
function elevationGainM(eles: (number | null)[]): number | null {
  let gain = 0;
  let prev: number | null = null;
  let seen = 0;
  for (const e of eles) {
    if (e === null || !Number.isFinite(e)) continue;
    seen++;
    if (prev !== null && e > prev) gain += e - prev;
    prev = e;
  }
  return seen >= 2 ? Math.round(gain * 10) / 10 : null;
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: true,
});

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function parseGpx(buf: Buffer): ParsedWorkout {
  const doc = xmlParser.parse(buf.toString("utf-8"));
  const trks = asArray(doc?.gpx?.trk);
  if (trks.length === 0) throw new Error("No tracks found in GPX file.");

  let distanceM = 0;
  let start: Date | null = null;
  let end: Date | null = null;
  let prev: { lat: number; lon: number } | null = null;
  const eles: (number | null)[] = [];

  const cads: (number | null)[] = [];
  const track: Array<[number, number]> = [];
  for (const trk of trks) {
    for (const seg of asArray(trk?.trkseg)) {
      for (const pt of asArray(seg?.trkpt)) {
        const lat = parseFloat(pt["@lat"]);
        const lon = parseFloat(pt["@lon"]);
        const t = pt?.time ? new Date(pt.time) : null;
        eles.push(num(pt?.ele));
        cads.push(gpxCadence(pt));
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          if (prev) distanceM += haversineM(prev.lat, prev.lon, lat, lon);
          prev = { lat, lon };
          track.push([lat, lon]);
        }
        if (t && !Number.isNaN(t.getTime())) {
          if (!start || t < start) start = t;
          if (!end || t > end) end = t;
        }
      }
    }
  }
  if (!start) throw new Error("GPX file has no timestamps.");
  const durationS = end && end > start ? Math.round((end.getTime() - start.getTime()) / 1000) : null;
  return {
    format: "GPX",
    kind: mapSport(trks[0]?.type),
    startedAt: start,
    distanceM: distanceM > 0 ? Math.round(distanceM) : null,
    durationS,
    avgHrBpm: null,
    maxHrBpm: null,
    calories: null,
    steps: null,
    elevationGainM: elevationGainM(eles),
    avgCadenceSpm: avgCadenceSpm(cads),
    splits: [],
    route: simplifyRoute(track),
  };
}

/** Cadence from GPX trackpoint extensions (gpxtpx:cad et al). */
function gpxCadence(pt: Record<string, unknown>): number | null {
  const ext = pt?.extensions as Record<string, unknown> | undefined;
  if (!ext || typeof ext !== "object") return null;
  for (const key of Object.keys(ext)) {
    const tpe = (ext as Record<string, unknown>)[key] as Record<string, unknown>;
    if (!tpe || typeof tpe !== "object") continue;
    for (const ck of Object.keys(tpe)) {
      if (ck.toLowerCase().endsWith("cad")) {
        const c = num(tpe[ck]);
        if (c !== null && c > 0 && c <= 300) return c;
      }
    }
  }
  return null;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
}

function hr(v: unknown): number | null {
  // TCX wraps HR as { Value: 145 }.
  const raw = v != null && typeof v === "object" ? (v as { Value?: unknown }).Value : v;
  const n = num(raw);
  return n !== null && n > 0 && n < 300 ? Math.round(n) : null;
}

function parseTcx(buf: Buffer): ParsedWorkout {
  const doc = xmlParser.parse(buf.toString("utf-8"));
  const activities = asArray(doc?.TrainingCenterDatabase?.Activities?.Activity);
  if (activities.length === 0) throw new Error("No activities found in TCX file.");
  const act = activities[0];

  const laps = asArray(act?.Lap);
  let distanceM = 0;
  let durationS = 0;
  let calories: number | null = null;
  let avgHr: number | null = null;
  let maxHr: number | null = null;
  let start: Date | null = act?.Id ? new Date(act.Id) : null;
  if (start && Number.isNaN(start.getTime())) start = null;
  const eles: (number | null)[] = [];
  const cads: (number | null)[] = [];
  const splits: ParsedSplit[] = [];
  const track: Array<[number, number]> = [];

  for (const lap of laps) {
    const d = num(lap?.DistanceMeters);
    const t = num(lap?.TotalTimeSeconds);
    if (d) distanceM += d;
    if (t) durationS += t;
    if ((d && d > 0) || (t && t > 0)) {
      splits.push({
        distanceM: d && d > 0 ? Math.round(d) : null,
        durationS: t && t > 0 ? Math.round(t) : null,
      });
    }
    const c = num(lap?.Calories);
    if (c) calories = (calories ?? 0) + c;
    const a = hr(lap?.AverageHeartRateBpm);
    const m = hr(lap?.MaximumHeartRateBpm);
    if (a && (!avgHr || a > 0)) avgHr = avgHr ? Math.round((avgHr + a) / 2) : a;
    if (m && (!maxHr || m > maxHr)) maxHr = m;
    const ls = lap?.["@StartTime"] ? new Date(lap["@StartTime"]) : null;
    if (ls && !Number.isNaN(ls.getTime()) && (!start || ls < start)) start = ls;
    for (const track of asArray(lap?.Track)) {
      for (const tp of asArray(track?.Trackpoint)) {
        eles.push(num(tp?.AltitudeMeters));
        const c = num(tp?.Cadence);
        cads.push(c !== null && c > 0 && c <= 300 ? Math.round(c) : null);
        const lat = num(tp?.LatitudeDegrees);
        const lon = num(tp?.LongitudeDegrees);
        if (lat !== null && lon !== null) track.push([lat, lon]);
      }
    }
  }
  if (!start) throw new Error("TCX file has no start time.");

  return {
    format: "TCX",
    kind: mapSport(act?.["@Sport"]),
    startedAt: start,
    distanceM: distanceM > 0 ? Math.round(distanceM) : null,
    durationS: durationS > 0 ? Math.round(durationS) : null,
    avgHrBpm: avgHr,
    maxHrBpm: maxHr,
    calories: calories ? Math.round(calories) : null,
    steps: null,
    elevationGainM: elevationGainM(eles),
    avgCadenceSpm: avgCadenceSpm(cads),
    splits,
    route: simplifyRoute(track),
  };
}

interface FitLap {
  total_distance?: unknown;
  total_timer_time?: unknown;
  total_elapsed_time?: unknown;
}

interface FitRecord {
  position_lat?: unknown;
  position_long?: unknown;
}

/** FIT stores coordinates in semicircles; 2^31 semicircles = 180 degrees. */
function semicircleToDeg(v: unknown): number | null {
  const n = num(v);
  if (n === null || n === 0) return null;
  const deg = (n * 180) / 2147483648;
  return Math.abs(deg) <= 180 ? deg : null;
}

interface FitSession {
  sport?: unknown;
  start_time?: unknown;
  total_elapsed_time?: unknown;
  total_timer_time?: unknown;
  total_distance?: unknown;
  total_cycles?: unknown;
  avg_heart_rate?: unknown;
  max_heart_rate?: unknown;
  total_calories?: unknown;
  total_ascent?: unknown;
  avg_cadence?: unknown;
}

function parseFit(buf: Buffer): Promise<ParsedWorkout> {
  return new Promise((resolve, reject) => {
    const parser = new FitParser({ force: true, speedUnit: "m/s", lengthUnit: "m" });
    // fit-file-parser's bundled types predate generic Buffers; at runtime it
    // accepts a Node Buffer as it always has.
    const input = buf as unknown as ArrayBuffer;
    parser.parse(input, (error: unknown, data: { sessions?: FitSession | FitSession[]; laps?: FitLap[]; records?: FitRecord[] } | undefined) => {
      if (error) return reject(new Error("Could not parse FIT file."));
      try {
        const raw = data?.sessions;
        const sessions: FitSession[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
        const s = sessions[0];
        if (!s) throw new Error("No sessions found in FIT file.");
        const startRaw = s.start_time as Date | string | undefined;
        const start = startRaw ? new Date(startRaw) : null;
        if (!start || Number.isNaN(start.getTime())) {
          throw new Error("FIT file has no start time.");
        }
        const track: Array<[number, number]> = [];
        try {
          for (const r of data?.records ?? []) {
            const lat = semicircleToDeg(r.position_lat);
            const lon = semicircleToDeg(r.position_long);
            if (lat !== null && lon !== null) track.push([lat, lon]);
          }
        } catch {
          // GPS extraction must never fail the import.
        }
        resolve({
          format: "FIT",
          kind: mapSport(s.sport as string | undefined),
          startedAt: start,
          distanceM: num(s.total_distance) ? Math.round(num(s.total_distance)!) : null,
          durationS: num(s.total_elapsed_time)
            ? Math.round(num(s.total_elapsed_time)!)
            : num(s.total_timer_time)
              ? Math.round(num(s.total_timer_time)!)
              : null,
          avgHrBpm: hr(s.avg_heart_rate),
          maxHrBpm: hr(s.max_heart_rate),
          calories: num(s.total_calories) ? Math.round(num(s.total_calories)!) : null,
          // FIT counts strides (cycles) for running; steps ≈ 2 per stride.
          steps: num(s.total_cycles) ? Math.round(num(s.total_cycles)!) * 2 : null,
          elevationGainM:
            num(s.total_ascent) && num(s.total_ascent)! > 0
              ? Math.round(num(s.total_ascent)! * 10) / 10
              : null,
          // FIT running cadence is strides/min; spm ≈ 2 per stride.
          avgCadenceSpm:
            num(s.avg_cadence) && num(s.avg_cadence)! > 0 && num(s.avg_cadence)! <= 150
              ? Math.round(num(s.avg_cadence)!) * 2
              : null,
          splits: (data?.laps ?? [])
            .map((lap) => {
              const d = num(lap.total_distance);
              const t = num(lap.total_timer_time) ?? num(lap.total_elapsed_time);
              return {
                distanceM: d && d > 0 ? Math.round(d) : null,
                durationS: t && t > 0 ? Math.round(t) : null,
              };
            })
            .filter((sp) => sp.distanceM !== null || sp.durationS !== null),
          route: simplifyRoute(track),
        });
      } catch (e) {
        reject(e instanceof Error ? e : new Error("Could not parse FIT file."));
      }
    });
  });
}

export async function parseWorkoutFile(
  fileName: string,
  buf: Buffer,
): Promise<ParsedWorkout> {
  if (buf.length === 0) throw new Error("Empty file.");
  if (buf.length > MAX_IMPORT_BYTES) {
    throw new Error("File is too large (10 MB max).");
  }
  const format = detectFormat(fileName, buf);
  const parsed =
    format === "FIT"
      ? await parseFit(buf)
      : format === "TCX"
        ? parseTcx(buf)
        : parseGpx(buf);
  if (!parsed.distanceM && !parsed.durationS) {
    throw new Error("File has no distance or duration data.");
  }
  return parsed;
}
