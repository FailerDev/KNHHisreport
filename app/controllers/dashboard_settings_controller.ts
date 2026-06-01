import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import DashboardItem from '#models/dashboard_item'
import ReportHeadDetail from '#models/report_head_detail'
import dashboardDataCache from '#services/dashboard_cache'
import { writeAudit } from '#services/audit'

const CHART_TYPES = ['none', 'pie', 'bar', 'line', 'doughnut'] as const
const COLOR_CHOICES = ['icon-info', 'icon-success', 'icon-warning', 'icon-danger'] as const
const CHART_COLORS = ['default', 'blue', 'green', 'red', 'purple', 'orange'] as const

const FORBIDDEN_SQL = /\b(DROP|DELETE|TRUNCATE|ALTER|CREATE|INSERT|UPDATE|GRANT|REVOKE|EXEC)\b/i
function assertSafeSql(sql: string): void {
  if (FORBIDDEN_SQL.test(sql)) {
    throw new Error('SQL นี้มีคำสั่งที่ไม่ปลอดภัย (อนุญาตเฉพาะ SELECT / SHOW)')
  }
}

const itemValidator = vine.compile(
  vine.object({
    detail: vine.string().trim().minLength(1).maxLength(255),
    sql1: vine.string().minLength(1),
    sort: vine.string().trim().transform((v) => Math.max(1, Number(v) || 1)).optional(),
    link_id: vine.string().trim().optional(),
    icons: vine.string().trim().maxLength(100).optional(),
    color1: vine.enum(COLOR_CHOICES).optional(),
    chart_type: vine.enum(CHART_TYPES),
    chart_name: vine.string().trim().maxLength(255).optional(),
    chart_sql: vine.string().optional(),
    chart_color: vine.enum(CHART_COLORS).optional(),
  })
)

const updateValidator = vine.compile(
  vine.object({
    id: vine.string().trim().transform((v) => Number(v)),
    detail: vine.string().trim().minLength(1).maxLength(255),
    sql1: vine.string().minLength(1),
    sort: vine.string().trim().transform((v) => Math.max(1, Number(v) || 1)).optional(),
    link_id: vine.string().trim().optional(),
    icons: vine.string().trim().maxLength(100).optional(),
    color1: vine.enum(COLOR_CHOICES).optional(),
    chart_type: vine.enum(CHART_TYPES),
    chart_name: vine.string().trim().maxLength(255).optional(),
    chart_sql: vine.string().optional(),
    chart_color: vine.enum(CHART_COLORS).optional(),
  })
)

const idValidator = vine.compile(
  vine.object({ id: vine.string().trim().transform((v) => Number(v)) })
)

const testSqlValidator = vine.compile(
  vine.object({
    sql_to_test: vine.string().minLength(1),
    kind: vine.enum(['main', 'chart'] as const).optional(),
  })
)

export default class DashboardSettingsController {
  async index({ view, session }: HttpContext) {
    const items = await DashboardItem.query().orderBy('sort', 'asc').orderBy('id', 'asc')
    // For the "link to report" dropdown.
    const availableReports = await ReportHeadDetail.query()
      .where('status', 1)
      .orderBy('detail', 'asc')
      .select('id', 'detail')

    const total = items.length
    const withChart = items.filter((i) => (i.chartType ?? 'none') !== 'none').length

    return view.render('pages/admin/dashboard_settings', {
      items,
      availableReports,
      stats: { total, withChart },
      message: session.flashMessages.get('message'),
      messageType: session.flashMessages.get('messageType'),
    })
  }

  /**
   * AJAX SQL test against HIS. Returns JSON for the modal.
   * For chart kind, also auto-detects the value column (first numeric col
   * after the label).
   */
  async testSql({ request, response }: HttpContext) {
    try {
      const payload = await testSqlValidator.validate(request.only(['sql_to_test', 'kind']))
      assertSafeSql(payload.sql_to_test)

      if (!db.manager.has('his')) {
        return response.json({
          success: false,
          message: 'ยังไม่ได้ตั้งค่าการเชื่อมต่อ HIS Database',
        })
      }

      const start = Date.now()
      const result = (await db.connection('his').rawQuery(payload.sql_to_test)) as any
      const rows: any[] = Array.isArray(result?.[0]) ? result[0] : Array.isArray(result) ? result : []
      const execMs = Date.now() - start
      const columns = rows[0] ? Object.keys(rows[0]) : []

      const resp: any = {
        success: true,
        kind: payload.kind ?? 'main',
        rows: rows.length,
        columns,
        sample: rows.slice(0, 3),
        exec_ms: execMs,
      }

      if (payload.kind === 'chart' && rows.length > 0) {
        const first = rows[0]
        const keys = Object.keys(first)
        if (keys.length < 2) {
          resp.warning = 'SQL กราฟต้องคืนอย่างน้อย 2 คอลัมน์ (label, value)'
        } else {
          let valueKey = keys[1]
          for (let i = 1; i < keys.length; i++) {
            const c = first[keys[i]]
            if (typeof c === 'number' || (typeof c === 'string' && !Number.isNaN(Number(c.trim())))) {
              valueKey = keys[i]
              break
            }
          }
          resp.detected_label = keys[0]
          resp.detected_value = valueKey
          if (typeof first[keys[1]] !== 'number' && valueKey !== keys[1]) {
            resp.warning = `คอลัมน์ที่ 2 ("${keys[1]}") ไม่ใช่ตัวเลข — ระบบเลือก "${valueKey}" เป็นค่ากราฟแทน`
          }
        }
      }

      return response.json(resp)
    } catch (err: any) {
      return response.json({
        success: false,
        message: err?.messages?.[0]?.message ?? err?.message ?? 'เกิดข้อผิดพลาด',
      })
    }
  }

  async store(ctx: HttpContext) {
    const { request, session, response } = ctx
    try {
      const payload = await itemValidator.validate(request.all())
      await this.validateAgainstHis(payload)

      const isChart = payload.chart_type !== 'none'
      const created = await DashboardItem.create({
        detail: payload.detail,
        sql1: payload.sql1,
        sort: payload.sort ?? 1,
        linkId: payload.link_id?.trim() ? payload.link_id : null,
        icons: payload.icons || 'ti-bar-chart',
        color1: payload.color1 || 'icon-info',
        pieName: isChart ? payload.chart_name ?? '' : '',
        pieShow: isChart ? 'y' : 'n',
        chartType: payload.chart_type,
        chartSql: isChart ? payload.chart_sql ?? '' : '',
        chartColor: isChart ? payload.chart_color ?? 'default' : 'default',
        timeStamp: DateTime.now(),
      })
      dashboardDataCache.invalidate()
      await writeAudit(ctx, {
        action: 'dashboard_item.create',
        entity: 'dashboard_item',
        entityId: created.id,
        summary: `created dashboard tile "${created.detail}" (chart=${created.chartType})`,
      })
      this.flashOk(session, 'เพิ่มรายการแดชบอร์ดสำเร็จ')
    } catch (err: any) {
      this.flashErr(session, err)
    }
    return response.redirect().back()
  }

  async update(ctx: HttpContext) {
    const { request, session, response } = ctx
    try {
      const payload = await updateValidator.validate(request.all())
      const item = await DashboardItem.find(payload.id)
      if (!item) throw new Error('ไม่พบรายการที่จะแก้ไข')
      await this.validateAgainstHis(payload)

      const isChart = payload.chart_type !== 'none'
      item.detail = payload.detail
      item.sql1 = payload.sql1
      item.sort = payload.sort ?? item.sort ?? 1
      item.linkId = payload.link_id?.trim() ? payload.link_id : null
      item.icons = payload.icons || 'ti-bar-chart'
      item.color1 = payload.color1 || 'icon-info'
      item.pieName = isChart ? payload.chart_name ?? '' : ''
      item.pieShow = isChart ? 'y' : 'n'
      item.chartType = payload.chart_type
      item.chartSql = isChart ? payload.chart_sql ?? '' : ''
      item.chartColor = isChart ? payload.chart_color ?? 'default' : 'default'
      item.timeStamp = DateTime.now()
      await item.save()
      dashboardDataCache.invalidate()
      await writeAudit(ctx, {
        action: 'dashboard_item.update',
        entity: 'dashboard_item',
        entityId: item.id,
        summary: `updated dashboard tile "${item.detail}"`,
      })
      this.flashOk(session, 'อัพเดทรายการสำเร็จ')
    } catch (err: any) {
      this.flashErr(session, err)
    }
    return response.redirect().back()
  }

  async destroy(ctx: HttpContext) {
    const { request, session, response } = ctx
    try {
      const { id } = await idValidator.validate(request.only(['id']))
      const item = await DashboardItem.find(id)
      if (!item) throw new Error('ไม่พบรายการ')
      const titleBefore = item.detail
      await item.delete()
      dashboardDataCache.invalidate()
      await writeAudit(ctx, {
        action: 'dashboard_item.delete',
        entity: 'dashboard_item',
        entityId: id,
        summary: `deleted dashboard tile "${titleBefore}"`,
      })
      this.flashOk(session, 'ลบรายการสำเร็จ')
    } catch (err: any) {
      this.flashErr(session, err)
    }
    return response.redirect().back()
  }

  /**
   * Smoke-test the SQL by actually running it against HIS at create/update
   * time. Mirrors the legacy PHP validation: main SQL must run; chart SQL
   * (when chart_type≠'none') must run AND, if it returns rows, return ≥2
   * columns. Empty result sets are allowed (chart with no data today is fine).
   */
  private async validateAgainstHis(payload: {
    sql1: string
    chart_type: string
    chart_sql?: string | undefined
  }): Promise<void> {
    assertSafeSql(payload.sql1)
    if (!db.manager.has('his')) throw new Error('ยังไม่ได้ตั้งค่าการเชื่อมต่อ HIS')

    try {
      const r = (await db.connection('his').rawQuery(payload.sql1)) as any
      if (!Array.isArray(r?.[0]) && !Array.isArray(r)) {
        throw new Error('SQL หลักคืนค่าไม่ถูกต้อง')
      }
    } catch (e: any) {
      throw new Error(`SQL หลักไม่ถูกต้อง: ${e?.message ?? e}`)
    }

    if (payload.chart_type === 'none') return
    if (!payload.chart_sql || !payload.chart_sql.trim()) {
      throw new Error('กรุณากรอก SQL สำหรับกราฟ')
    }
    assertSafeSql(payload.chart_sql)
    try {
      const cr = (await db.connection('his').rawQuery(payload.chart_sql)) as any
      const rows: any[] = Array.isArray(cr?.[0]) ? cr[0] : Array.isArray(cr) ? cr : []
      if (rows.length > 0 && Object.keys(rows[0]).length < 2) {
        throw new Error('SQL กราฟต้องคืนค่าอย่างน้อย 2 คอลัมน์ (label, value)')
      }
    } catch (e: any) {
      throw new Error(`SQL กราฟไม่ถูกต้อง: ${e?.message ?? e}`)
    }
  }

  private flashOk(session: HttpContext['session'], msg: string) {
    session.flash('message', msg)
    session.flash('messageType', 'success')
  }

  private flashErr(session: HttpContext['session'], err: any) {
    const msg = err?.messages?.[0]?.message ?? err?.message ?? 'เกิดข้อผิดพลาด'
    session.flash('message', msg)
    session.flash('messageType', 'error')
  }
}
