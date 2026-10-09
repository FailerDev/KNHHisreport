import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * app_settings — key/value settings editable from the admin UI (currently the
 * notification + PDPA retention settings). Secrets are stored encrypted with
 * APP_KEY. Values here override the matching .env variables.
 */
export default class extends BaseSchema {
  protected tableName = 'app_settings'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('key', 100).primary()
      table.text('value').nullable()
      table.integer('updated_by').unsigned().nullable()
      table.timestamp('updated_at').notNullable().defaultTo(this.now())
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
