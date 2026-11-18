import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import ReportHeadDetail from '#models/report_head_detail'
import ReportRequest from '#models/report_request'
import ReportRequestFile from '#models/report_request_file'
import type User from '#models/user'
import ReportRunner, { ReportRunnerError } from '#services/report_runner'
import { buildReportXlsx, collectReportParams, reportXlsxFilename } from '#services/report_excel'
import { KNOWN, NO_INPUT, loadEffectiveParameters, parseParamList } from '#services/report_params'
import { stripTitleHtml } from '#services/title_html'
import ReportHead from '#models/report_head'
import {
  REQUEST_STATUSES,
  UPLOAD_EXTNAMES,
  filePurgeDate,
  hasDeliverable,
} from '#services/report_request_flow'
import {
  RequestFlowError,
  attachGenerated,
  attachUpload,
  createReportForRequest,
  linkResultReport,
  removeFile,
  resultReportView,
  retentionDays,
  statusCounts,
  transition,
  unlinkResultReport,
} from '#services/report_request_service'
import {
  createReportValidator,
  generateValidator,
  noteValidator,
  rejectValidator,
} from '#validators/report_request'

/**
 * Admin / งานสารสนเทศ side: review, approve (= take on the job), reject,
 * deliver the result — files (upload / generate from a report) and/or a link
 * to a report in the system (existing, or created here) — then complete.
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
      req.status === 'in_progress'
        ? await ReportHead.query().where('status', 1).orderBy('sort', 'asc')
        : []

    return view.render('pages/admin/requests/show', {
      req,
      reports,
      heads,
      paramPresets: { known: KNOWN, noInput: [...NO_INPUT] },
      resultReport: await resultReportView(req),
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

      const configured = await loadEffectiveParameters(report)
      const raw = collectReportParams(request, configured)
      const errors = ReportRunner.validate(raw, configured)
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

  /** Deliver an existing report: the requester opens it from the request page. */
  async linkReport(ctx: HttpContext) {
    const { params, request } = ctx
    return this.act(ctx, async () => {
      const req = await this.findOrFail(params.id)
      const { report_id: reportId } = await generateValidator.validate(request.all())
      const report = await linkResultReport(ctx, req, reportId)
      return `ส่งมอบรายงาน "${stripTitleHtml(report.detail)}" ให้ผู้ขอแล้ว — กดปิดงานเมื่อพร้อม`
    })
  }

  async unlinkReport(ctx: HttpContext) {
    const { params } = ctx
    return this.act(ctx, async () => {
      await unlinkResultReport(ctx, await this.findOrFail(params.id))
      return 'ยกเลิกการส่งมอบรายงานแล้ว'
    })
  }

  /** No report fits the request yet: create one from SQL and deliver it. */
  async createReport(ctx: HttpContext) {
    const { params, request, session } = ctx
    let created = false
    const res = await this.act(ctx, async () => {
      const req = await this.findOrFail(params.id)
      const payload = await createReportValidator.validate(request.all())
      const report = await createReportForRequest(ctx, req, {
        headId: payload.head_id,
        name: payload.name,
        sql: payload.sql,
        source: payload.database_source,
        params: await this.paramList(request.input('params_json')),
      })
      created = true
      return `สร้างรายงาน "${payload.name}" (#${report.id}) และส่งมอบให้ผู้ขอแล้ว — กดปิดงานเมื่อพร้อม`
    })
    // Keep what the admin typed so a failed SQL check doesn't lose it.
    if (!created) {
      session.flash(
        'createReportDraft',
        request.only(['head_id', 'name', 'sql', 'database_source', 'params_json'])
      )
    }
    return res
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
          if (!hasDeliverable(Number(files[0].$extras.total), row.resultReportId)) {
            throw new RequestFlowError(
              'ต้องแนบไฟล์ผลลัพธ์ หรือส่งมอบรายงานในระบบ อย่างน้อย 1 อย่างก่อนปิดงาน'
            )
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

    const configured = await loadEffectiveParameters(report)
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

  /** Parameter list from the "ตั้งค่าพารามิเตอร์" popup; flow-safe error message. */
  private async paramList(raw: unknown) {
    try {
      return await parseParamList(raw)
    } catch (e: any) {
      throw new RequestFlowError(e?.message ?? 'ข้อมูลพารามิเตอร์ไม่ถูกต้อง')
    }
  }

  private async findOrFail(id: unknown): Promise<ReportRequest> {
    const req = await ReportRequest.find(Number(id))
    if (!req) throw new RequestFlowError('ไม่พบคำขอ')
    return req
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
