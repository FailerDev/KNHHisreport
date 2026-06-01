import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import ReportHeadDetail from '#models/report_head_detail'
import ReportParameter from '#models/report_parameter'
import ReportRunner from '#services/report_runner'

const PARAM_TYPES = ['text', 'number', 'date', 'select', 'datetime', 'textarea'] as const

const addValidator = vine.compile(
  vine.object({
    param_name: vine.string().trim().minLength(1).maxLength(50).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
    param_label: vine.string().trim().minLength(1).maxLength(100),
    param_type: vine.enum(PARAM_TYPES),
    param_default: vine.string().trim().maxLength(255).optional(),
    param_required: vine.string().optional(),
    options: vine.string().optional(),
    sort_order: vine.string().trim().transform((v) => Math.max(1, Number(v) || 1)).optional(),
  })
)

const updateValidator = vine.compile(
  vine.object({
    id: vine.string().trim().transform((v) => Number(v)),
    param_name: vine.string().trim().minLength(1).maxLength(50).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
    param_label: vine.string().trim().minLength(1).maxLength(100),
    param_type: vine.enum(PARAM_TYPES),
    param_default: vine.string().trim().maxLength(255).optional(),
    param_required: vine.string().optional(),
    options: vine.string().optional(),
    sort_order: vine.string().trim().transform((v) => Math.max(1, Number(v) || 1)).optional(),
  })
)

const idValidator = vine.compile(
  vine.object({ id: vine.string().trim().transform((v) => Number(v)) })
)

function normalizeOptions(type: string, raw: string | undefined): string | null {
  if (type !== 'select' || !raw) return raw ? raw : null
  const trimmed = raw.trim()
  if (!trimmed) return null
  // Accept either a JSON array or comma-separated values (legacy form).
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return JSON.stringify(parsed.map((o) => String(o)))
  } catch {
    /* fall through */
  }
  const arr = trimmed.split(',').map((s) => s.trim()).filter((s) => s !== '')
  return JSON.stringify(arr)
}

export default class ReportParametersController {
  /**
   * GET /admin/reports/:reportId/parameters
   */
  async index({ params, view, response, session }: HttpContext) {
    const reportId = Number(params.reportId)
    const report = await ReportHeadDetail.find(reportId)
    if (!report) return response.redirect('/admin/report-settings')
    const list = await ReportParameter.query()
      .where('reportId', reportId)
      .orderBy('sortOrder', 'asc')
      .orderBy('paramName', 'asc')
    const detected = ReportRunner.detectParameters(report.sql1 ?? '')
    const configuredNames = new Set(list.map((p) => p.paramName))
    const undefinedDetected = detected.filter((d) => !configuredNames.has(d))
    return view.render('pages/admin/report_parameters', {
      report,
      parameters: list,
      detected,
      undefinedDetected,
      message: session.flashMessages.get('message'),
      messageType: session.flashMessages.get('messageType'),
    })
  }

  async store({ params, request, session, response }: HttpContext) {
    const reportId = Number(params.reportId)
    try {
      const payload = await addValidator.validate(request.all())
      const report = await ReportHeadDetail.find(reportId)
      if (!report) throw new Error('ไม่พบรายงาน')

      const detected = ReportRunner.detectParameters(report.sql1 ?? '')
      if (!detected.includes(payload.param_name))
        throw new Error(`พารามิเตอร์ '${payload.param_name}' ไม่พบในคำสั่ง SQL`)

      await ReportParameter.create({
        reportId,
        paramName: payload.param_name,
        paramLabel: payload.param_label,
        paramType: payload.param_type,
        paramDefault: payload.param_default ?? null,
        paramRequired: !!payload.param_required,
        options: normalizeOptions(payload.param_type, payload.options),
        sortOrder: payload.sort_order ?? 1,
      })
      this.flashOk(session, 'เพิ่มพารามิเตอร์สำเร็จ')
    } catch (err: any) {
      this.flashErr(session, err)
    }
    return response.redirect().back()
  }

  async update({ request, session, response }: HttpContext) {
    try {
      const payload = await updateValidator.validate(request.all())
      const p = await ReportParameter.find(payload.id)
      if (!p) throw new Error('ไม่พบพารามิเตอร์')
      p.paramName = payload.param_name
      p.paramLabel = payload.param_label
      p.paramType = payload.param_type
      p.paramDefault = payload.param_default ?? null
      p.paramRequired = !!payload.param_required
      p.options = normalizeOptions(payload.param_type, payload.options)
      p.sortOrder = payload.sort_order ?? p.sortOrder
      await p.save()
      this.flashOk(session, 'อัพเดทพารามิเตอร์สำเร็จ')
    } catch (err: any) {
      this.flashErr(session, err)
    }
    return response.redirect().back()
  }

  async destroy({ request, session, response }: HttpContext) {
    try {
      const { id } = await idValidator.validate(request.only(['id']))
      const p = await ReportParameter.find(id)
      if (!p) throw new Error('ไม่พบพารามิเตอร์')
      await p.delete()
      this.flashOk(session, 'ลบพารามิเตอร์สำเร็จ')
    } catch (err: any) {
      this.flashErr(session, err)
    }
    return response.redirect().back()
  }

  /**
   * POST /admin/reports/:reportId/parameters/auto-detect
   * Scan the report's SQL for `@token`s and create stub parameter rows for
   * any that are not yet configured. Default type=text, label=name.
   */
  async autoDetect({ params, session, response }: HttpContext) {
    const reportId = Number(params.reportId)
    try {
      const report = await ReportHeadDetail.find(reportId)
      if (!report) throw new Error('ไม่พบรายงาน')
      const detected = ReportRunner.detectParameters(report.sql1 ?? '')
      if (detected.length === 0) {
        this.flashOk(session, 'ไม่พบพารามิเตอร์ใน SQL')
        return response.redirect().back()
      }
      const existing = await ReportParameter.query().where('reportId', reportId)
      const have = new Set(existing.map((p) => p.paramName))
      let added = 0
      let sort = existing.length + 1
      for (const name of detected) {
        if (have.has(name)) continue
        const guessedType = /(_d|date)$/i.test(name) ? 'date' : /(_t|time)$/i.test(name) ? 'text' : 'text'
        await ReportParameter.create({
          reportId,
          paramName: name,
          paramLabel: name,
          paramType: guessedType as any,
          paramDefault: null,
          paramRequired: false,
          options: null,
          sortOrder: sort++,
        })
        added++
      }
      this.flashOk(session, `auto-detect: เพิ่ม ${added} พารามิเตอร์ใหม่ (พบทั้งหมด ${detected.length})`)
    } catch (err: any) {
      this.flashErr(session, err)
    }
    return response.redirect().back()
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
