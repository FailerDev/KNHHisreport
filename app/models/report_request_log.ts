import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Timeline entry for a report request (shown to the requester). Separate from
 * `audit_logs`, which is the system-wide admin ledger.
 */
export default class ReportRequestLog extends BaseModel {
  public static table = 'report_request_logs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare requestId: number

  @column()
  declare action: string

  @column()
  declare fromStatus: string | null

  @column()
  declare toStatus: string | null

  @column()
  declare note: string | null

  @column()
  declare userId: number | null

  @column()
  declare username: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
