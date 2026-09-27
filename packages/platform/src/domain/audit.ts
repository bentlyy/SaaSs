import { desc, eq } from 'drizzle-orm';
import { getCoreDb } from '../db/index.js';
import { schema } from '../db/schema.js';

export type AuditEntry = typeof schema.auditLog.$inferSelect;

export interface AuditInput {
  actorUserId?: string | null;
  organizationId?: string | null;
  action: string;
  target?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
}

/**
 * Auditoría de plataforma. Deliberadamente escueta: acción, quién, sobre qué.
 * Sin datos de negocio y sin secretos. Si algún día guardara un password_hash
 * o un token, sería un incidente.
 */
export function recordAudit(input: AuditInput): void {
  getCoreDb()
    .db.insert(schema.auditLog)
    .values({
      actor_user_id: input.actorUserId ?? null,
      organization_id: input.organizationId ?? null,
      action: input.action,
      target: input.target ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      ip: input.ip ?? null,
      created_at: new Date().toISOString(),
    })
    .run();
}

export function listAudit(options: { organizationId?: string; userId?: string; limit?: number } = {}): AuditEntry[] {
  const { db } = getCoreDb();
  const limit = Math.min(options.limit ?? 100, 500);
  if (options.organizationId) {
    return db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.organization_id, options.organizationId))
      .orderBy(desc(schema.auditLog.created_at))
      .limit(limit)
      .all();
  }
  if (options.userId) {
    return db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.actor_user_id, options.userId))
      .orderBy(desc(schema.auditLog.created_at))
      .limit(limit)
      .all();
  }
  return db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.created_at)).limit(limit).all();
}
