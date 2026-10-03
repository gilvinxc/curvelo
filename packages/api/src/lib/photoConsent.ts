import { db } from "../db.js";
import { ageToday } from "./compliance.js";
import { audit } from "./audit.js";
import { AppError } from "./errors.js";

/**
 * Photo consent — the youth-safety gate for sharing photos of minors.
 *
 * Rule: before a photo is published to a team feed, EVERY pictured athlete
 * who is a minor (or whose age is unknown) must have a GRANTED PHOTO_SHARING
 * consent from at least one of their VERIFIED guardians. Adults (18+) never
 * need photo consent.
 *
 * Checks are per-share and never cached: revoking consent blocks future
 * shares immediately. Photos already published stay published (the consent
 * was valid at publish time; coaches can still remove them via moderation).
 */

export const PHOTO_CONSENT_TYPE = "PHOTO_SHARING";

export function isMinorOrUnknown(dateOfBirth: Date | null | undefined): boolean {
  const age = ageToday(dateOfBirth ?? null);
  return age === null || age < 18;
}

/** Does this athlete have a GRANTED photo consent from a verified guardian? */
export async function hasPhotoConsent(athleteId: string): Promise<boolean> {
  const consent = await db.consent.findFirst({
    where: {
      athleteId,
      type: PHOTO_CONSENT_TYPE,
      status: "GRANTED",
      guardian: {
        guardianLinksAsGuardian: {
          some: { athleteId, status: "VERIFIED" },
        },
      },
    },
  });
  return Boolean(consent);
}

export type PhotoConsentCheck = {
  athleteId: string;
  displayName: string;
  isMinor: boolean;
  hasConsent: boolean;
};

/** Consent status for a batch of pictured athletes. */
export async function checkPhotoConsents(
  athleteIds: string[],
): Promise<PhotoConsentCheck[]> {
  if (athleteIds.length === 0) return [];
  const athletes = await db.user.findMany({
    where: { id: { in: athleteIds } },
    select: { id: true, displayName: true, dateOfBirth: true },
  });
  const found = new Map(athletes.map((a) => [a.id, a]));
  const missing = athleteIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new AppError(422, "INVALID_ATHLETE", "One of those athletes doesn't exist.");
  }
  const results: PhotoConsentCheck[] = [];
  for (const a of athletes) {
    const isMinor = isMinorOrUnknown(a.dateOfBirth);
    results.push({
      athleteId: a.id,
      displayName: a.displayName,
      isMinor,
      hasConsent: isMinor ? await hasPhotoConsent(a.id) : true,
    });
  }
  return results;
}

/**
 * The per-share gate. Throws 422 naming every pictured minor who lacks
 * photo consent. Optionally grants consent inline first for the actor's own
 * linked athletes (verified guardian only).
 */
export async function assertPhotoConsentForShare(
  actorId: string,
  picturedAthleteIds: string[],
  opts: { grantFor?: string[]; ipAddress?: string } = {},
): Promise<void> {
  const grantFor = new Set(opts.grantFor ?? []);
  for (const athleteId of grantFor) {
    await grantPhotoConsent(actorId, athleteId, opts.ipAddress);
  }
  const checks = await checkPhotoConsents(picturedAthleteIds);
  const lacking = checks.filter((c) => c.isMinor && !c.hasConsent);
  if (lacking.length > 0) {
    const names = lacking.map((c) => c.displayName).join(", ");
    throw new AppError(
      422,
      "PHOTO_CONSENT_MISSING",
      `Can't share: photo consent is missing for ${names}. Ask their guardian to grant photo sharing first.`,
    );
  }
}

/**
 * A verified guardian grants photo-sharing consent for their own linked
 * athlete. Creates or re-grants the PHOTO_SHARING consent record.
 */
export async function grantPhotoConsent(
  guardianId: string,
  athleteId: string,
  ipAddress?: string,
): Promise<void> {
  const link = await db.guardianLink.findUnique({
    where: { guardianId_athleteId: { guardianId, athleteId } },
  });
  if (!link || link.status !== "VERIFIED") {
    throw new AppError(
      403,
      "NOT_GUARDIAN",
      "Only a verified guardian can grant photo consent for this athlete.",
    );
  }
  await db.consent.upsert({
    where: {
      athleteId_guardianId_type: {
        athleteId,
        guardianId,
        type: PHOTO_CONSENT_TYPE,
      },
    },
    create: {
      athleteId,
      guardianId,
      type: PHOTO_CONSENT_TYPE,
      status: "GRANTED",
    },
    update: { status: "GRANTED", grantedAt: new Date(), revokedAt: null },
  });
  await audit({
    actorId: guardianId,
    action: "PHOTO_CONSENT_GRANTED",
    entityType: "Consent",
    entityId: `${athleteId}:${guardianId}:${PHOTO_CONSENT_TYPE}`,
    metadata: { athleteId },
    ipAddress,
  });
}

/** A verified guardian revokes photo-sharing consent. Blocks future shares. */
export async function revokePhotoConsent(
  guardianId: string,
  athleteId: string,
  ipAddress?: string,
): Promise<void> {
  const link = await db.guardianLink.findUnique({
    where: { guardianId_athleteId: { guardianId, athleteId } },
  });
  if (!link || link.status !== "VERIFIED") {
    throw new AppError(
      403,
      "NOT_GUARDIAN",
      "Only a verified guardian can change photo consent for this athlete.",
    );
  }
  await db.consent.updateMany({
    where: { athleteId, guardianId, type: PHOTO_CONSENT_TYPE, status: "GRANTED" },
    data: { status: "REVOKED", revokedAt: new Date() },
  });
  await audit({
    actorId: guardianId,
    action: "PHOTO_CONSENT_REVOKED",
    entityType: "Consent",
    entityId: `${athleteId}:${guardianId}:${PHOTO_CONSENT_TYPE}`,
    metadata: { athleteId },
    ipAddress,
  });
}
