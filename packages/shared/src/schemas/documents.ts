import { z } from "zod";

export const documentKinds = [
  "PHYSICAL",
  "CONCUSSION",
  "WAIVER",
  "BIRTH_CERTIFICATE",
  "CERTIFICATION",
  "BACKGROUND_CHECK",
  "TEAM_DOC",
  "OTHER",
] as const;
export type DocumentKind = (typeof documentKinds)[number];

export const documentVisibilities = ["TEAM", "COACH_ONLY"] as const;

// Athlete paperwork kinds: one document per athlete per kind counts
// toward the checklist (newest current version wins).
export const athleteDocKinds = [
  "PHYSICAL",
  "CONCUSSION",
  "WAIVER",
  "BIRTH_CERTIFICATE",
  "OTHER",
] as const;

// Which kinds a coach may require on the team checklist.
export const requirableKinds = [
  "PHYSICAL",
  "CONCUSSION",
  "WAIVER",
  "BIRTH_CERTIFICATE",
] as const;

export const documentRequirementSchema = z.object({
  kind: z.enum(requirableKinds),
  label: z.string().min(1).max(80),
  validDays: z.number().int().min(1).max(3650).optional(),
  required: z.boolean().default(true),
});
export type DocumentRequirementInput = z.infer<typeof documentRequirementSchema>;

export const documentParamsSchema = z.object({
  documentId: z.string().uuid(),
});

export const requirementParamsSchema = z.object({
  requirementId: z.string().uuid(),
});

export const documentAthleteParamsSchema = z.object({
  userId: z.string().uuid(),
});

// Multipart upload fields (file itself rides as "file").
export const documentUploadSchema = z.object({
  teamId: z.string().uuid(),
  // Athlete the doc belongs to; omitted = the uploader themselves.
  // Coaches uploading team docs omit ownerId and set kind=TEAM_DOC.
  ownerId: z.string().uuid().optional(),
  kind: z.enum(documentKinds),
  label: z.string().min(1).max(80),
  requirementId: z.string().uuid().optional(),
  issuedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  visibility: z.enum(documentVisibilities).default("TEAM"),
  // Background checks: pass/fail only — never the full report.
  checkResult: z.enum(["PASS", "FAIL"]).optional(),
  checkProvider: z.string().max(80).optional(),
});
export type DocumentUploadInput = z.infer<typeof documentUploadSchema>;

export const documentSignSchema = z.object({
  signedByName: z.string().min(1).max(120),
  // Explicit intent to sign (ESIGN/UETA): a real checkbox, not Continue.
  intentConfirmed: z.literal(true),
});
export type DocumentSignInput = z.infer<typeof documentSignSchema>;

export const backgroundCheckSchema = z.object({
  checkResult: z.enum(["PASS", "FAIL"]),
  checkProvider: z.string().min(1).max(80),
  checkedAt: z.string().datetime().optional(),
});
export type BackgroundCheckInput = z.infer<typeof backgroundCheckSchema>;

export const documentDeleteSchema = z.object({
  reason: z.string().min(1).max(280),
});
