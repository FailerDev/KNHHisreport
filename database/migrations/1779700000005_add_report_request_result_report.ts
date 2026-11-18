import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * report_requests.result_report_id — the report in the system delivered to the
 * requester instead of (or as well as) a file. They open it from the request
 * page with the request's date range filled in.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('report_requests', (table) => {
      table.integer('result_report_id').unsigned().nullable()
    })
  }

  async down() {
    this.schema.alterTable('report_requests', (table) => {
      table.dropColumn('result_report_id')
    })
  }
}
