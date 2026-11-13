import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import User from '#models/user'
import UserHisLink from '#models/user_his_link'
import hisDb from '#services/his_db'

/**
 * Sign in with a HIS account from HOSxP `opduser`.
 *
 * HOSxP keeps the web password as an MD5 hex digest in `opduser.passweb`
 * (upper-case in practice — compared case-insensitively here). The other
 * `password` column uses HOSxP's own reversible scheme and is not used.
 */

export interface HisAccount {
  loginname: string
  name: string | null
  department: string | null
}

export type HisVerifyResult =
  | { ok: true; account: HisAccount }
  | { ok: false; reason: 'invalid' | 'disabled' | 'unavailable' }

/** True when `password` hashes to the MD5 hex stored in `passweb`. */
export function matchesPassweb(password: string, passweb: string | null | undefined): boolean {
  const stored = String(passweb ?? '')
    .trim()
    .toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(stored)) return false
  const given = createHash('md5').update(password, 'utf8').digest('hex')
  return timingSafeEqual(Buffer.from(given), Buffer.from(stored))
}

const clean = (v: unknown) => {
  const s = String(v ?? '').trim()
  return s && s !== '-' ? s : null
}

/** Check a username/password against HIS `opduser`. Never throws. */
export async function verifyHisCredentials(
  username: string,
  password: string
): Promise<HisVerifyResult> {
  if (!username || !db.manager.has(hisDb.connectionName))
    return { ok: false, reason: 'unavailable' }

  let row: any
  try {
    const result = (await db
      .connection(hisDb.connectionName)
      .rawQuery(
        'SELECT loginname, name, passweb, account_disable, department, entryposition FROM opduser WHERE loginname = ? LIMIT 1',
        [username]
      )) as any
    row = result?.[0]?.[0]
  } catch (err) {
    logger.warn({ err }, 'his_login: opduser lookup failed')
    return { ok: false, reason: 'unavailable' }
  }

  if (!row || !matchesPassweb(password, row.passweb)) return { ok: false, reason: 'invalid' }
  if (String(row.account_disable ?? '').toUpperCase() === 'Y')
    return { ok: false, reason: 'disabled' }

  return {
    ok: true,
    account: {
      loginname: String(row.loginname),
      name: clean(row.name),
      department: clean(row.department) ?? clean(row.entryposition),
    },
  }
}

/** The HIS link of a local user, or null when the user is a local account. */
export async function hisLinkFor(userId: number): Promise<UserHisLink | null> {
  return UserHisLink.find(userId)
}

/** User ids that sign in through HIS (for the admin user list). */
export async function hisLinkedUserIds(): Promise<Set<number>> {
  const rows = await UserHisLink.query().select('user_id')
  return new Set(rows.map((r) => r.userId))
}

/**
 * Find or create the local user for a verified HIS account. On first login
 * the user is created with an unusable random local password; name and
 * department are refreshed from HIS on every login.
 */
export async function upsertHisUser(
  account: HisAccount,
  existing: User | null,
  autoApprove: boolean
): Promise<{ user: User; created: boolean }> {
  const now = DateTime.now()

  if (existing) {
    if (account.name) existing.fullname = account.name
    if (account.department) existing.department = account.department
    if (existing.$isDirty) await existing.save()
    await UserHisLink.query()
      .where('user_id', existing.id)
      .update({ last_synced_at: now.toSQL({ includeOffset: false }) })
    return { user: existing, created: false }
  }

  const user = await db.transaction(async (trx) => {
    const created = await User.create(
      {
        username: account.loginname,
        password: randomBytes(32).toString('hex'),
        fullname: account.name ?? account.loginname,
        department: account.department,
        userLevel: 'user',
        groupId: 2,
        status: autoApprove ? 1 : 0,
      },
      { client: trx }
    )
    await UserHisLink.create(
      { userId: created.id, hisLoginname: account.loginname, lastSyncedAt: now },
      { client: trx }
    )
    return created
  })
  return { user, created: true }
}
