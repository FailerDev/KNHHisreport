import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export type TwoFactorMethod = 'totp' | 'line'
export type TwoFactorForce = 'default' | 'require' | 'exempt'

/**
 * 2FA state of one user. Lives in its own table so the legacy PHP `users`
 * table stays untouched. `totpSecret` / `citizenId` are stored encrypted —
 * use the helpers in #services/two_factor to read/write them.
 */
export default class UserTwoFactor extends BaseModel {
  public static table = 'user_two_factor'
  static selfAssignPrimaryKey = true

  @column({ isPrimary: true })
  declare userId: number

  @column()
  declare method: TwoFactorMethod | null

  @column({ serializeAs: null })
  declare totpSecret: string | null

  @column()
  declare totpLastStep: number | null

  @column({ serializeAs: null })
  declare citizenId: string | null

  @column()
  declare force: TwoFactorForce

  @column.dateTime()
  declare enabledAt: DateTime | null

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
