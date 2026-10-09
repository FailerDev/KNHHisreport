import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import Notification from '#models/notification'
import type User from '#models/user'

/** Topbar bell: open one notification (marks it read) or mark all read. */
export default class NotificationsController {
  async open({ params, auth, response }: HttpContext) {
    const user = auth.user as User
    const n = await Notification.query()
      .where('id', Number(params.id))
      .where('userId', user.id)
      .first()
    if (!n) return response.redirect().back()
    if (!n.readAt) {
      n.readAt = DateTime.now()
      await n.save()
    }
    // Only follow in-app paths — never an absolute URL stored in the row.
    const link = n.link && n.link.startsWith('/') && !n.link.startsWith('//') ? n.link : '/'
    return response.redirect(link)
  }

  async readAll({ auth, response }: HttpContext) {
    const user = auth.user as User
    await Notification.query()
      .where('userId', user.id)
      .whereNull('readAt')
      .update({ read_at: DateTime.now().toSQL({ includeOffset: false }) })
    return response.redirect().back()
  }
}
