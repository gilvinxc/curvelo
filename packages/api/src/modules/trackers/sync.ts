/**
 * COROS workout sync: poll querySportRecords for new activities, download
 * each FIT file, and import through the same pipeline as manual FIT uploads.
 * Idempotent per COROS activity id (source + externalId unique).
 */
import { db } from "../../db.js";
import { parseWorkoutFile } from "../imports/parse.js";
import { createActivity } from "../activities/service.js";
import { createActivitySchema } from "@curvelo/shared";
import {
  downloadActivityFit,
  getValidAccessToken,
  querySportRecords,
} from "./coros.js";

const PROVIDER = "COROS";

export interface CorosSyncResult {
  checked: number;
  imported: number;
  skipped: number;
  errors: string[];
}

export async function syncCorosForUser(userId: string): Promise<CorosSyncResult> {
  const result: CorosSyncResult = { checked: 0, imported: 0, skipped: 0, errors: [] };
  const conn = await db.trackerConnection.findUnique({
    where: { userId_provider: { userId, provider: PROVIDER } },
  });
  if (!conn) throw new Error("COROS not connected");

  const accessToken = await getValidAccessToken(userId);
  const since = conn.lastSyncAt ?? new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const now = new Date();

  let records;
  try {
    records = await querySportRecords(accessToken, since.toISOString(), now.toISOString());
  } catch (err) {
    throw new Error(`COROS query failed: ${(err as Error).message}`);
  }
  result.checked = records.length;

  for (const rec of records) {
    const externalId = `coros:${rec.id}`;
    try {
      const existing = await db.activity.findUnique({
        where: { source_externalId: { source: PROVIDER, externalId } },
      });
      if (existing) {
        result.skipped++;
        continue;
      }
      const fit = await downloadActivityFit(accessToken, rec.id);
      if (!fit) {
        result.errors.push(`Activity ${rec.id}: no FIT file available`);
        continue;
      }
      const parsed = await parseWorkoutFile(`coros-${rec.id}.fit`, fit);
      const validated = createActivitySchema.parse({
        kind: parsed.kind,
        startedAt: parsed.startedAt.toISOString(),
        distanceM: parsed.distanceM ?? undefined,
        durationS: parsed.durationS ?? undefined,
        avgHrBpm: parsed.avgHrBpm ?? undefined,
        maxHrBpm: parsed.maxHrBpm ?? undefined,
        calories: parsed.calories ?? undefined,
        steps: parsed.steps ?? undefined,
        elevationGainM: parsed.elevationGainM ?? undefined,
        visibility: "TEAM",
        notes: "Synced from COROS",
      });
      await createActivity(userId, validated, undefined, {
        source: "COROS",
        externalId,
      });
      result.imported++;
    } catch (err) {
      result.errors.push(`Activity ${rec.id}: ${(err as Error).message}`.slice(0, 200));
    }
  }

  await db.trackerConnection.update({
    where: { id: conn.id },
    data: { lastSyncAt: now },
  });
  return result;
}
