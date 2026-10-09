import { DateTime } from 'luxon'
import LoginLockout from '#models/login_lockout'

/**
 * Login rate limit (ported from 99CLAIM): count failed attempts per key and
 * lock the key for N minutes once it reaches the limit. Two keys are used —
 * `user:<username>` (stops guessing one account) and `ip:<addr>` (stops one
 * machine spraying many usernames). The counter is keyed by what was typed,
 * so unknown usernames lock the same way and don't reveal which ones exist.
 */

export const userKey = (username: string) => `user:${username.trim().toLowerCase()}`.slice(0, 120)
export const ipKey = (ip: string) => `ip:${ip}`.slice(0, 120)

export function isLocked(state: { lockedUntil: DateTime | null }, now: DateTime): boolean {
  return state.lockedUntil !== null && state.lockedUntil > now
}

export function minutesRemaining(lockedUntil: DateTime, now: DateTime): number {
  return Math.max(1, Math.ceil(lockedUntil.diff(now, 'minutes').minutes))
}

export function nextFailState(
  currentFailCount: number,
  maxAttempts: number,
  lockoutMinutes: number,
  now: DateTime
): { failCount: number; lockedUntil: DateTime | null } {
  const failCount = currentFailCount + 1
  const lockedUntil = failCount >= maxAttempts ? now.plus({ minutes: lockoutMinutes }) : null
  return { failCount, lockedUntil }
}

/** Minutes left on the lock, or null when the key may try again. An expired lock is reset. */
export async function checkLockout(key: string, now: DateTime = DateTime.now()): Promise<number | null> {
  const row = await LoginLockout.find(key)
  if (!row) return null
  if (isLocked(row, now)) return minutesRemaining(row.lockedUntil!, now)
  if (row.lockedUntil) {
    row.failCount = 0
    row.lockedUntil = null
    await row.save()
  }
  return null
}

/** Count one failure; returns the minutes locked when this attempt triggered the lock. */
export async function recordFailedAttempt(
  key: string,
  maxAttempts: number,
  lockoutMinutes: number
): Promise<number | null> {
  const now = DateTime.now()
  const row = await LoginLockout.firstOrCreate({ lockKey: key }, { failCount: 0, lockedUntil: null })
  const next = nextFailState(row.failCount, maxAttempts, lockoutMinutes, now)
  row.failCount = next.failCount
  row.lockedUntil = next.lockedUntil
  row.lastAttemptAt = now
  await row.save()
  return next.lockedUntil ? lockoutMinutes : null
}

export async function clearLockout(key: string): Promise<void> {
  await LoginLockout.query().where('lock_key', key).delete()
}

/** Usernames (lower-cased) that are locked right now — for the admin users page. */
export async function lockedUsernames(): Promise<Set<string>> {
  const rows = await LoginLockout.query()
    .where('lock_key', 'like', 'user:%')
    .where('locked_until', '>', DateTime.now().toSQL({ includeOffset: false })!)
  return new Set(rows.map((r) => r.lockKey.slice('user:'.length)))
}
