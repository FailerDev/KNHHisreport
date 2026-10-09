import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Report-request extras:
 *   - report_requests.work_sql / work_db_source — ad-hoc SQL the admin ran to
 *     produce the result (re-runnable, and promotable to a permanent report)
 *   - report_requests.promoted_report_id — report_head_detail row created from it
 *   - report_requests.files_purged_at — set when PDPA retention removed the files
 *   - notifications — in-app bell notifications per user
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('report_requests', (table) => {
      table.text('work_sql').nullable()
      table.string('work_db_source', 10).nullable() // his | system
      table.integer('promoted_report_id').unsigned().nullable()
      table.timestamp('files_purged_at').nullable()
    })

    this.schema.createTable('notifications', (table) => {
      table.bigIncrements('id').primary()
      table.integer('user_id').unsigned().notNullable()
      table.string('title', 255).notNullable()
      table.text('body').nullable()
      table.string('link', 255).nullable()
      table.timestamp('read_at').nullable()
      table.timestamp('created_at').notNullable().defaultTo(this.now())

      table.index(['user_id', 'read_at'])
    })
  }

  async down() {
    this.schema.dropTableIfExists('notifications')
    this.schema.alterTable('report_requests', (table) => {
      table.dropColumn('work_sql')
      table.dropColumn('work_db_source')
      table.dropColumn('promoted_report_id')
      table.dropColumn('files_purged_at')
    })
  }
}
