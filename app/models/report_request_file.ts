import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * A result file attached to a report request. The bytes live outside
 * `public/` under `storage/report_requests/<request_id>/<stored_name>` and are
 * only served through the permission-checked download route.
 */
export default class ReportRequestFile extends BaseModel {
  public static table = 'report_request_files'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare requestId: number

  @column()
  declare originalName: string

  @column()
  declare storedName: string

  @column()
  declare mime: string | null

  @column()
  declare size: number

  @column()
  declare source: 'upload' | 'generated'

  @column()
  declare uploadedBy: number | null

  @column()
  declare downloadCount: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  get sizeLabel(): string {
    if (this.size < 1024) return `${this.size} B`
    if (this.size < 1024 * 1024) return `${(this.size / 1024).toFixed(1)} KB`
    return `${(this.size / 1024 / 1024).toFixed(1)} MB`
  }
}
