import { db } from "../db.js";

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

/**
 * Append-only audit log. Failures are logged to stderr but never fail the
 * request — auditing must not break the happy path.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        metadata: entry.metadata ?? undefined,
        ipAddress: entry.ipAddress,
      },
    });
  } catch (err) {
    console.error("[audit] failed to write audit log", err);
  }
}
