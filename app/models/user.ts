import { DateTime } from 'luxon'
import bcrypt from 'bcryptjs'
import { BaseModel, beforeSave, column } from '@adonisjs/lucid/orm'

/**
 * Custom User mapping the existing PHP `users` table.
 *
 * Why we hand-roll instead of using @adonisjs/auth's `withAuthFinder`:
 *   1. PHP's `password_hash()` emits `$2y$`-prefixed bcrypt hashes; the npm
 *      `bcrypt` package (used by Adonis's bcrypt hash driver) refuses to
 *      verify them. `bcryptjs` (pure JS) accepts $2a/$2b/$2y, so we use it
 *      directly for both verify and re-hash.
 *   2. We need a `status === 1` gate (PHP convention for approved users).
 */
export default class User extends BaseModel {
  public static table = 'users'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare username: string

  @column({ serializeAs: null })
  declare password: string

  @column()
  declare fullname: string | null

  @column()
  declare email: string | null

  @column()
  declare department: string | null

  @column()
  declare userLevel: 'admin' | 'user'

  @column()
  declare groupId: number

  @column()
  declare status: number

  @column.dateTime()
  declare lastLogin: DateTime | null

  get isAdmin(): boolean {
    return this.userLevel === 'admin'
  }

  /**
   * Auto-hash password on save if it's not already a bcrypt hash.
   */
  @beforeSave()
  static async hashPassword(user: User) {
    if (user.$dirty.password && !/^\$2[aby]\$/.test(user.password)) {
      user.password = await bcrypt.hash(user.password, 10)
    }
  }

  /**
   * Look up a user by username and verify the password (bcrypt $2y/$2b/$2a).
   * Throws on miss or mismatch (mirrors Adonis's withAuthFinder API).
   */
  static async verifyCredentials(username: string, password: string): Promise<User> {
    const user = await this.findBy('username', username)
    if (!user) throw new Error('Invalid credentials')
    const ok = await bcrypt.compare(password, user.password)
    if (!ok) throw new Error('Invalid credentials')
    return user
  }
}
