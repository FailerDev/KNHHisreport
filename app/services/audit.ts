import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import AuditLog from '#models/audit_log'
import User from '#models/user'

export interface AuditEntry {
  action: string // e.g. 'user.create', 'report.update'
  entity: string // e.g. 'user', 'report', 'his_settings', 'dashboard_item'
  entityId?: number | null
  summary?: string | null
  meta?: Record<string, any> | null
}

/**
 * Write one row to `audit_logs`. Failures are logged but never thrown — the
 * caller already did the work and we don't want to fail a successful CRUD
 * just because the audit table is missing or unreachable.
 */
export async function writeAudit(ctx: HttpContext, entry: AuditEntry): Promise<void> {
  const user = ctx.auth?.user as User | undefined
  try {
    await AuditLog.create({
      userId: user?.id ?? null,
      username: user?.username ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      summary: entry.summary ?? null,
      meta: entry.meta ?? null,
      ip: ctx.request.ip(),
      userAgent: (ctx.request.header('user-agent') ?? '').slice(0, 255),
    })
  } catch (err: any) {
    logger.warn(
      { err: err?.message ?? String(err), action: entry.action, entity: entry.entity },
      'audit log write failed'
    )
  }
}
