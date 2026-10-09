import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import type User from '#models/user'
import LoginLockout from '#models/login_lockout'
import { securitySettings, setSettings } from '#services/app_settings'
import { writeAudit } from '#services/audit'

const checkbox = () => vine.string().optional()

const settingsValidator = vine.compile(
  vine.object({
    login_max_attempts: vine.number().withoutDecimals().min(1).max(50),
    login_lockout_minutes: vine.number().withoutDecimals().min(1).max(1440),
    ip_max_attempts: vine.number().withoutDecimals().min(0).max(1000),
    twofa_enabled: checkbox(),
    twofa_required_admin: checkbox(),
    twofa_required_user: checkbox(),
    twofa_totp_issuer: vine.string().trim().maxLength(60).optional(),
    moph_alert_api_url: vine
      .string()
      .trim()
      .maxLength(255)
      .url({ require_tld: false, protocols: ['http', 'https'] })
      .optional(),
    moph_alert_client_key: vine.string().trim().maxLength(255).optional(),
    moph_alert_secret_key: vine.string().trim().maxLength(255).optional(),
    clear_moph_alert_keys: checkbox(),
    line_setup_message: vine.string().trim().maxLength(500).optional(),
  })
)

const tail = (v: string | null) => (v ? v.slice(-4) : '')

/**
 * /admin/security-settings — login rate limit + 2FA policy. Stored in
 * `app_settings`; MOPH Alert keys encrypted with APP_KEY.
 */
export default class SecuritySettingsController {
  async show({ view, session }: HttpContext) {
    const settings = await securitySettings()
    const now = DateTime.now().toSQL({ includeOffset: false })!
    const [locks, [enrolled]] = await Promise.all([
      LoginLockout.query().where('locked_until', '>', now).orderBy('locked_until', 'desc'),
      db.from('user_two_factor').whereNotNull('method').count('* as total'),
    ])

    return view.render('pages/admin/security_settings', {
      settings,
      locks,
      enrolledCount: Number(enrolled?.total ?? 0),
      hasAlertKeys: !!(settings.mophAlertClientKey && settings.mophAlertSecretKey),
      clientKeyTail: tail(settings.mophAlertClientKey),
      secretKeyTail: tail(settings.mophAlertSecretKey),
      message: session.flashMessages.get('message'),
      messageType: session.flashMessages.get('messageType'),
    })
  }

  async save(ctx: HttpContext) {
    const { request, session, response, auth } = ctx
    try {
      const p = await settingsValidator.validate(request.all())
      const levels = [p.twofa_required_admin ? 'admin' : null, p.twofa_required_user ? 'user' : null].filter(Boolean)

      const values: Record<string, string | null> = {
        'security.login_max_attempts': String(p.login_max_attempts),
        'security.login_lockout_minutes': String(p.login_lockout_minutes),
        'security.ip_max_attempts': String(p.ip_max_attempts),
        'twofa.enabled': p.twofa_enabled ? '1' : '0',
        'twofa.required_levels': levels.join(','),
        'twofa.totp_issuer': p.twofa_totp_issuer || null,
        'twofa.moph_alert_api_url': p.moph_alert_api_url || null,
        'twofa.line_setup_message': p.line_setup_message || null,
      }
      // Blank key fields = keep the saved ones (they are never echoed back to the page)
      if (p.moph_alert_client_key) values['twofa.moph_alert_client_key'] = p.moph_alert_client_key
      if (p.moph_alert_secret_key) values['twofa.moph_alert_secret_key'] = p.moph_alert_secret_key
      if (p.clear_moph_alert_keys && !p.moph_alert_client_key) values['twofa.moph_alert_client_key'] = null
      if (p.clear_moph_alert_keys && !p.moph_alert_secret_key) values['twofa.moph_alert_secret_key'] = null

      await setSettings(values, (auth.user as User).id)
      await writeAudit(ctx, {
        action: 'settings.security',
        entity: 'app_settings',
        summary: 'updated security settings',
        meta: {
          loginMaxAttempts: p.login_max_attempts,
          loginLockoutMinutes: p.login_lockout_minutes,
          ipMaxAttempts: p.ip_max_attempts,
          twofaEnabled: !!p.twofa_enabled,
          twofaRequiredLevels: levels,
          alertKeysChanged: !!(p.moph_alert_client_key || p.moph_alert_secret_key || p.clear_moph_alert_keys),
        },
      })
      session.flash('message', 'บันทึกการตั้งค่าความปลอดภัยแล้ว')
      session.flash('messageType', 'success')
    } catch (err: any) {
      session.flash('message', err?.messages?.[0]?.message ?? err?.message ?? 'เกิดข้อผิดพลาด')
      session.flash('messageType', 'error')
    }
    return response.redirect('/admin/security-settings')
  }

  /** Lift a lock (a username or an IP) before it expires. */
  async unlock(ctx: HttpContext) {
    const { request, session, response } = ctx
    const key = String(request.input('lock_key') ?? '')
    if (/^(user|ip):/.test(key)) {
      await LoginLockout.query().where('lock_key', key).delete()
      await writeAudit(ctx, { action: 'auth.unlock', entity: 'login_lockout', summary: `unlocked ${key}` })
      session.flash('message', `ปลดล็อก ${key.replace(/^user:/, 'ผู้ใช้ ').replace(/^ip:/, 'IP ')} แล้ว`)
      session.flash('messageType', 'success')
    }
    return response.redirect().back()
  }
}
