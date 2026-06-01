import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

/**
 * Dashboard widget definition — maps to the legacy PHP `bpdashboard_head_index`
 * table. Each row defines one tile (count + optional chart) that runs against
 * the HIS database.
 */
export default class DashboardItem extends BaseModel {
  public static table = 'bpdashboard_head_index'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare detail: string

  @column()
  declare sort: number | null

  // Digit-suffixed columns (Lucid would otherwise expect `sql_1` / `color_1`).
  @column({ columnName: 'sql1' })
  declare sql1: string

  @column()
  declare linkId: string | null

  @column()
  declare icons: string

  @column({ columnName: 'color1' })
  declare color1: string

  @column({ columnName: 'pie_name' })
  declare pieName: string | null

  @column({ columnName: 'pie_count' })
  declare pieCount: number | null

  @column({ columnName: 'pie_show' })
  declare pieShow: string | null

  @column({ columnName: 'chart_type' })
  declare chartType: string | null

  @column({ columnName: 'chart_sql' })
  declare chartSql: string | null

  @column({ columnName: 'chart_color' })
  declare chartColor: string | null

  @column.dateTime({ columnName: 'time_stamp' })
  declare timeStamp: DateTime | null
}
