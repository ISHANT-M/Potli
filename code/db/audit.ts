/** Append-only audit trail for admin actions, handoffs, partner status changes and cancellations. */
import type { Database } from './client.ts';
import { auditLog, type Role } from './schema.ts';

export interface AuditInput {
  actorId: string | null;
  actorRole: Role | null;
  /** Dotted verb such as `partner.approve` or `otp.locked`. */
  action: string;
  entity: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

export async function audit(db: Database, input: AuditInput): Promise<void> {
  await db.insert(auditLog).values({
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId,
    metadata: input.metadata ?? {},
    ip: input.ip ?? null,
  });
}
