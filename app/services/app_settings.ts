import db from '@adonisjs/lucid/services/db'
import encryption from '@adonisjs/core/services/encryption'
import env from '#start/env'
import { DEFAULT_MOPH_API_URL } from '#services/moph_notify'

/**
 * Admin-editable settings stored in `app_settings` (key/value). A value set in
 * the UI wins over the matching .env variable; .env stays as the fallback so
 * existing deployments keep working.
 *
 * Reads are cached in memory for a short time — they're needed on every
 * request event — and the cache is dropped on every save.
 */

const SECRET_KEYS = new Set([
  'notify.moph_client_key',
  'notify.moph_secret_key',
  'twofa.moph_alert_client_key',
  'twofa.moph_alert_secret_key',
])
const CACHE_MS = 30_000

let cache: { at: number; values: Map<string, string | null> } | null = null

async function loadAll(): Promise<Map<string, string | null>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.values
  const rows: Array<{ key: string; value: string | null }> = await db
    .from('app_settings')
    .select('key', 'value')
  const values = new Map<string, string | null>()
  for (const row of rows) {
    values.set(
      row.key,
      SECRET_KEYS.has(row.key) && row.value
        ? (encryption.decrypt<string>(row.value) ?? null)
        : row.value
    )
  }
  cache = { at: Date.now(), values }
  return values
}

export async function setSettings(values: Record<string, string | null>, userId: number | null) {
  await db.transaction(async (trx) => {
    for (const [key, raw] of Object.entries(values)) {
      const value = SECRET_KEYS.has(key) && raw ? encryption.encrypt(raw) : raw
      await trx.rawQuery(
        `INSERT INTO app_settings (\`key\`, value, updated_by, updated_at) VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by), updated_at = NOW()`,
        // knex accepts null bindings; its StrictValues type just does not say so
        [key, value, userId] as any[]
      )
    }
  })
  cache = null
}

export interface NotificationSettings {
  /** LINE via MOPH Notify (หมอพร้อม) — one room = one client-key/secret-key pair */
  lineEnabled: boolean
  mophApiUrl: string
  mophClientKey: string | null
  mophSecretKey: string | null
  /** text = plain message (safest) · flex = card with an "open" button */
  lineFormat: 'text' | 'flex'
  appUrl: string | null
  retentionDays: number
  events: {
    adminNewRequest: boolean // bell for admins when a request is submitted
    requesterUpdates: boolean // bell for the requester on approve/reject/complete/purge
    lineNewRequest: boolean // LINE push when a request is submitted
    lineCompleted: boolean // LINE push when a request is closed
  }
}

const flag = (v: string | null | undefined, fallback: boolean) =>
  v === null || v === undefined ? fallback : v === '1'

export async function notificationSettings(): Promise<NotificationSettings> {
  const s = await loadAll()
  const pick = (key: string, envValue: string | undefined) =>
    s.has(key) ? s.get(key) || null : (envValue ?? null)

  const mophClientKey = pick('notify.moph_client_key', env.get('MOPH_NOTIFY_CLIENT_KEY'))
  const mophSecretKey = pick('notify.moph_secret_key', env.get('MOPH_NOTIFY_SECRET_KEY'))
  const days = Number(
    pick('pdpa.retention_days', env.get('REQUEST_FILE_RETENTION_DAYS')?.toString())
  )

  return {
    // Default: on when credentials exist (matches the .env-only behaviour)
    lineEnabled: flag(s.get('notify.line_enabled'), !!(mophClientKey && mophSecretKey)),
    mophApiUrl: pick('notify.moph_api_url', env.get('MOPH_NOTIFY_API_URL')) ?? DEFAULT_MOPH_API_URL,
    mophClientKey,
    mophSecretKey,
    lineFormat: s.get('notify.line_format') === 'flex' ? 'flex' : 'text',
    appUrl: pick('app.url', env.get('APP_URL')),
    retentionDays: Number.isFinite(days) && days > 0 ? days : 30,
    events: {
      adminNewRequest: flag(s.get('notify.event.admin_new_request'), true),
      requesterUpdates: flag(s.get('notify.event.requester_updates'), true),
      lineNewRequest: flag(s.get('notify.event.line_new_request'), true),
      lineCompleted: flag(s.get('notify.event.line_completed'), false),
    },
  }
}

export interface SecuritySettings {
  /** Failed logins per username before it is locked */
  loginMaxAttempts: number
  loginLockoutMinutes: number
  /** Failed logins per client IP before it is locked (0 = off) */
  ipMaxAttempts: number
  /** Master switch — off means nobody is asked for a 2FA code */
  twofaEnabled: boolean
  /** User levels that must enrol 2FA (others may opt in) */
  twofaRequiredLevels: Array<'admin' | 'user'>
  twofaTotpIssuer: string
  /** LINE OTP via MOPH Alert (sent to a citizen ID, not a room) */
  mophAlertApiUrl: string | null
  mophAlertClientKey: string | null
  mophAlertSecretKey: string | null
  lineSetupMessage: string | null
}

const int = (v: string | null | undefined, fallback: number, min: number, max: number) => {
  const n = Number(v)
  return v !== null && v !== undefined && v !== '' && Number.isInteger(n) && n >= min && n <= max
    ? n
    : fallback
}

export async function securitySettings(): Promise<SecuritySettings> {
  const s = await loadAll()
  return {
    loginMaxAttempts: int(s.get('security.login_max_attempts'), 5, 1, 50),
    loginLockoutMinutes: int(s.get('security.login_lockout_minutes'), 15, 1, 1440),
    ipMaxAttempts: int(s.get('security.ip_max_attempts'), 30, 0, 1000),
    twofaEnabled: flag(s.get('twofa.enabled'), false),
    twofaRequiredLevels: String(s.get('twofa.required_levels') ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter((v): v is 'admin' | 'user' => v === 'admin' || v === 'user'),
    twofaTotpIssuer: s.get('twofa.totp_issuer') || 'HisReport',
    mophAlertApiUrl: s.get('twofa.moph_alert_api_url') || null,
    mophAlertClientKey: s.get('twofa.moph_alert_client_key') || null,
    mophAlertSecretKey: s.get('twofa.moph_alert_secret_key') || null,
    lineSetupMessage: s.get('twofa.line_setup_message') || null,
  }
}

/** Drop the in-memory cache (after editing `app_settings` outside setSettings). */
export function clearSettingsCache() {
  cache = null
}
