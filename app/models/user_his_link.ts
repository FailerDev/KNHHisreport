import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Marks a local user as a HIS account (HOSxP `opduser.loginname`). Such a
 * user signs in with their HIS password; the local password is unused.
 */
export default class UserHisLink extends BaseModel {
  public static table = 'user_his_links'
  static selfAssignPrimaryKey = true

  @column({ isPrimary: true })
  declare userId: number

  @column()
  declare hisLoginname: string

  @column.dateTime({ autoCreate: true })
  declare linkedAt: DateTime

  @column.dateTime()
  declare lastSyncedAt: DateTime | null
}
