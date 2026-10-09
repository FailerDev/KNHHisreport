import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import ReportHeadDetail from '#models/report_head_detail'
import ReportParameter from '#models/report_parameter'
import ReportRequest from '#models/report_request'
import ReportRequestFile from '#models/report_request_file'
import type User from '#models/user'
import ReportRunner, { ReportRunnerError } from '#services/report_runner'
import { buildReportXlsx, collectReportParams, reportXlsxFilename } from '#services/report_excel'
import { stripTitleHtml } from '#services/title_html'
import ReportHead from '#models/report_head'
import { REQUEST_STATUSES, UPLOAD_EXTNAMES, filePurgeDate } from '#services/report_request_flow'
import {
  RequestFlowError,
  attachGenerated,
  attachUpload,
  promoteToReport,
  removeFile,
  retentionDays,
  saveWorkSql,
  statusCounts,
  transition,
} from '#services/report_request_service'
import {
  generateValidator,
  noteValidator,
  promoteValidator,
  rejectValidator,
  runSqlValidator,
} from '#validators/report_request'

/**
 * Legacy (non-dynamic) report placeholders → the PHP-era form field the
 * runner reads them from (see `collectReportParams`). `dayofweek` is left
 * out: it defaults to all days.
 */
const LEGACY_FIELDS: Record<string, { field: string; label: string; type: 'date' | 'text' }> = {
  start_d: { field: 'datepick1', label: 'วันที่เริ่มต้น', type: 'date' },
  end_d: { field: 'datepick2', label: 'วันที่สิ้นสุด', type: 'date' },
  start_t: { field: 'start_t', label: 'เวลาเริ่มต้น (HH.MM)', type: 'text' },
  end_t: { field: 'end_t', label: 'เวลาสิ้นสุด (HH.MM)', type: 'text' },
  an: { field: 'an', label: 'AN', type: 'text' },
  main_dep: { field: 'main_dep', label: 'แผนก (main_dep / all)', type: 'text' },
  spclty: { field: 'spclty', label: 'แผนก spclty (00 = ทั้งหมด)', type: 'text' },
  drug1: { field: 'drug1', label: 'ยา 1', type: 'text' },
  drug2: { field: 'drug2', label: 'ยา 2', type: 'text' },
  fbs1: { field: 'fbs1', label: 'FBS 1', type: 'text' },
  fbs2: { field: 'fbs2', label: 'FBS 2', type: 'text' },
}

/**
 * Admin / งานสารสนเทศ side: review, approve (= take on the job), reject,
 * attach result files (upload or generate from an existing report), complete.
 */
export default class AdminReportRequestsController {
  async index({ view, request, session }: HttpContext) {
    const status = String(request.input('status', 'open'))
    const search = String(request.input('q', '')).trim()

    const query = ReportRequest.query().preload('requester').preload('assignee').withCount('files')
    if (status === 'open') {
      query.whereIn('status', ['pending', 'in_progress']).orderBy('id', 'asc')
    } else {
      if ((REQUEST_STATUSES as readonly string[]).includes(status)) query.where('status', status)
      query.orderBy('id', 'desc')
    }
    if (search) {
      query.where((q) => q.whereLike('req_no', `%${search}%`).orWhereLike('title', `%${search}%`))
    }

    return view.render('pages/admin/requests/index', {
      requests: await query.limit(500),
      status,
      search,
      counts: await statusCounts(),
      message: session.flashMessages.get('message'),
      messageType: session.flashMessages.get('messageType'),
    })
  }

  async show({ params, view, response, session }: HttpContext) {
    const req = await ReportRequest.find(Number(params.id))
    if (!req) return response.redirect('/admin/requests')

    await req.load('requester')
    await req.load('assignee')
    await req.load('files', (q) => q.orderBy('id', 'asc'))
    await req.load('logs', (q) => q.orderBy('id', 'asc'))

    const reports =
      req.status === 'in_progress'
        ? await ReportHeadDetail.query()
            .where('status', 1)
            .preload('head')
            .orderBy('headId', 'asc')
            .orderBy('sort', 'asc')
        : []
    const heads =
      req.workSql && !req.promotedReportId
        ? await ReportHead.query().where('status', 1).orderBy('sort', 'asc')
        : []

    return view.render('pages/admin/requests/show', {
      req,
      reports,
      heads,
      purgeDate: filePurgeDate(req, await retentionDays()),
      uploadExtnames: UPLOAD_EXTNAMES,
      message: session.flashMessages.get('message'),
      messageType: session.flashMessages.get('messageType'),
    })
  }

  async approve(ctx: HttpContext) {
    const { params, request } = ctx
    return this.act(ctx, async () => {
      const { note } = await noteValidator.validate(request.all())
      const admin = ctx.auth.user as User
      const r = await transition(ctx, Number(params.id), 'in_progress', 'approve', {
        note: note ?? null,
        apply: (row) => {
          row.reviewedBy = admin.id
          row.reviewedAt = DateTime.now()
          row.assignedTo = admin.id
        },
      })
      return `อนุมัติคำขอ ${r.reqNo} แล้ว — สถานะ "กำลังจัดทำ"`
    })
  }

  async reject(ctx: HttpContext) {
    const { params, request } = ctx
    return this.act(ctx, async () => {
      const { reason } = await rejectValidator.validate(request.all())
      const admin = ctx.auth.user as User
      const r = await transition(ctx, Number(params.id), 'rejected', 'reject', {
        note: reason,
        apply: (row) => {
          row.reviewedBy = admin.id
          row.reviewedAt = DateTime.now()
          row.rejectReason = reason
        },
      })
      return `ไม่อนุมัติคำขอ ${r.reqNo} แล้ว`
    })
  }

  async upload(ctx: HttpContext) {
    const { params, request } = ctx
    return this.act(ctx, async () => {
      const req = await this.findOrFail(params.id)
      const file = request.file('file', { size: '20mb', extnames: UPLOAD_EXTNAMES })
      if (!file) throw new RequestFlowError('กรุณาเลือกไฟล์')
      const saved = await attachUpload(ctx, req, file)
      return `แนบไฟล์ ${saved.originalName} แล้ว`
    })
  }

  /** Run an existing report with the given params and attach the xlsx. */
  async generate(ctx: HttpContext) {
    const { params, request } = ctx
    return this.act(ctx, async () => {
      const req = await this.findOrFail(params.id)
      const { report_id: reportId } = await generateValidator.validate(request.all())
      const report = await ReportHeadDetail.query().where('id', reportId).where('status', 1).first()
      if (!report) throw new RequestFlowError('ไม่พบรายงานที่เลือก')

      const configured = await this.loadParameters(report.id)
      const useDynamic = configured.length > 0
      const raw = collectReportParams(request, configured, useDynamic)
      const errors = useDynamic ? ReportRunner.validate(raw, configured) : []
      if (errors.length > 0) throw new RequestFlowError(errors.join(', '))

      let runResult
      try {
        runResult = await ReportRunner.runReport(report, raw)
      } catch (e: any) {
        const msg = e instanceof ReportRunnerError ? e.message : String(e?.message ?? e)
        throw new RequestFlowError(`รันรายงานไม่สำเร็จ: ${msg}`)
      }

      const title = stripTitleHtml(report.detail) || 'Report'
      const buffer = await buildReportXlsx(title, runResult, raw, configured)
      const filename = `${req.reqNo}_${reportXlsxFilename(title)}`
      await attachGenerated(ctx, req, buffer, filename, `${title} (${runResult.count} แถว)`)
      return `สร้างไฟล์ ${filename} (${runResult.count} แถว) แล้ว`
    })
  }

  /**
   * Run admin-written SQL (read-only, single statement — enforced by
   * ReportRunner) and attach the result. `@start_d` / `@end_d` are filled
   * from the request's date range.
   */
  async runSql(ctx: HttpContext) {
    const { params, request } = ctx
    return this.act(ctx, async () => {
      const req = await this.findOrFail(params.id)
      const { sql, database_source: source } = await runSqlValidator.validate(request.all())

      const adhoc = new ReportHeadDetail()
      adhoc.sql1 = sql
      adhoc.databaseSource = source
      const raw = {
        start_d: req.dateFrom?.toISODate() ?? undefined,
        end_d: req.dateTo?.toISODate() ?? undefined,
      }

      let runResult
      try {
        runResult = await ReportRunner.runReport(adhoc, raw)
      } catch (e: any) {
        const msg = e instanceof ReportRunnerError ? e.message : String(e?.message ?? e)
        throw new RequestFlowError(`รัน SQL ไม่สำเร็จ: ${msg}`)
      }

      const buffer = await buildReportXlsx(req.title, runResult, raw, [])
      const filename = `${req.reqNo}_${reportXlsxFilename(req.title)}`
      await attachGenerated(ctx, req, buffer, filename, `SQL เขียนเอง (${runResult.count} แถว)`)
      await saveWorkSql(req, sql, source)
      return `รัน SQL แล้วแนบไฟล์ ${filename} (${runResult.count} แถว)`
    })
  }

  /** Save the request's ad-hoc SQL as a permanent report in report_head_detail. */
  async promote(ctx: HttpContext) {
    const { params, request } = ctx
    return this.act(ctx, async () => {
      const req = await this.findOrFail(params.id)
      const { head_id: headId, name } = await promoteValidator.validate(request.all())
      const report = await promoteToReport(ctx, req, headId, name)
      return `บันทึกเป็นรายงาน "${name}" แล้ว (รายงาน #${report.id}) — ตั้งค่าพารามิเตอร์เพิ่มได้ที่หน้าตั้งค่ารายงาน`
    })
  }

  async destroyFile(ctx: HttpContext) {
    const { params } = ctx
    return this.act(ctx, async () => {
      const req = await this.findOrFail(params.id)
      const file = await ReportRequestFile.query()
        .where('id', Number(params.fileId))
        .where('requestId', req.id)
        .first()
      if (!file) throw new RequestFlowError('ไม่พบไฟล์')
      await removeFile(ctx, req, file)
      return `ลบไฟล์ ${file.originalName} แล้ว`
    })
  }

  async complete(ctx: HttpContext) {
    const { params, request } = ctx
    return this.act(ctx, async () => {
      const { note } = await noteValidator.validate(request.all())
      // The close dialog may carry the result file itself: attach first, then close.
      const file = request.file('file', { size: '20mb', extnames: UPLOAD_EXTNAMES })
      if (file) await attachUpload(ctx, await this.findOrFail(params.id), file)

      const r = await transition(ctx, Number(params.id), 'completed', 'complete', {
        note: note ?? null,
        apply: async (row) => {
          const files = await ReportRequestFile.query({ client: row.$trx })
            .where('requestId', row.id)
            .count('* as total')
          if (Number(files[0].$extras.total) === 0) {
            throw new RequestFlowError('ต้องแนบไฟล์ผลลัพธ์อย่างน้อย 1 ไฟล์ก่อนปิดงาน')
          }
          row.completedAt = DateTime.now()
          row.completionNote = note ?? null
        },
      })
      return `ปิดงานคำขอ ${r.reqNo} เรียบร้อย`
    })
  }

  /** JSON for the "generate from report" form: which inputs the report needs. */
  async reportParams({ params, response }: HttpContext) {
    const report = await ReportHeadDetail.query()
      .where('id', Number(params.reportId))
      .where('status', 1)
      .first()
    if (!report) return response.notFound({ error: 'ไม่พบรายงาน' })

    const configured = await this.loadParameters(report.id)
    if (configured.length > 0) {
      return response.json({
        dynamic: true,
        fields: configured.map((p) => ({
          name: `param_${p.paramName}`,
          label: p.paramLabel,
          type: p.paramType,
          required: p.paramRequired,
          default: p.paramDefault ?? '',
          options: p.parsedOptions,
        })),
      })
    }

    const detected = ReportRunner.detectParameters(report.sql1 ?? '')
    return response.json({
      dynamic: false,
      fields: detected
        .filter((name) => LEGACY_FIELDS[name])
        .map((name) => ({
          name: LEGACY_FIELDS[name].field,
          label: LEGACY_FIELDS[name].label,
          type: LEGACY_FIELDS[name].type,
          required: false,
          default: name === 'start_t' ? '08.00' : name === 'end_t' ? '16.00' : '',
          options: [],
        })),
    })
  }

  private async findOrFail(id: unknown): Promise<ReportRequest> {
    const req = await ReportRequest.find(Number(id))
    if (!req) throw new RequestFlowError('ไม่พบคำขอ')
    return req
  }

  private async loadParameters(reportId: number): Promise<ReportParameter[]> {
    return await ReportParameter.query()
      .where('reportId', reportId)
      .orderBy('sortOrder', 'asc')
      .orderBy('paramName', 'asc')
  }

  /** Run an action, flash its result (or error), go back to the request page. */
  private async act(ctx: HttpContext, fn: () => Promise<string>) {
    const { session, response, params } = ctx
    try {
      const msg = await fn()
      session.flash('message', msg)
      session.flash('messageType', 'success')
    } catch (err: any) {
      session.flash('message', err?.messages?.[0]?.message ?? err?.message ?? 'เกิดข้อผิดพลาด')
      session.flash('messageType', 'error')
    }
    return response.redirect(`/admin/requests/${Number(params.id)}`)
  }
}
