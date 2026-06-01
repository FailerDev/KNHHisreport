import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import ReportHeadDetail from '#models/report_head_detail'

/**
 * Report category (top-level grouping shown as a card on /reports).
 * Maps to the legacy `report_head` table created by the PHP HisReport app.
 */
export default class ReportHead extends BaseModel {
  public static table = 'report_head'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare detail: string

  @column()
  declare sort: number

  @column()
  declare status: number

  @hasMany(() => ReportHeadDetail, { foreignKey: 'headId' })
  declare reports: HasMany<typeof ReportHeadDetail>
}
