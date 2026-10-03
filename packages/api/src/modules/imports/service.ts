import crypto from "node:crypto";
import type {
  ActivityDTO,
  ImportedActivitySummary,
  ImportPreviewInput,
} from "@curvelo/shared";
import { createActivitySchema } from "@curvelo/shared";
import { db } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { AppError, conflict } from "../../lib/errors.js";
import { createActivity } from "../activities/service.js";
import { parseWorkoutFile, type ParsedWorkout } from "./parse.js";

function idsFor(userId: string, buf: Buffer): { externalId: string; fileHash: string } {
  const fileHash = crypto.createHash("sha256").update(buf).digest("hex");
  // Dedupe is per athlete: the same file uploaded by two people is two imports.
  return { externalId: `${userId}:${fileHash}`, fileHash };
}

function toSummary(
  fileName: string,
  hash: string,
  parsed: ParsedWorkout,
  alreadyImported: boolean,
  title?: string,
): ImportedActivitySummary {
  const date = parsed.startedAt.toISOString().slice(0, 10);
  return {
    fileName,
    fileHash: hash,
    format: parsed.format,
    kind: parsed.kind,
    title: title?.trim() || `${parsed.kind === "RUN" ? "Run" : "Workout"} · ${date}`,
    startedAt: parsed.startedAt.toISOString(),
    distanceM: parsed.distanceM,
    durationS: parsed.durationS,
    avgHrBpm: parsed.avgHrBpm,
    maxHrBpm: parsed.maxHrBpm,
    calories: parsed.calories,
    steps: parsed.steps,
    elevationGainM: parsed.elevationGainM,
    avgCadenceSpm: parsed.avgCadenceSpm,
    splitCount: parsed.splits.length,
    alreadyImported,
  };
}

async function parseOr400(fileName: string, buf: Buffer): Promise<ParsedWorkout> {
  try {
    return await parseWorkoutFile(fileName, buf);
  } catch (err) {
    throw new AppError(400, "IMPORT_PARSE_ERROR", err instanceof Error ? err.message : "Could not parse file");
  }
}

/** Parse-only: show the athlete what we found before importing. */
export async function previewImport(
  userId: string,
  fileName: string,
  buf: Buffer,
  input: ImportPreviewInput,
): Promise<ImportedActivitySummary> {
  const parsed = await parseOr400(fileName, buf);
  const { externalId, fileHash } = idsFor(userId, buf);
  const existing = await db.activity.findUnique({
    where: { source_externalId: { source: "FILE_IMPORT", externalId } },
  });
  return toSummary(fileName, fileHash, parsed, !!existing, input.title);
}

/** Parse + persist as a FILE_IMPORT activity. Idempotent per file contents. */
export async function confirmImport(
  userId: string,
  fileName: string,
  buf: Buffer,
  input: ImportPreviewInput,
  ipAddress?: string,
): Promise<{ activity: ActivityDTO; summary: ImportedActivitySummary }> {
  const parsed = await parseOr400(fileName, buf);
  const { externalId, fileHash } = idsFor(userId, buf);

  const existing = await db.activity.findUnique({
    where: { source_externalId: { source: "FILE_IMPORT", externalId } },
  });
  if (existing) {
    throw conflict("ALREADY_IMPORTED", "This file has already been imported");
  }

  const summary = toSummary(fileName, fileHash, parsed, false, input.title);
  let activity: ActivityDTO;
  // Reuse the full activity validation (future dates, HR sanity, etc.).
  const validated = createActivitySchema.parse({
    kind: parsed.kind,
    title: summary.title,
    startedAt: parsed.startedAt.toISOString(),
    distanceM: parsed.distanceM ?? undefined,
    durationS: parsed.durationS ?? undefined,
    avgHrBpm: parsed.avgHrBpm ?? undefined,
    maxHrBpm: parsed.maxHrBpm ?? undefined,
    calories: parsed.calories ?? undefined,
    steps: parsed.steps ?? undefined,
    elevationGainM: parsed.elevationGainM ?? undefined,
    avgCadenceSpm: parsed.avgCadenceSpm ?? undefined,
    splits: parsed.splits.length > 0 ? parsed.splits : undefined,
    teamId: input.teamId,
    visibility: input.visibility,
    notes: `Imported from ${parsed.format} file ${fileName}`,
    taggedUserIds: input.taggedUserIds,
  });
  try {
    activity = await createActivity(
      userId,
      validated,
      ipAddress,
      { source: "FILE_IMPORT", externalId },
    );
  } catch (err) {
    // Unique-constraint race: another request imported the same file.
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2002") {
      throw conflict("ALREADY_IMPORTED", "This file has already been imported");
    }
    throw err;
  }

  await audit({
    actorId: userId,
    action: "FILE_IMPORTED",
    entityType: "Activity",
    entityId: activity.id,
    metadata: { format: parsed.format, fileName },
    ipAddress,
  });

  return { activity, summary };
}
