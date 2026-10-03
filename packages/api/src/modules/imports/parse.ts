import { XMLParser } from "fast-xml-parser";
import FitParser from "fit-file-parser";

export type ImportFormat = "FIT" | "GPX" | "TCX";

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

  for (const trk of trks) {
    for (const seg of asArray(trk?.trkseg)) {
      for (const pt of asArray(seg?.trkpt)) {
        const lat = parseFloat(pt["@lat"]);
        const lon = parseFloat(pt["@lon"]);
        const t = pt?.time ? new Date(pt.time) : null;
        eles.push(num(pt?.ele));
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          if (prev) distanceM += haversineM(prev.lat, prev.lon, lat, lon);
          prev = { lat, lon };
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
  };
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

  for (const lap of laps) {
    const d = num(lap?.DistanceMeters);
    const t = num(lap?.TotalTimeSeconds);
    if (d) distanceM += d;
    if (t) durationS += t;
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
  };
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
}

function parseFit(buf: Buffer): Promise<ParsedWorkout> {
  return new Promise((resolve, reject) => {
    const parser = new FitParser({ force: true, speedUnit: "m/s", lengthUnit: "m" });
    // fit-file-parser's bundled types predate generic Buffers; at runtime it
    // accepts a Node Buffer as it always has.
    const input = buf as unknown as ArrayBuffer;
    parser.parse(input, (error: unknown, data: { sessions?: FitSession | FitSession[] } | undefined) => {
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
