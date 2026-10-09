import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/** Failed-login counter for one key (`user:<name>` or `ip:<addr>`). */
export default class LoginLockout extends BaseModel {
  public static table = 'login_lockouts'
  static selfAssignPrimaryKey = true

  @column({ isPrimary: true })
  declare lockKey: string

  @column()
  declare failCount: number

  @column.dateTime()
  declare lockedUntil: DateTime | null

  @column.dateTime()
  declare lastAttemptAt: DateTime | null
}
