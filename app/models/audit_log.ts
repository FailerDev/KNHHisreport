import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

/**
 * Write-only audit log entry. Created by `writeAudit()` helper from
 * controllers after a successful mutation. Never updated, never deleted
 * (use a DB job to archive after retention period).
 */
export default class AuditLog extends BaseModel {
  public static table = 'audit_logs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number | null

  @column()
  declare username: string | null

  @column()
  declare action: string

  @column()
  declare entity: string

  @column()
  declare entityId: number | null

  @column()
  declare summary: string | null

  @column({
    prepare: (value) => (value === null || value === undefined ? null : JSON.stringify(value)),
    consume: (value) => {
      if (value === null || value === undefined) return null
      if (typeof value === 'object') return value
      try { return JSON.parse(value) } catch { return null }
    },
  })
  declare meta: Record<string, any> | null

  @column()
  declare ip: string | null

  @column()
  declare userAgent: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
