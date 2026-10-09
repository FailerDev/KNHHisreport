import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { notificationSettings } from '#services/app_settings'
import hisDb from '#services/his_db'
import { statusCounts } from '#services/report_request_service'

/**
 * /admin/settings — one landing page for every admin setting, grouped by
 * area, each card showing the current state so problems are visible at a
 * glance.
 */
export default class SettingsController {
  async index({ view }: HttpContext) {
    const count = async (table: string, where?: Record<string, unknown>) => {
      const q = db.from(table).count('* as total')
      if (where) q.where(where)
      const [row] = await q
      return Number(row?.total ?? 0)
    }

    const [users, admins, heads, reports, dashboardItems, requests, his] = await Promise.all([
      count('users'),
      count('users', { user_level: 'admin' }),
      count('report_head'),
      count('report_head_detail'),
      count('bpdashboard_head_index'),
      statusCounts(),
      hisDb.checkStatus(),
    ])

    return view.render('pages/admin/settings', {
      stats: { users, admins, heads, reports, dashboardItems },
      requests,
      his,
      notify: await notificationSettings(),
    })
  }
}
