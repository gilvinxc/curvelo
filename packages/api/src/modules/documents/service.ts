import {
  activeMembership,
  requireManager,
} from "../../lib/permissions.js";
import { db } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import {
  ALLOWED_MIME,
  MAX_UPLOAD_BYTES,
  newStorageKey,
  sha256hex,
  storage,
} from "../../lib/storage.js";
import type {
  AthleteDocumentStatus,
  DocumentCheckStatus,
  DocumentDTO,
  DocumentRequirementDTO,
  DocumentUploadInput,
} from "@curvelo/shared";

const ATHLETE_KINDS = new Set([
  "PHYSICAL",
  "CONCUSSION",
  "WAIVER",
  "BIRTH_CERTIFICATE",
  "OTHER",
]);

function toDTO(
  d: {
    id: string;
    teamId: string | null;
    ownerId: string | null;
    kind: string;
    label: string;
    requirementId: string | null;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    issuedAt: Date | null;
    expiresAt: Date | null;
    verifiedAt: Date | null;
    signedByName: string | null;
    signedAt: Date | null;
    checkResult: string | null;
    checkProvider: string | null;
    visibility: string;
    version: number;
    createdAt: Date;
    owner: { displayName: string } | null;
    verifiedBy: { displayName: string } | null;
    uploadedBy: { displayName: string };
  },
): DocumentDTO {
  return {
    id: d.id,
    teamId: d.teamId,
    ownerId: d.ownerId,
    ownerName: d.owner?.displayName ?? null,
    kind: d.kind,
    label: d.label,
    requirementId: d.requirementId,
    fileName: d.fileName,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    issuedAt: d.issuedAt?.toISOString() ?? null,
    expiresAt: d.expiresAt?.toISOString() ?? null,
    verifiedAt: d.verifiedAt?.toISOString() ?? null,
    verifiedByName: d.verifiedBy?.displayName ?? null,
    signedByName: d.signedByName,
    signedAt: d.signedAt?.toISOString() ?? null,
    checkResult: d.checkResult,
    checkProvider: d.checkProvider,
    visibility: d.visibility,
    version: d.version,
    uploadedByName: d.uploadedBy.displayName,
    createdAt: d.createdAt.toISOString(),
  };
}

const DOC_INCLUDE = {
  owner: { select: { displayName: true } },
  verifiedBy: { select: { displayName: true } },
  uploadedBy: { select: { displayName: true } },
} as const;

async function isGuardianOf(guardianId: string, athleteId: string): Promise<boolean> {
  const link = await db.guardianLink.findFirst({
    where: { guardianId, athleteId, status: "VERIFIED" },
  });
  return Boolean(link);
}

/** Can actorId view doc? Implements the spec's access matrix. */
export async function canViewDocument(
  actorId: string,
  doc: { teamId: string | null; ownerId: string | null; kind: string; visibility: string },
): Promise<boolean> {
  // Own docs, always.
  if (doc.ownerId && doc.ownerId === actorId) return true;
  // Guardian of the owner.
  if (doc.ownerId && (await isGuardianOf(actorId, doc.ownerId))) return true;
  if (doc.teamId) {
    const m = await activeMembership(actorId, doc.teamId).catch(() => null);
    if (!m) return false;
    if (m.role === "COACH" || m.role === "TEAM_ADMIN") return true;
    // Team docs are visible to all members; athlete paperwork is not.
    if (doc.kind === "TEAM_DOC" && doc.visibility === "TEAM") return true;
  } else if (doc.kind === "CERTIFICATION" || doc.kind === "BACKGROUND_CHECK") {
    // Personal coach credentials live outside a team context.
    return false;
  }
  return false;
}

async function requireCanView(actorId: string, documentId: string) {
  const doc = await db.document.findUnique({
    where: { id: documentId },
    include: DOC_INCLUDE,
  });
  if (!doc) throw notFound("Document not found.");
  if (!(await canViewDocument(actorId, doc))) throw forbidden("Not allowed.");
  return doc;
}

// ─── Requirements (coach-defined checklist) ──────────────────────────────

export async function listRequirements(
  actorId: string,
  teamId: string,
): Promise<DocumentRequirementDTO[]> {
  await activeMembership(actorId, teamId);
  const rows = await db.documentRequirement.findMany({
    where: { teamId },
    orderBy: { label: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    teamId: r.teamId,
    kind: r.kind,
    label: r.label,
    validDays: r.validDays,
    required: r.required,
  }));
}

export async function upsertRequirement(
  actorId: string,
  teamId: string,
  input: { kind: string; label: string; validDays?: number; required: boolean },
  ipAddress?: string,
): Promise<DocumentRequirementDTO> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);
  const row = await db.documentRequirement.upsert({
    where: { teamId_kind: { teamId, kind: input.kind as never } },
    update: {
      label: input.label,
      validDays: input.validDays ?? null,
      required: input.required,
    },
    create: {
      teamId,
      kind: input.kind as never,
      label: input.label,
      validDays: input.validDays ?? null,
      required: input.required,
    },
  });
  await audit({
    actorId,
    action: "DOCUMENT_REQUIREMENT_SET",
    entityType: "Team",
    entityId: teamId,
    metadata: { kind: input.kind, label: input.label },
    ipAddress,
  });
  return {
    id: row.id,
    teamId: row.teamId,
    kind: row.kind,
    label: row.label,
    validDays: row.validDays,
    required: row.required,
  };
}

export async function deleteRequirement(
  actorId: string,
  teamId: string,
  requirementId: string,
  ipAddress?: string,
): Promise<{ ok: true }> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);
  const row = await db.documentRequirement.findFirst({
    where: { id: requirementId, teamId },
  });
  if (!row) throw notFound("Requirement not found.");
  await db.documentRequirement.delete({ where: { id: row.id } });
  await audit({
    actorId,
    action: "DOCUMENT_REQUIREMENT_REMOVED",
    entityType: "Team",
    entityId: teamId,
    metadata: { kind: row.kind },
    ipAddress,
  });
  return { ok: true as const };
}

// ─── Upload ──────────────────────────────────────────────────────────────

export async function uploadDocument(
  actorId: string,
  input: DocumentUploadInput,
  file: { buffer: Buffer; fileName: string; mimeType: string; sizeBytes: number },
  ipAddress?: string,
): Promise<DocumentDTO> {
  const membership = await activeMembership(actorId, input.teamId);
  const isManager = membership.role === "COACH" || membership.role === "TEAM_ADMIN";

  if (!ALLOWED_MIME.has(file.mimeType)) {
    throw badRequest("Only PDF and image uploads are accepted.");
  }
  if (file.sizeBytes > MAX_UPLOAD_BYTES || file.buffer.length > MAX_UPLOAD_BYTES) {
    throw badRequest("Files must be 10 MB or smaller.");
  }

  // Who does this doc belong to?
  let ownerId: string | null = null;
  if (input.kind === "TEAM_DOC") {
    if (!isManager) throw forbidden("Only coaches can upload team documents.");
  } else if (input.kind === "CERTIFICATION" || input.kind === "BACKGROUND_CHECK") {
    // Coach's own credentials.
    ownerId = actorId;
  } else {
    if (!ATHLETE_KINDS.has(input.kind)) throw badRequest("Unknown document kind.");
    ownerId = input.ownerId ?? actorId;
    const isSelf = ownerId === actorId;
    if (!isSelf) {
      if (!isManager && !(await isGuardianOf(actorId, ownerId))) {
        throw forbidden("Only the athlete, their guardian, or a coach can upload.");
      }
      // Target must be on the team.
      const target = await db.teamMembership.findFirst({
        where: { teamId: input.teamId, userId: ownerId, status: "ACTIVE" },
      });
      if (!target) throw badRequest("That athlete is not on this team.");
    }
  }

  if (input.requirementId) {
    const req = await db.documentRequirement.findFirst({
      where: { id: input.requirementId, teamId: input.teamId },
    });
    if (!req) throw badRequest("Unknown requirement.");
  }

  // Expiry: explicit date wins; otherwise derive from the requirement window.
  let expiresAt: Date | null = input.expiresAt ? new Date(input.expiresAt) : null;
  if (!expiresAt && input.requirementId) {
    const req = await db.documentRequirement.findUnique({
      where: { id: input.requirementId },
    });
    const issued = input.issuedAt ? new Date(input.issuedAt) : new Date();
    if (req?.validDays) {
      expiresAt = new Date(issued.getTime() + req.validDays * 86_400_000);
    }
  }

  const key = newStorageKey(input.kind, file.fileName);
  const body =
    input.kind === "BACKGROUND_CHECK" ? Buffer.from("PASS/FAIL record only") : file.buffer;
  await storage().put(key, body, file.mimeType);

  // New version supersedes the athlete's previous doc of the same kind.
  let version = 1;
  if (ownerId && ATHLETE_KINDS.has(input.kind)) {
    const prev = await db.document.findFirst({
      where: {
        teamId: input.teamId,
        ownerId,
        kind: input.kind as never,
        supersededById: null,
      },
      orderBy: { version: "desc" },
    });
    if (prev) {
      version = prev.version + 1;
      const created = await db.document.create({
        data: {
          teamId: input.teamId,
          ownerId,
          kind: input.kind as never,
          label: input.label,
          requirementId: input.requirementId ?? null,
          storageKey: key,
          fileName: file.fileName,
          mimeType: file.mimeType,
          sizeBytes: file.buffer.length,
          checksum: sha256hex(file.buffer),
          issuedAt: input.issuedAt ? new Date(input.issuedAt) : null,
          expiresAt,
          visibility: input.visibility as never,
          checkResult: input.checkResult ?? null,
          checkProvider: input.checkProvider ?? null,
          version,
          uploadedById: actorId,
        },
        include: DOC_INCLUDE,
      });
      await db.document.update({
        where: { id: prev.id },
        data: { supersededById: created.id },
      });
      await audit({
        actorId,
        action: "DOCUMENT_REPLACED",
        entityType: "Document",
        entityId: created.id,
        metadata: { kind: input.kind, previousId: prev.id },
        ipAddress,
      });
      return toDTO(created);
    }
  }

  const created = await db.document.create({
    data: {
      teamId: input.teamId,
      ownerId,
      kind: input.kind as never,
      label: input.label,
      requirementId: input.requirementId ?? null,
      storageKey: key,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.buffer.length,
      checksum: sha256hex(file.buffer),
      issuedAt: input.issuedAt ? new Date(input.issuedAt) : null,
      expiresAt,
      visibility: input.visibility as never,
      checkResult: input.checkResult ?? null,
      checkProvider: input.checkProvider ?? null,
      version,
      uploadedById: actorId,
    },
    include: DOC_INCLUDE,
  });
  await audit({
    actorId,
    action: "DOCUMENT_UPLOADED",
    entityType: "Document",
    entityId: created.id,
    metadata: { kind: input.kind, teamId: input.teamId, ownerId },
    ipAddress,
  });
  return toDTO(created);
}

/** File-less background check: pass/fail + provider only, never the report. */
export async function recordBackgroundCheck(
  actorId: string,
  input: { checkResult: "PASS" | "FAIL"; checkProvider: string; checkedAt?: string },
  ipAddress?: string,
): Promise<DocumentDTO> {
  if (!input.checkProvider.trim()) throw badRequest("A provider is required.");
  const key = newStorageKey("BACKGROUND_CHECK", "record.txt");
  // Placeholder bytes only — the report itself is never stored.
  await storage().put(key, Buffer.from("PASS/FAIL record only"), "text/plain");
  const created = await db.document.create({
    data: {
      teamId: null,
      ownerId: actorId,
      kind: "BACKGROUND_CHECK",
      label: `Background check (${input.checkProvider.trim()})`,
      storageKey: key,
      fileName: "record.txt",
      mimeType: "text/plain",
      sizeBytes: 20,
      checksum: sha256hex(Buffer.from("PASS/FAIL record only")),
      issuedAt: input.checkedAt ? new Date(input.checkedAt) : new Date(),
      expiresAt: new Date(Date.now() + 2 * 365 * 86_400_000), // re-screen every 2 years
      checkResult: input.checkResult,
      checkProvider: input.checkProvider.trim(),
      version: 1,
      uploadedById: actorId,
    },
    include: DOC_INCLUDE,
  });
  await audit({
    actorId,
    action: "DOCUMENT_UPLOADED",
    entityType: "Document",
    entityId: created.id,
    metadata: { kind: "BACKGROUND_CHECK", checkResult: input.checkResult },
    ipAddress,
  });
  return toDTO(created);
}

// ─── Read / download ─────────────────────────────────────────────────────

export async function getDocument(
  actorId: string,
  documentId: string,
  ipAddress?: string,
): Promise<DocumentDTO> {
  const doc = await requireCanView(actorId, documentId);
  await audit({
    actorId,
    action: "DOCUMENT_VIEWED",
    entityType: "Document",
    entityId: doc.id,
    ipAddress,
  });
  return toDTO(doc);
}

export async function downloadDocument(
  actorId: string,
  documentId: string,
  ipAddress?: string,
): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
  const doc = await requireCanView(actorId, documentId);
  const buffer = await storage().get(doc.storageKey);
  await audit({
    actorId,
    action: "DOCUMENT_DOWNLOADED",
    entityType: "Document",
    entityId: doc.id,
    ipAddress,
  });
  return { buffer, fileName: doc.fileName, mimeType: doc.mimeType };
}

export async function listMyDocuments(
  actorId: string,
  teamId: string,
): Promise<DocumentDTO[]> {
  await activeMembership(actorId, teamId);
  const rows = await db.document.findMany({
    where: {
      teamId,
      ownerId: actorId,
      supersededById: null,
      kind: { in: [...ATHLETE_KINDS] as never[] },
    },
    orderBy: { createdAt: "desc" },
    include: DOC_INCLUDE,
  });
  return rows.map(toDTO);
}

export async function listAthleteDocuments(
  actorId: string,
  teamId: string,
  athleteId: string,
): Promise<DocumentDTO[]> {
  const membership = await activeMembership(actorId, teamId);
  const isManager = membership.role === "COACH" || membership.role === "TEAM_ADMIN";
  const isSelf = athleteId === actorId;
  if (!isSelf && !isManager && !(await isGuardianOf(actorId, athleteId))) {
    throw forbidden("Not allowed.");
  }
  const rows = await db.document.findMany({
    where: {
      teamId,
      ownerId: athleteId,
      supersededById: null,
      kind: { in: [...ATHLETE_KINDS] as never[] },
    },
    orderBy: { createdAt: "desc" },
    include: DOC_INCLUDE,
  });
  return rows.map(toDTO);
}

export async function listTeamDocuments(
  actorId: string,
  teamId: string,
): Promise<DocumentDTO[]> {
  const membership = await activeMembership(actorId, teamId);
  const isManager = membership.role === "COACH" || membership.role === "TEAM_ADMIN";
  const rows = await db.document.findMany({
    where: {
      teamId,
      kind: "TEAM_DOC",
      supersededById: null,
      ...(isManager ? {} : { visibility: "TEAM" as never }),
    },
    orderBy: { createdAt: "desc" },
    include: DOC_INCLUDE,
  });
  return rows.map(toDTO);
}

export async function listMyCertifications(actorId: string): Promise<DocumentDTO[]> {
  const rows = await db.document.findMany({
    where: {
      ownerId: actorId,
      kind: { in: ["CERTIFICATION", "BACKGROUND_CHECK"] as never[] },
      supersededById: null,
    },
    orderBy: { createdAt: "desc" },
    include: DOC_INCLUDE,
  });
  return rows.map(toDTO);
}

// ─── Status board ────────────────────────────────────────────────────────

const EXPIRING_SOON_DAYS = 30;

function checkStatus(expiresAt: Date | null): DocumentCheckStatus {
  if (!expiresAt) return "current";
  const now = new Date();
  if (expiresAt < now) return "expired";
  if (expiresAt.getTime() - now.getTime() < EXPIRING_SOON_DAYS * 86_400_000)
    return "expiring";
  return "current";
}

export async function teamDocumentStatus(
  actorId: string,
  teamId: string,
): Promise<AthleteDocumentStatus[]> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);

  const [requirements, athletes] = await Promise.all([
    db.documentRequirement.findMany({
      where: { teamId, required: true },
      orderBy: { label: "asc" },
    }),
    db.teamMembership.findMany({
      where: { teamId, status: "ACTIVE", role: "RUNNER" },
      include: { user: { select: { id: true, displayName: true } } },
      orderBy: { user: { displayName: "asc" } },
    }),
  ]);

  const docs = await db.document.findMany({
    where: {
      teamId,
      ownerId: { in: athletes.map((a) => a.userId) },
      supersededById: null,
      kind: { in: [...ATHLETE_KINDS] as never[] },
    },
  });
  // Newest current version per (owner, kind).
  const byOwnerKind = new Map<string, (typeof docs)[number]>();
  for (const d of docs) {
    const key = `${d.ownerId}:${d.kind}`;
    const cur = byOwnerKind.get(key);
    if (!cur || d.version > cur.version) byOwnerKind.set(key, d);
  }

  return athletes.map((a) => {
    const reqs = requirements.map((r) => {
      const doc = byOwnerKind.get(`${a.userId}:${r.kind}`) ?? null;
      const status: DocumentCheckStatus = doc ? checkStatus(doc.expiresAt) : "missing";
      return {
        requirementId: r.id,
        kind: r.kind,
        label: r.label,
        status,
        documentId: doc?.id ?? null,
        expiresAt: doc?.expiresAt?.toISOString() ?? null,
      };
    });
    return {
      userId: a.userId,
      displayName: a.user.displayName,
      requirements: reqs,
      cleared: reqs.every((r) => r.status === "current"),
    };
  });
}

// ─── Verify / sign / delete ─────────────────────────────────────────────

export async function verifyDocument(
  actorId: string,
  documentId: string,
  ipAddress?: string,
): Promise<DocumentDTO> {
  const doc = await db.document.findUnique({
    where: { id: documentId },
    include: DOC_INCLUDE,
  });
  if (!doc) throw notFound("Document not found.");
  if (!doc.teamId) throw badRequest("Only team documents can be verified.");
  const membership = await activeMembership(actorId, doc.teamId);
  requireManager(membership);
  const updated = await db.document.update({
    where: { id: doc.id },
    data: { verifiedAt: new Date(), verifiedById: actorId },
    include: DOC_INCLUDE,
  });
  await audit({
    actorId,
    action: "DOCUMENT_VERIFIED",
    entityType: "Document",
    entityId: doc.id,
    metadata: { kind: doc.kind },
    ipAddress,
  });
  return toDTO(updated);
}

export async function signDocument(
  actorId: string,
  documentId: string,
  signedByName: string,
  ipAddress?: string,
): Promise<DocumentDTO> {
  const doc = await db.document.findUnique({
    where: { id: documentId },
    include: DOC_INCLUDE,
  });
  if (!doc) throw notFound("Document not found.");
  if (doc.kind !== "WAIVER" && doc.kind !== "CONCUSSION") {
    throw badRequest("Only waivers and concussion acknowledgments can be signed.");
  }
  // The athlete, or their verified guardian, may sign.
  const isOwner = doc.ownerId === actorId;
  if (!isOwner && !(doc.ownerId && (await isGuardianOf(actorId, doc.ownerId)))) {
    throw forbidden("Only the athlete or their guardian can sign.");
  }
  const updated = await db.document.update({
    where: { id: doc.id },
    data: { signedByName, signedAt: new Date(), signIntent: true },
    include: DOC_INCLUDE,
  });
  await audit({
    actorId,
    action: "DOCUMENT_SIGNED",
    entityType: "Document",
    entityId: doc.id,
    metadata: { kind: doc.kind, signedByName },
    ipAddress,
  });
  return toDTO(updated);
}

export async function deleteDocument(
  actorId: string,
  documentId: string,
  reason: string,
  ipAddress?: string,
): Promise<{ ok: true }> {
  const doc = await db.document.findUnique({ where: { id: documentId } });
  if (!doc) throw notFound("Document not found.");
  const isOwner = doc.ownerId === actorId;
  let allowed = isOwner;
  if (!allowed && doc.teamId) {
    const membership = await activeMembership(actorId, doc.teamId).catch(() => null);
    allowed =
      Boolean(membership) &&
      (membership!.role === "COACH" || membership!.role === "TEAM_ADMIN");
  }
  if (!allowed) throw forbidden("Not allowed.");
  // Coaches deleting someone else's doc must state why (spec).
  if (!isOwner && !reason.trim()) throw badRequest("A reason is required.");

  await db.document.delete({ where: { id: doc.id } });
  await storage().delete(doc.storageKey).catch(() => {});
  await audit({
    actorId,
    action: "DOCUMENT_DELETED",
    entityType: "Document",
    entityId: doc.id,
    metadata: { kind: doc.kind, label: doc.label, reason: reason.trim() },
    ipAddress,
  });
  return { ok: true as const };
}
