import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * audit_logs — write-only ledger of admin mutations.
 *
 * Each row records who did what, when, against which entity. We index by
 * (entity, entity_id) and by user_id so the most common forensic queries
 * stay cheap even as the table grows.
 */
export default class extends BaseSchema {
  protected tableName = 'audit_logs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id').primary()
      table.integer('user_id').unsigned().nullable()
      table.string('username', 64).nullable()
      table.string('action', 40).notNullable() // e.g. 'user.create'
      table.string('entity', 40).notNullable() // e.g. 'user', 'report', 'his_settings'
      table.integer('entity_id').nullable()
      table.text('summary').nullable()
      table.json('meta').nullable()
      table.string('ip', 64).nullable()
      table.string('user_agent', 255).nullable()
      table.timestamp('created_at').notNullable().defaultTo(this.now())

      table.index(['entity', 'entity_id'])
      table.index('user_id')
      table.index('created_at')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
