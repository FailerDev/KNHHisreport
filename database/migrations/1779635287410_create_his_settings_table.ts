import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Creates the his_settings table if it does not already exist.
 * Matches the schema produced by the legacy PHP HisReport
 * (HISConfig::createHISSettingsTable in includes/config/his_config.php).
 *
 * Uses `hasTable` so this migration is safe to run on databases where the
 * PHP app already created the table.
 */
export default class extends BaseSchema {
  protected tableName = 'his_settings'

  async up() {
    const exists = await this.schema.hasTable(this.tableName)
    if (exists) return

    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()
      table.string('db_host_his', 255).notNullable()
      table.string('db_name_his', 255).notNullable()
      table.string('db_username_his', 255).notNullable()
      table.text('db_password_his').nullable()
      table.string('db_port_his', 10).defaultTo('3306')
      table.integer('created_by').unsigned().nullable()
      table.integer('updated_by').unsigned().nullable()
      table.timestamp('created_at').defaultTo(this.now())
      table.timestamp('updated_at').defaultTo(this.now())
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
