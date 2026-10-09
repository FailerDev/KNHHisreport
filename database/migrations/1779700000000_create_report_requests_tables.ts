import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Data/report request workflow (ขอข้อมูล/รายงาน).
 *
 *   report_request_sequences — per-fiscal-year running number for REQ-YYYY-NNNN
 *   report_requests          — one row per request
 *   report_request_files     — result files (uploaded or generated) per request
 *   report_request_logs      — status timeline shown to the requester
 *
 * `requester_id` / `user_id` columns intentionally have no FK: `users` is the
 * legacy PHP table and its id type is not guaranteed to match.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('report_request_sequences', (table) => {
      table.integer('fiscal_year').unsigned().primary() // พ.ศ. ปีงบประมาณ เช่น 2570
      table.integer('last_no').unsigned().notNullable().defaultTo(0)
    })

    this.schema.createTable('report_requests', (table) => {
      table.increments('id').primary()
      table.string('req_no', 20).notNullable().unique()
      table.integer('fiscal_year').unsigned().notNullable()
      table.integer('requester_id').unsigned().notNullable()
      table.string('title', 255).notNullable()
      table.text('description').notNullable()
      table.text('purpose').nullable()
      table.string('data_level', 20).notNullable().defaultTo('aggregate') // aggregate | identifiable
      table.date('date_from').nullable()
      table.date('date_to').nullable()
      table.string('output_format', 10).notNullable().defaultTo('xlsx') // xlsx | csv | pdf | any
      table.date('due_date').nullable()
      table.string('status', 20).notNullable().defaultTo('pending')
      table.integer('reviewed_by').unsigned().nullable()
      table.timestamp('reviewed_at').nullable()
      table.text('reject_reason').nullable()
      table.integer('assigned_to').unsigned().nullable()
      table.text('completion_note').nullable()
      table.timestamp('completed_at').nullable()
      table.timestamp('created_at').notNullable().defaultTo(this.now())
      table.timestamp('updated_at').notNullable().defaultTo(this.now())

      table.index(['status', 'created_at'])
      table.index('requester_id')
    })

    this.schema.createTable('report_request_files', (table) => {
      table.increments('id').primary()
      table
        .integer('request_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('report_requests')
        .onDelete('CASCADE')
      table.string('original_name', 255).notNullable()
      table.string('stored_name', 100).notNullable()
      table.string('mime', 120).nullable()
      table.integer('size').unsigned().notNullable().defaultTo(0)
      table.string('source', 20).notNullable().defaultTo('upload') // upload | generated
      table.integer('uploaded_by').unsigned().nullable()
      table.integer('download_count').unsigned().notNullable().defaultTo(0)
      table.timestamp('created_at').notNullable().defaultTo(this.now())
    })

    this.schema.createTable('report_request_logs', (table) => {
      table.bigIncrements('id').primary()
      table
        .integer('request_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('report_requests')
        .onDelete('CASCADE')
      table.string('action', 30).notNullable() // create | approve | reject | cancel | upload | generate | delete_file | complete
      table.string('from_status', 20).nullable()
      table.string('to_status', 20).nullable()
      table.text('note').nullable()
      table.integer('user_id').unsigned().nullable()
      table.string('username', 64).nullable()
      table.timestamp('created_at').notNullable().defaultTo(this.now())

      table.index(['request_id', 'created_at'])
    })
  }

  async down() {
    this.schema.dropTableIfExists('report_request_logs')
    this.schema.dropTableIfExists('report_request_files')
    this.schema.dropTableIfExists('report_requests')
    this.schema.dropTableIfExists('report_request_sequences')
  }
}
