import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import db from '@adonisjs/lucid/services/db'
import ReportHead from '#models/report_head'
import ReportHeadDetail from '#models/report_head_detail'

const headValidator = vine.compile(
  vine.object({
    detail: vine.string().trim().minLength(1).maxLength(255),
    sort: vine.string().trim().transform((v) => Math.max(1, Number(v) || 1)).optional(),
  })
)

const headIdValidator = vine.compile(
  vine.object({ id: vine.string().trim().transform((v) => Number(v)) })
)

const detailValidator = vine.compile(
  vine.object({
    head_id: vine.string().trim().transform((v) => Number(v)),
    detail: vine.string().trim().minLength(1).maxLength(255),
    sql1: vine.string().minLength(1),
    sql2: vine.string().optional(),
    database_source: vine.enum(['system', 'his']),
    sort: vine.string().trim().transform((v) => Math.max(1, Number(v) || 1)).optional(),
  })
)

const detailUpdateValidator = vine.compile(
  vine.object({
    id: vine.string().trim().transform((v) => Number(v)),
    head_id: vine.string().trim().transform((v) => Number(v)),
    detail: vine.string().trim().minLength(1).maxLength(255),
    sql1: vine.string().minLength(1),
    sql2: vine.string().optional(),
    database_source: vine.enum(['system', 'his']),
    sort: vine.string().trim().transform((v) => Math.max(1, Number(v) || 1)).optional(),
  })
)

const testSqlValidator = vine.compile(
  vine.object({
    sql1: vine.string().minLength(1),
    database_source: vine.enum(['system', 'his']),
  })
)

const FORBIDDEN_SQL = /\b(DROP|DELETE|TRUNCATE|ALTER|CREATE|INSERT|UPDATE|GRANT|REVOKE|EXEC)\b/i

function assertSafeSql(sql: string): void {
  if (FORBIDDEN_SQL.test(sql)) {
    throw new Error('SQL นี้มีคำสั่งที่ไม่ปลอดภัย (อนุญาตเฉพาะ SELECT / SHOW)')
  }
}

export default class ReportSettingsController {
  /**
   * GET /admin/report-settings — list categories and their reports.
   */
  async index({ view, session }: HttpContext) {
    const heads = await ReportHead.query().where('status', 1).orderBy('sort', 'asc')
    const reportsByHead: Record<number, ReportHeadDetail[]> = {}
    for (const h of heads) {
      const list = await ReportHeadDetail.query()
        .where('headId', h.id)
        .where('status', 1)
        .orderBy('sort', 'asc')
      reportsByHead[h.id] = list
    }
    return view.render('pages/admin/report_settings', {
      heads,
      reportsByHead,
      message: session.flashMessages.get('message'),
      messageType: session.flashMessages.get('messageType'),
    })
  }

  async storeHead({ request, session, response }: HttpContext) {
    try {
      const payload = await headValidator.validate(request.only(['detail', 'sort']))
      await ReportHead.create({ detail: payload.detail, sort: payload.sort ?? 1, status: 1 })
      this.flashOk(session, 'เพิ่มหมวดหมู่สำเร็จ')
    } catch (err: any) {
      this.flashErr(session, err)
    }
    return response.redirect().back()
  }

  async updateHead({ request, session, response }: HttpContext) {
    try {
      const payload = await headValidator.validate(request.only(['detail', 'sort']))
      const { id } = await headIdValidator.validate(request.only(['id']))
      const head = await ReportHead.find(id)
      if (!head) throw new Error('ไม่พบหมวดหมู่')
      head.detail = payload.detail
      head.sort = payload.sort ?? head.sort
      await head.save()
      this.flashOk(session, 'อัพเดทหมวดหมู่สำเร็จ')
    } catch (err: any) {
      this.flashErr(session, err)
    }
    return response.redirect().back()
  }

  async destroyHead({ request, session, response }: HttpContext) {
    try {
      const { id } = await headIdValidator.validate(request.only(['id']))
      const childCount = await ReportHeadDetail.query()
        .where('headId', id)
        .where('status', 1)
        .count('* as total')
      const total = Number((childCount[0] as any)?.$extras?.total ?? 0)
      if (total > 0) throw new Error(`ไม่สามารถลบได้: มีรายงานในหมวดหมู่นี้ ${total} รายการ`)
      const head = await ReportHead.find(id)
      if (!head) throw new Error('ไม่พบหมวดหมู่')
      head.status = 0
      await head.save()
      this.flashOk(session, 'ลบหมวดหมู่สำเร็จ')
    } catch (err: any) {
      this.flashErr(session, err)
    }
    return response.redirect().back()
  }

  async storeDetail({ request, session, response }: HttpContext) {
    try {
      const payload = await detailValidator.validate(request.all())
      assertSafeSql(payload.sql1)
      if (payload.sql2) assertSafeSql(payload.sql2)
      await ReportHeadDetail.create({
        headId: payload.head_id,
        detail: payload.detail,
        sql1: payload.sql1,
        sql2: payload.sql2 ?? null,
        databaseSource: payload.database_source,
        sort: payload.sort ?? 1,
        status: 1,
      })
      this.flashOk(session, 'เพิ่มรายงานสำเร็จ')
    } catch (err: any) {
      this.flashErr(session, err)
    }
    return response.redirect().back()
  }

  async updateDetail({ request, session, response }: HttpContext) {
    try {
      const payload = await detailUpdateValidator.validate(request.all())
      assertSafeSql(payload.sql1)
      if (payload.sql2) assertSafeSql(payload.sql2)
      const r = await ReportHeadDetail.find(payload.id)
      if (!r) throw new Error('ไม่พบรายงาน')
      r.headId = payload.head_id
      r.detail = payload.detail
      r.sql1 = payload.sql1
      r.sql2 = payload.sql2 ?? null
      r.databaseSource = payload.database_source
      r.sort = payload.sort ?? r.sort
      await r.save()
      this.flashOk(session, 'อัพเดทรายงานสำเร็จ')
    } catch (err: any) {
      this.flashErr(session, err)
    }
    return response.redirect().back()
  }

  async destroyDetail({ request, session, response }: HttpContext) {
    try {
      const { id } = await headIdValidator.validate(request.only(['id']))
      const r = await ReportHeadDetail.find(id)
      if (!r) throw new Error('ไม่พบรายงาน')
      r.status = 0
      await r.save()
      this.flashOk(session, 'ลบรายงานสำเร็จ')
    } catch (err: any) {
      this.flashErr(session, err)
    }
    return response.redirect().back()
  }

  /**
   * POST /admin/report-settings/test-sql — AJAX SQL test against the chosen
   * connection. Returns JSON. Refuses dangerous statements before executing.
   */
  async testSql({ request, response }: HttpContext) {
    try {
      const payload = await testSqlValidator.validate(request.only(['sql1', 'database_source']))
      assertSafeSql(payload.sql1)

      const connection = payload.database_source === 'his' ? 'his' : 'mysql'
      if (connection === 'his' && !db.manager.has('his')) {
        return response.json({
          success: false,
          message: 'ยังไม่ได้ตั้งค่าการเชื่อมต่อ HIS Database',
          source: payload.database_source,
        })
      }

      const start = Date.now()
      try {
        const result = (await db.connection(connection).rawQuery(payload.sql1)) as any
        const rows: any[] = Array.isArray(result?.[0]) ? result[0] : Array.isArray(result) ? result : []
        const elapsed = ((Date.now() - start) / 1000).toFixed(3)
        return response.json({
          success: true,
          message: `ทดสอบ SQL สำเร็จ — พบข้อมูล ${rows.length} แถว`,
          row_count: rows.length,
          columns: rows[0] ? Object.keys(rows[0]) : [],
          sample: rows.slice(0, 5),
          execution_time: Number(elapsed),
          source: payload.database_source,
        })
      } catch (err: any) {
        return response.json({
          success: false,
          message: `ทดสอบ SQL ล้มเหลว: ${err?.message ?? String(err)}`,
          source: payload.database_source,
        })
      }
    } catch (err: any) {
      return response.json({
        success: false,
        message: err?.messages?.[0]?.message ?? err?.message ?? 'เกิดข้อผิดพลาด',
      })
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
