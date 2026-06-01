import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export type ReportParamType = 'text' | 'number' | 'date' | 'select' | 'datetime' | 'textarea'

/**
 * Configurable parameter for a report (filled in by the end-user before
 * running). The legacy PHP app stores select-option lists as a JSON array
 * in `options`.
 */
export default class ReportParameter extends BaseModel {
  public static table = 'report_parameters'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare reportId: number

  @column()
  declare paramName: string

  @column()
  declare paramLabel: string

  @column()
  declare paramType: ReportParamType

  @column()
  declare paramDefault: string | null

  @column({
    consume: (v) => v === 1 || v === true || v === '1',
  })
  declare paramRequired: boolean

  @column()
  declare options: string | null

  @column()
  declare sortOrder: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime | null

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  /**
   * Parsed select options (the PHP app stores a JSON array).
   * Returns [] on parse failure or null/empty input.
   */
  get parsedOptions(): string[] {
    if (!this.options) return []
    try {
      const parsed = JSON.parse(this.options)
      return Array.isArray(parsed) ? parsed.map((o) => String(o)) : []
    } catch {
      return []
    }
  }
}
