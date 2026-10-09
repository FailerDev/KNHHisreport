import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import User from '#models/user'
import { clearLockout, userKey } from '#services/login_lockout'

/**
 * Login with a second step. When 2FA is required the user is NOT logged in
 * after the password check: only `{ userId, at }` is parked in the session
 * and every /2fa page reads it from there. The real `auth.login()` happens
 * after the code is verified, so there is never a half-logged-in session that
 * other routes could mistake for a full one.
 */

const PENDING_KEY = 'twofa.pending'
const PENDING_TTL_MS = 10 * 60 * 1000

/** Session keys that only belong to an in-progress 2FA login/enrolment. */
export const TWOFA_SESSION_KEYS = [PENDING_KEY, 'twofa.setupSecret', 'twofa.setupCitizenId', 'twofa.recoveryCodes']

export function landingFor(user: User): string {
  return user.userLevel === 'admin' ? '/admin/dashboard' : '/reports'
}

export function startPendingLogin(ctx: HttpContext, user: User) {
  ctx.session.put(PENDING_KEY, { userId: user.id, at: Date.now() })
}

export function clearPendingLogin(ctx: HttpContext) {
  for (const key of TWOFA_SESSION_KEYS) ctx.session.forget(key)
}

/** The user waiting for their second step, or null (none / expired / no longer allowed). */
export async function pendingLoginUser(ctx: HttpContext): Promise<User | null> {
  const pending = ctx.session.get(PENDING_KEY) as { userId: number; at: number } | undefined
  if (!pending) return null
  if (Date.now() - Number(pending.at) > PENDING_TTL_MS) {
    clearPendingLogin(ctx)
    return null
  }
  const user = await User.find(pending.userId)
  if (!user || user.status !== 1) {
    clearPendingLogin(ctx)
    return null
  }
  return user
}

/** Final step of a login: create the real session and send the user home. */
export async function completeLogin(ctx: HttpContext, user: User, redirectTo?: string) {
  clearPendingLogin(ctx)
  await clearLockout(userKey(user.username))
  await ctx.auth.use('web').login(user)

  user.lastLogin = DateTime.now()
  try {
    await user.save()
  } catch {
    /* best-effort */
  }
  return ctx.response.redirect(redirectTo ?? landingFor(user))
}
