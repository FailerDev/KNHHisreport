import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * his_settings table — created (and managed) by the PHP HisReport app.
 * Schema mirrors HISConfig::createHISSettingsTable() in
 * `includes/config/his_config.php` of the legacy project.
 *
 * Password is stored as plain text (legacy decision — see PHP source).
 */
export default class HisSetting extends BaseModel {
  public static table = 'his_settings'

  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'db_host_his' })
  declare dbHost: string

  @column({ columnName: 'db_name_his' })
  declare dbName: string

  @column({ columnName: 'db_username_his' })
  declare dbUsername: string

  @column({ columnName: 'db_password_his', serializeAs: null })
  declare dbPassword: string | null

  @column({ columnName: 'db_port_his' })
  declare dbPort: string

  @column({ columnName: 'created_by' })
  declare createdBy: number | null

  @column({ columnName: 'updated_by' })
  declare updatedBy: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
