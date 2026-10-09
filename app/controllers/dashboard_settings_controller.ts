import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import DashboardItem from '#models/dashboard_item'
import ReportHeadDetail from '#models/report_head_detail'
import dashboardDataCache from '#services/dashboard_cache'
import { writeAudit } from '#services/audit'
import {
  assertReadOnlySql,
  describeHisError,
  isConnectionError,
  probeHisQuery,
  PROBE_ROW_LIMIT,
} from '#services/his_sql_guard'
import {
  buildDashboardItemAttributes,
  sqlToVerify,
  type DashboardItemInput,
} from '#services/dashboard_item_form'

const CHART_TYPES = ['none', 'pie', 'bar', 'line', 'doughnut'] as const
const COLOR_CHOICES = ['icon-info', 'icon-success', 'icon-warning', 'icon-danger'] as const
const CHART_COLORS = ['default', 'blue', 'green', 'red', 'purple', 'orange'] as const

const itemFields = {
  detail: vine.string().trim().minLength(1).maxLength(255),
  sql1: vine.string().minLength(1),
  // Empty → NULL = hidden from /dashboard (legacy semantics).
  sort: vine.number().withoutDecimals().min(0).max(99999).nullable().optional(),
  link_id: vine.string().trim().maxLength(255).nullable().optional(),
  icons: vine.string().trim().maxLength(100).nullable().optional(),
  color1: vine.enum(COLOR_CHOICES).nullable().optional(),
  chart_type: vine.enum(CHART_TYPES),
  chart_name: vine.string().trim().maxLength(255).nullable().optional(),
  chart_sql: vine.string().nullable().optional(),
  chart_color: vine.enum(CHART_COLORS).nullable().optional(),
}

const itemValidator = vine.compile(vine.object(itemFields))

const updateValidator = vine.compile(
  vine.object({ id: vine.number().withoutDecimals().positive(), ...itemFields })
)

const idValidator = vine.compile(vine.object({ id: vine.number().withoutDecimals().positive() }))

const testSqlValidator = vine.compile(
  vine.object({
    sql_to_test: vine.string().minLength(1),
    kind: vine.enum(['main', 'chart'] as const).optional(),
  })
)

export default class DashboardSettingsController {
  async index({ view, session }: HttpContext) {
    const items = await DashboardItem.query().orderByRaw('sort IS NULL').orderBy('sort', 'asc').orderBy('id', 'asc')

    // "Link to report" dropdown: active reports, plus any report a tile
    // already links to (even if disabled) so editing doesn't drop the link.
    const linkedIds = items
      .map((i) => Number(i.linkId))
      .filter((n) => Number.isInteger(n) && n > 0)
    const availableReports = await ReportHeadDetail.query()
      .where((q) => {
        q.where('status', 1)
        if (linkedIds.length) q.orWhereIn('id', linkedIds)
      })
      .orderBy('detail', 'asc')
      .select('id', 'detail', 'status')

    const total = items.length
    const withChart = items.filter((i) => (i.chartType ?? 'none') !== 'none').length
    const hidden = items.filter((i) => i.sort === null).length

    return view.render('pages/admin/dashboard_settings', {
      items,
      availableReports,
      stats: { total, withChart, hidden },
      message: session.flashMessages.get('message'),
      messageType: session.flashMessages.get('messageType'),
    })
  }

  /**
   * AJAX SQL test against HIS. Returns JSON for the modal. Only the first
   * PROBE_ROW_LIMIT rows are fetched. For chart kind, also auto-detects the
   * value column (first numeric col after the label).
   */
  async testSql({ request, response }: HttpContext) {
    try {
      const payload = await testSqlValidator.validate(request.only(['sql_to_test', 'kind']))
      assertReadOnlySql(payload.sql_to_test)

      if (!db.manager.has('his')) {
        return response.json({
          success: false,
          message: 'ยังไม่ได้ตั้งค่าการเชื่อมต่อ HIS Database',
        })
      }

      const { rows, truncated, execMs } = await probeHisQuery(payload.sql_to_test)
      const columns = rows[0] ? Object.keys(rows[0]) : []

      const resp: any = {
        success: true,
        kind: payload.kind ?? 'main',
        rows: rows.length,
        truncated,
        row_limit: PROBE_ROW_LIMIT,
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
        message: err?.messages?.[0]?.message ?? describeHisError(err),
      })
    }
  }

  async store(ctx: HttpContext) {
    const { request } = ctx
    try {
      const payload = (await itemValidator.validate(request.all())) as DashboardItemInput
      await this.validateAgainstHis(payload, sqlToVerify(payload))

      const created = await DashboardItem.create({
        ...buildDashboardItemAttributes(payload),
        timeStamp: DateTime.now(),
      })
      dashboardDataCache.invalidate()
      await writeAudit(ctx, {
        action: 'dashboard_item.create',
        entity: 'dashboard_item',
        entityId: created.id,
        summary: `created dashboard tile "${created.detail}" (chart=${created.chartType})`,
      })
      return this.ok(ctx, 'เพิ่มรายการแดชบอร์ดสำเร็จ')
    } catch (err: any) {
      return this.fail(ctx, err)
    }
  }

  async update(ctx: HttpContext) {
    const { request } = ctx
    try {
      const payload = (await updateValidator.validate(request.all())) as DashboardItemInput & { id: number }
      const item = await DashboardItem.find(payload.id)
      if (!item) throw new Error('ไม่พบรายการที่จะแก้ไข')
      await this.validateAgainstHis(payload, sqlToVerify(payload, item))

      item.merge({
        ...buildDashboardItemAttributes(payload, item),
        timeStamp: DateTime.now(),
      })
      await item.save()
      dashboardDataCache.invalidate()
      await writeAudit(ctx, {
        action: 'dashboard_item.update',
        entity: 'dashboard_item',
        entityId: item.id,
        summary: `updated dashboard tile "${item.detail}"`,
      })
      return this.ok(ctx, 'อัพเดทรายการสำเร็จ')
    } catch (err: any) {
      return this.fail(ctx, err)
    }
  }

  async destroy(ctx: HttpContext) {
    const { request } = ctx
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
      return this.ok(ctx, 'ลบรายการสำเร็จ')
    } catch (err: any) {
      return this.fail(ctx, err)
    }
  }

  /**
   * Smoke-test changed SQL against HIS at create/update time. Main SQL must
   * run; chart SQL (when chart_type≠'none') must run AND, if it returns rows,
   * return ≥2 columns. Empty result sets are allowed. SQL the admin didn't
   * change is not re-run, so tiles stay editable while HIS is down.
   */
  private async validateAgainstHis(
    payload: DashboardItemInput,
    verify: { main: boolean; chart: boolean }
  ): Promise<void> {
    const isChart = payload.chart_type !== 'none'
    if (isChart && !payload.chart_sql?.trim()) {
      throw new Error('กรุณากรอก SQL สำหรับกราฟ')
    }
    // Static checks first — no HIS round-trip needed to reject unsafe SQL.
    if (verify.main) this.guard('SQL หลัก', payload.sql1)
    if (verify.chart) this.guard('SQL กราฟ', payload.chart_sql!)
    if (!verify.main && !verify.chart) return

    if (!db.manager.has('his')) {
      throw new Error('ยังไม่ได้ตั้งค่าการเชื่อมต่อ HIS จึงตรวจสอบ SQL ที่แก้ไขไม่ได้')
    }

    if (verify.main) {
      await this.probe('SQL หลัก', payload.sql1)
    }
    if (verify.chart) {
      const { rows } = await this.probe('SQL กราฟ', payload.chart_sql!)
      if (rows.length > 0 && Object.keys(rows[0]).length < 2) {
        throw new Error('SQL กราฟต้องคืนค่าอย่างน้อย 2 คอลัมน์ (label, value)')
      }
    }
  }

  private guard(label: string, sql: string) {
    try {
      assertReadOnlySql(sql)
    } catch (e: any) {
      throw new Error(`${label}: ${e.message}`)
    }
  }

  private async probe(label: string, sql: string) {
    try {
      return await probeHisQuery(sql, { limit: 5 })
    } catch (e: any) {
      if (isConnectionError(e)) {
        throw new Error(`${describeHisError(e)} — จึงตรวจสอบ${label}ที่แก้ไขไม่ได้ กรุณาลองใหม่เมื่อ HIS พร้อม`)
      }
      throw new Error(`${label}ไม่ถูกต้อง: ${describeHisError(e)}`)
    }
  }

  private wantsJson({ request }: HttpContext) {
    return request.accepts(['html', 'json']) === 'json'
  }

  /** Success: JSON for the AJAX modal (page reloads to show the flash), redirect otherwise. */
  private ok(ctx: HttpContext, msg: string) {
    ctx.session.flash('message', msg)
    ctx.session.flash('messageType', 'success')
    if (this.wantsJson(ctx)) return ctx.response.json({ success: true, message: msg })
    return ctx.response.redirect().back()
  }

  /** Failure: JSON keeps the modal open with the admin's input intact. */
  private fail(ctx: HttpContext, err: any) {
    const msg = err?.messages?.[0]?.message ?? err?.message ?? 'เกิดข้อผิดพลาด'
    if (this.wantsJson(ctx)) {
      return ctx.response.status(422).json({ success: false, message: msg, field: err?.messages?.[0]?.field })
    }
    ctx.session.flash('message', msg)
    ctx.session.flash('messageType', 'error')
    return ctx.response.redirect().back()
  }
}
