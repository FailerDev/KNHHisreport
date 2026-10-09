import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class UserRecoveryCode extends BaseModel {
  public static table = 'user_2fa_recovery_codes'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column({ serializeAs: null })
  declare codeHash: string

  @column.dateTime()
  declare usedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
