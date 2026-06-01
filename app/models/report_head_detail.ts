import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import ReportHead from '#models/report_head'
import ReportParameter from '#models/report_parameter'

/**
 * A single report (the thing the user actually runs).
 * `sql1` is the query; `database_source` decides which Lucid connection it
 * runs against ('system' = primary app DB; 'his' = the runtime-configured
 * HIS connection from his_settings).
 */
export default class ReportHeadDetail extends BaseModel {
  public static table = 'report_head_detail'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare headId: number

  @column()
  declare detail: string

  // Default Lucid snake_case treats digits as a boundary: `sql1` → `sql_1`.
  // The legacy PHP schema uses literal `sql1`/`sql2`, so pin them explicitly.
  @column({ columnName: 'sql1' })
  declare sql1: string

  @column({ columnName: 'sql2' })
  declare sql2: string | null

  @column()
  declare databaseSource: 'system' | 'his' | null

  @column()
  declare sort: number

  @column()
  declare status: number

  // Legacy PHP-owned schema has no created_at/updated_at on this table.
  // Adonis must not assume them — `await save()` would otherwise generate
  // an UPDATE referencing a non-existent column. See feedback memory.

  @belongsTo(() => ReportHead, { foreignKey: 'headId' })
  declare head: BelongsTo<typeof ReportHead>

  @hasMany(() => ReportParameter, { foreignKey: 'reportId' })
  declare parameters: HasMany<typeof ReportParameter>
}
