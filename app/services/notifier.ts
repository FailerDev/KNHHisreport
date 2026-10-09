import logger from '@adonisjs/core/services/logger'
import { notificationSettings, type NotificationSettings } from '#services/app_settings'
import type { DateTime } from 'luxon'
import Notification from '#models/notification'
import {
  requestFlexBubble,
  sendMoph,
  type MophMessage,
  type MophTarget,
} from '#services/moph_notify'
import User from '#models/user'
import type ReportRequest from '#models/report_request'

export interface NotifyMessage {
  title: string
  body?: string | null
  link?: string | null
}

/**
 * In-app notifications (topbar bell) + optional LINE group push.
 *
 * Like `writeAudit`, failures are logged and swallowed: a notification that
 * can't be delivered must never undo a request that was already saved.
 */
export async function notifyUsers(userIds: number[], msg: NotifyMessage): Promise<void> {
  const ids = [...new Set(userIds.filter((id) => Number.isFinite(id) && id > 0))]
  if (ids.length === 0) return
  try {
    await Notification.createMany(
      ids.map((userId) => ({
        userId,
        title: msg.title.slice(0, 255),
        body: msg.body ?? null,
        link: msg.link ?? null,
      }))
    )
  } catch (err: any) {
    logger.warn({ err: err?.message ?? String(err) }, 'notification write failed')
  }
}

export async function notifyAdmins(msg: NotifyMessage, exceptUserId?: number): Promise<void> {
  try {
    const admins = await User.query().where('userLevel', 'admin').where('status', 1).select('id')
    await notifyUsers(
      admins.map((a) => a.id).filter((id) => id !== exceptUserId),
      msg
    )
  } catch (err: any) {
    logger.warn({ err: err?.message ?? String(err) }, 'notify admins failed')
  }
}

export interface LineCard {
  /** Plain-text version — the whole message in text mode, altText in flex mode */
  text: string
  title: string
  color: string
  rows: Array<[string, string]>
  url?: string | null
}

/** Text or Flex, per the "รูปแบบข้อความ" setting. */
export function buildLineMessages(format: 'text' | 'flex', card: LineCard): MophMessage[] {
  const hasUrl = !!card.url && /^https?:\/\//.test(card.url)
  if (format === 'text') {
    const text = hasUrl ? `${card.text}\n${card.url}` : card.text
    return [{ type: 'text', text: text.slice(0, 4900) }]
  }
  return [
    {
      type: 'flex',
      altText: card.text.slice(0, 400),
      contents: requestFlexBubble({
        title: card.title,
        color: card.color,
        rows: card.rows,
        url: card.url,
      }),
    },
  ]
}

export function mophTarget(settings: NotificationSettings): MophTarget | null {
  if (!settings.mophClientKey || !settings.mophSecretKey) return null
  return {
    apiUrl: settings.mophApiUrl,
    clientKey: settings.mophClientKey,
    secretKey: settings.mophSecretKey,
  }
}

/** Push to the IT room via MOPH Notify; no-op when LINE is off or not configured. */
async function pushLine(settings: NotificationSettings, card: LineCard): Promise<void> {
  const target = mophTarget(settings)
  if (!settings.lineEnabled || !target) return
  await sendMoph(target, buildLineMessages(settings.lineFormat, card))
}

async function requesterLabel(req: ReportRequest): Promise<string> {
  try {
    await req.load('requester')
    const u = req.requester
    if (!u) return '-'
    return `${u.fullname || u.username}${u.department ? ` (${u.department})` : ''}`
  } catch {
    return '-'
  }
}

function thaiDay(dt: DateTime | null): string {
  return dt ? `${dt.toFormat('dd/MM')}/${dt.year + 543}` : '-'
}

function absoluteUrl(settings: NotificationSettings, path: string): string {
  return settings.appUrl ? `${settings.appUrl.replace(/\/+$/, '')}${path}` : path
}

/**
 * Fan out a report-request event to whoever should hear about it, honouring
 * the toggles on the notification settings page. The actor never notifies
 * themself.
 */
export async function notifyRequestEvent(
  req: ReportRequest,
  action: string,
  actorId: number | null,
  note?: string | null
): Promise<void> {
  let settings: NotificationSettings
  try {
    settings = await notificationSettings()
  } catch (err: any) {
    logger.warn({ err: err?.message ?? String(err) }, 'load notification settings failed')
    return
  }
  const { events } = settings
  const own = `/requests/${req.id}`
  const adminLink = `/admin/requests/${req.id}`
  const toRequester = (msg: NotifyMessage) =>
    events.requesterUpdates && req.requesterId !== actorId
      ? notifyUsers([req.requesterId], msg)
      : Promise.resolve()

  switch (action) {
    case 'create':
      if (events.adminNewRequest) {
        await notifyAdmins(
          { title: `คำขอใหม่ ${req.reqNo}`, body: req.title, link: adminLink },
          actorId ?? undefined
        )
      }
      if (events.lineNewRequest) {
        const who = await requesterLabel(req)
        const identifiable = req.dataLevel === 'identifiable'
        await pushLine(settings, {
          text:
            `📥 คำขอข้อมูลใหม่ ${req.reqNo}\n${req.title}\nผู้ขอ: ${who}` +
            (identifiable ? '\n⚠️ ข้อมูลรายบุคคล' : ''),
          title: `📥 คำขอข้อมูลใหม่ ${req.reqNo}`,
          color: identifiable ? '#B91C1C' : '#1E40AF',
          rows: [
            ['เรื่อง', req.title],
            ['ผู้ขอ', who],
            ['ระดับข้อมูล', identifiable ? '⚠️ รายบุคคล' : 'ข้อมูลสรุป'],
            ['ต้องการภายใน', thaiDay(req.dueDate)],
          ],
          url: absoluteUrl(settings, adminLink),
        })
      }
      break
    case 'approve':
      await toRequester({
        title: `${req.reqNo} อนุมัติแล้ว — กำลังจัดทำ`,
        body: note ?? req.title,
        link: own,
      })
      break
    case 'reject':
      await toRequester({ title: `${req.reqNo} ไม่ได้รับอนุมัติ`, body: note ?? null, link: own })
      break
    case 'complete':
      await toRequester({
        title: `${req.reqNo} จัดทำเสร็จแล้ว`,
        body: 'ดาวน์โหลดไฟล์ได้ที่หน้าคำขอ',
        link: own,
      })
      if (events.lineCompleted) {
        await pushLine(settings, {
          text: `✅ ปิดงาน ${req.reqNo}\n${req.title}`,
          title: `✅ ปิดงาน ${req.reqNo}`,
          color: '#15803D',
          rows: [
            ['เรื่อง', req.title],
            ['ผู้ขอ', await requesterLabel(req)],
          ],
          url: absoluteUrl(settings, adminLink),
        })
      }
      break
    case 'cancel':
      if (req.assignedTo) {
        await notifyUsers([req.assignedTo], {
          title: `${req.reqNo} ถูกยกเลิกโดยผู้ขอ`,
          link: adminLink,
        })
      } else {
        await notifyAdmins(
          { title: `${req.reqNo} ถูกยกเลิกโดยผู้ขอ`, link: adminLink },
          actorId ?? undefined
        )
      }
      break
    case 'purge':
      await toRequester({
        title: `ไฟล์ของ ${req.reqNo} ถูกลบตามระยะเวลาจัดเก็บ`,
        body: 'หากต้องการข้อมูลอีกครั้ง กรุณาส่งคำขอใหม่',
        link: own,
      })
      break
  }
}

export async function unreadNotifications(userId: number) {
  const items = await Notification.query()
    .where('userId', userId)
    .whereNull('readAt')
    .orderBy('id', 'desc')
    .limit(10)
  const [{ $extras }] = await Notification.query()
    .where('userId', userId)
    .whereNull('readAt')
    .count('* as total')
  return { items, count: Number($extras.total) }
}
