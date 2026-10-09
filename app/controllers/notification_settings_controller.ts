import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import type User from '#models/user'
import { notificationSettings, setSettings } from '#services/app_settings'
import { buildLineMessages } from '#services/notifier'
import { DEFAULT_MOPH_API_URL, describeMophError, sendMoph } from '#services/moph_notify'
import { writeAudit } from '#services/audit'

const checkbox = () => vine.string().optional()
const url = () =>
  vine
    .string()
    .trim()
    .maxLength(255)
    .url({ require_tld: false, protocols: ['http', 'https'] })

const settingsValidator = vine.compile(
  vine.object({
    line_enabled: checkbox(),
    moph_api_url: url().optional(),
    moph_client_key: vine.string().trim().maxLength(255).optional(),
    moph_secret_key: vine.string().trim().maxLength(255).optional(),
    clear_moph_keys: checkbox(),
    line_format: vine.enum(['text', 'flex'] as const),
    app_url: url().optional(),
    retention_days: vine.number().min(1).max(3650),
    event_admin_new_request: checkbox(),
    event_requester_updates: checkbox(),
    event_line_new_request: checkbox(),
    event_line_completed: checkbox(),
  })
)

const bool = (v: string | undefined) => (v ? '1' : '0')
const tail = (v: string | null) => (v ? v.slice(-4) : '')

/**
 * /admin/notification-settings — bell + LINE (MOPH Notify) toggles and the
 * PDPA file-retention period. Stored in `app_settings`, overriding .env.
 */
export default class NotificationSettingsController {
  async show({ view, session }: HttpContext) {
    const settings = await notificationSettings()
    return view.render('pages/admin/notification_settings', {
      settings,
      hasKeys: !!(settings.mophClientKey && settings.mophSecretKey),
      clientKeyTail: tail(settings.mophClientKey),
      secretKeyTail: tail(settings.mophSecretKey),
      defaultApiUrl: DEFAULT_MOPH_API_URL,
      message: session.flashMessages.get('message'),
      messageType: session.flashMessages.get('messageType'),
    })
  }

  async save(ctx: HttpContext) {
    const { request, session, response, auth } = ctx
    try {
      const p = await settingsValidator.validate(request.all())
      const current = await notificationSettings()

      const keep = !p.clear_moph_keys
      const clientKey = p.moph_client_key || (keep ? current.mophClientKey : null)
      const secretKey = p.moph_secret_key || (keep ? current.mophSecretKey : null)
      if (p.line_enabled && (!clientKey || !secretKey)) {
        throw new Error('เปิดแจ้งเตือน LINE ต้องกรอก client-key และ secret-key ของห้อง MOPH Notify')
      }

      const values: Record<string, string | null> = {
        'notify.line_enabled': bool(p.line_enabled),
        'notify.moph_api_url': p.moph_api_url ?? null,
        'notify.line_format': p.line_format,
        'app.url': p.app_url ?? null,
        'pdpa.retention_days': String(p.retention_days),
        'notify.event.admin_new_request': bool(p.event_admin_new_request),
        'notify.event.requester_updates': bool(p.event_requester_updates),
        'notify.event.line_new_request': bool(p.event_line_new_request),
        'notify.event.line_completed': bool(p.event_line_completed),
      }
      // Blank key fields = keep the saved ones (they are never echoed back to the page)
      if (p.moph_client_key) values['notify.moph_client_key'] = p.moph_client_key
      if (p.moph_secret_key) values['notify.moph_secret_key'] = p.moph_secret_key
      if (p.clear_moph_keys && !p.moph_client_key) values['notify.moph_client_key'] = null
      if (p.clear_moph_keys && !p.moph_secret_key) values['notify.moph_secret_key'] = null

      await setSettings(values, (auth.user as User).id)
      await writeAudit(ctx, {
        action: 'settings.notifications',
        entity: 'app_settings',
        summary: 'updated notification settings',
        meta: {
          lineEnabled: !!p.line_enabled,
          lineFormat: p.line_format,
          keysChanged: !!(p.moph_client_key || p.moph_secret_key || p.clear_moph_keys),
          retentionDays: p.retention_days,
        },
      })
      session.flash('message', 'บันทึกการตั้งค่าการแจ้งเตือนแล้ว')
      session.flash('messageType', 'success')
    } catch (err: any) {
      session.flash('message', err?.messages?.[0]?.message ?? err?.message ?? 'เกิดข้อผิดพลาด')
      session.flash('messageType', 'error')
    }
    return response.redirect('/admin/notification-settings')
  }

  /**
   * Send a test message with the values in the form (blank key = saved one),
   * in the selected format. Doesn't save. MOPH can answer "success" yet drop a
   * Flex card, so the page reminds the admin to check the LINE room itself.
   */
  async testLine({ request, session, response, auth }: HttpContext) {
    // Keep what was typed (never the keys) so a failed test doesn't wipe the form
    session.flashOnly(['moph_api_url', 'app_url', 'retention_days', 'line_format'])
    const current = await notificationSettings()
    const field = (name: string) => String(request.input(name) ?? '').trim()
    const clientKey = field('moph_client_key') || current.mophClientKey
    const secretKey = field('moph_secret_key') || current.mophSecretKey
    const apiUrl = field('moph_api_url') || current.mophApiUrl
    const appUrl = field('app_url') || current.appUrl
    const format = field('line_format') === 'flex' ? 'flex' : 'text'

    if (!clientKey || !secretKey) {
      session.flash('message', 'กรอก client-key และ secret-key ก่อนทดสอบ')
      session.flash('messageType', 'error')
      return response.redirect('/admin/notification-settings')
    }

    const user = auth.user as User
    const result = await sendMoph(
      { apiUrl, clientKey, secretKey },
      buildLineMessages(format, {
        text: `🔔 ทดสอบการแจ้งเตือนจาก HisReport\nโดย ${user.fullname || user.username}`,
        title: '🔔 ทดสอบการแจ้งเตือน HisReport',
        color: '#1E40AF',
        rows: [
          ['ผู้ทดสอบ', user.fullname || user.username],
          ['รูปแบบ', format === 'flex' ? 'การ์ด Flex' : 'ข้อความธรรมดา'],
        ],
        url: appUrl ? `${appUrl.replace(/\/+$/, '')}/admin/notification-settings` : null,
      }),
      { maxRetries: 0 }
    )
    session.flash(
      'message',
      result.ok
        ? 'MOPH Notify ตอบรับแล้ว — กรุณาเปิดห้อง LINE เพื่อยืนยันว่าข้อความเข้าจริง'
        : `ส่งไม่สำเร็จ — ${describeMophError(result)}`
    )
    session.flash('messageType', result.ok ? 'success' : 'error')
    return response.redirect('/admin/notification-settings')
  }
}
