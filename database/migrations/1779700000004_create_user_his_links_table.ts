import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Login with a HIS (HOSxP `opduser`) account. A local `users` row is created
 * on the first HIS login and linked here, so the legacy PHP `users` table
 * stays untouched. A user with a link row authenticates against HIS only.
 */
export default class extends BaseSchema {
  protected tableName = 'user_his_links'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.integer('user_id').unsigned().primary()
      table.string('his_loginname', 250).notNullable().unique()
      table.timestamp('linked_at').notNullable().defaultTo(this.now())
      table.timestamp('last_synced_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
