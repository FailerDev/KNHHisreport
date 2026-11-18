import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import { buildReportXlsx, reportXlsxFilename } from '#services/report_excel'
import {
  defaultStatsRange,
  requestStats,
  requestStatsRows,
  type StatsRange,
} from '#services/report_request_stats'
import { requestStatsValidator } from '#validators/report_request'

/** สรุปการขอรายงาน — admin report on the request module itself. */
export default class AdminRequestStatsController {
  async index({ request, view }: HttpContext) {
    const { range, error } = await this.range(request.qs())
    return view.render('pages/admin/requests/report', {
      stats: await requestStats(range),
      from: range.from.toISODate(),
      to: range.to.toISODate(),
      rangeError: error,
    })
  }

  async export({ request, response }: HttpContext) {
    const { range } = await this.range(request.qs())
    const rows = await requestStatsRows(range)
    const title = 'สรุปการขอรายงาน'
    const buf = await buildReportXlsx(
      title,
      {
        rows,
        columns: rows.length > 0 ? Object.keys(rows[0]) : [],
        count: rows.length,
        sql: '',
        source: 'system',
      },
      { ตั้งแต่: range.from.toISODate()!, ถึง: range.to.toISODate()! },
      []
    )
    response.header(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    response.header(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(reportXlsxFilename(title))}"`
    )
    return response.send(buf)
  }

  /** Range from ?from=&to=, falling back to the current fiscal year. */
  private async range(
    qs: Record<string, unknown>
  ): Promise<{ range: StatsRange; error: string | null }> {
    const fallback = defaultStatsRange()
    try {
      const { from, to } = await requestStatsValidator.validate(qs)
      const f = from ? DateTime.fromISO(from) : fallback.from
      const t = to ? DateTime.fromISO(to) : fallback.to
      if (!f.isValid || !t.isValid) return { range: fallback, error: 'วันที่ไม่ถูกต้อง' }
      if (t < f) return { range: fallback, error: 'วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น' }
      return { range: { from: f, to: t }, error: null }
    } catch {
      return { range: fallback, error: 'วันที่ไม่ถูกต้อง' }
    }
  }
}
