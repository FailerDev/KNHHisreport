import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Login rate limit + two-factor authentication (ported from 99CLAIM):
 *   - login_lockouts — failed-attempt counters per key (`user:<name>` / `ip:<addr>`)
 *   - user_two_factor — one row per user that enrolled 2FA or has an admin
 *     override; kept out of the legacy PHP `users` table on purpose
 *   - user_2fa_recovery_codes — hashed one-time recovery codes
 *   - otp_codes — hashed LINE OTP codes (MOPH Alert, sent by citizen ID)
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('login_lockouts', (table) => {
      table.string('lock_key', 120).primary()
      table.integer('fail_count').unsigned().notNullable().defaultTo(0)
      table.timestamp('locked_until').nullable()
      table.timestamp('last_attempt_at').nullable()
    })

    this.schema.createTable('user_two_factor', (table) => {
      table.integer('user_id').unsigned().primary()
      table.string('method', 10).nullable() // totp | line — null = not enrolled
      table.text('totp_secret').nullable() // encrypted with APP_KEY
      table.bigInteger('totp_last_step').nullable() // blocks re-use of a code inside its window
      table.text('citizen_id').nullable() // encrypted with APP_KEY
      table.string('force', 10).notNullable().defaultTo('default') // default | require | exempt
      table.timestamp('enabled_at').nullable()
      table.timestamp('updated_at').notNullable().defaultTo(this.now())
    })

    this.schema.createTable('user_2fa_recovery_codes', (table) => {
      table.increments('id')
      table.integer('user_id').unsigned().notNullable()
      table.string('code_hash', 255).notNullable()
      table.timestamp('used_at').nullable()
      table.timestamp('created_at').notNullable().defaultTo(this.now())
      table.index(['user_id'])
    })

    this.schema.createTable('otp_codes', (table) => {
      table.increments('id')
      table.integer('user_id').unsigned().notNullable()
      table.string('code_hash', 255).notNullable()
      table.string('purpose', 10).notNullable() // login | setup
      table.timestamp('expires_at').notNullable()
      table.integer('attempts').unsigned().notNullable().defaultTo(0)
      table.timestamp('consumed_at').nullable()
      table.timestamp('created_at').notNullable().defaultTo(this.now())
      table.index(['user_id', 'purpose'])
    })
  }

  async down() {
    this.schema.dropTableIfExists('otp_codes')
    this.schema.dropTableIfExists('user_2fa_recovery_codes')
    this.schema.dropTableIfExists('user_two_factor')
    this.schema.dropTableIfExists('login_lockouts')
  }
}
