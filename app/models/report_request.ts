import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import ReportRequestFile from '#models/report_request_file'
import ReportRequestLog from '#models/report_request_log'
import type { DataLevel, OutputFormat, RequestStatus } from '#services/report_request_flow'

/**
 * A data/report request (คำขอข้อมูล/รายงาน). Status rules live in
 * `#services/report_request_flow`; mutations go through
 * `#services/report_request_service` so every change is logged.
 */
export default class ReportRequest extends BaseModel {
  public static table = 'report_requests'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare reqNo: string

  @column()
  declare fiscalYear: number

  @column()
  declare requesterId: number

  @column()
  declare title: string

  @column()
  declare description: string

  @column()
  declare purpose: string | null

  @column()
  declare dataLevel: DataLevel

  @column.date()
  declare dateFrom: DateTime | null

  @column.date()
  declare dateTo: DateTime | null

  @column()
  declare outputFormat: OutputFormat

  @column.date()
  declare dueDate: DateTime | null

  @column()
  declare status: RequestStatus

  @column()
  declare reviewedBy: number | null

  @column.dateTime()
  declare reviewedAt: DateTime | null

  @column()
  declare rejectReason: string | null

  @column()
  declare assignedTo: number | null

  @column()
  declare completionNote: string | null

  @column.dateTime()
  declare completedAt: DateTime | null

  @column()
  declare workSql: string | null

  @column()
  declare workDbSource: 'his' | 'system' | null

  @column()
  declare promotedReportId: number | null

  @column.dateTime()
  declare filesPurgedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User, { foreignKey: 'requesterId' })
  declare requester: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'assignedTo' })
  declare assignee: BelongsTo<typeof User>

  @hasMany(() => ReportRequestFile, { foreignKey: 'requestId' })
  declare files: HasMany<typeof ReportRequestFile>

  @hasMany(() => ReportRequestLog, { foreignKey: 'requestId' })
  declare logs: HasMany<typeof ReportRequestLog>

  get isOverdue(): boolean {
    if (!this.dueDate) return false
    if (this.status !== 'pending' && this.status !== 'in_progress') return false
    return this.dueDate.endOf('day') < DateTime.now()
  }
}
