import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class OtpCode extends BaseModel {
  public static table = 'otp_codes'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column({ serializeAs: null })
  declare codeHash: string

  @column()
  declare purpose: 'login' | 'setup'

  @column.dateTime()
  declare expiresAt: DateTime

  @column()
  declare attempts: number

  @column.dateTime()
  declare consumedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
