import type { Db } from "@/server/db/client";
import { auditLog } from "@/server/db/schema";
import { redact } from "@/server/lib/logger";

/** Audit trail for sensitive changes (sources, integrations, rules, account). Details are redacted. */
export async function audit(
  db: Db,
  entry: { userId: string | null; action: string; entityType: string; entityId?: string | null; details?: Record<string, unknown> },
): Promise<void> {
  await db.insert(auditLog).values({
    userId: entry.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    details: (redact(entry.details ?? {}) as Record<string, unknown>) ?? {},
  });
}
