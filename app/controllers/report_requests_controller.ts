import { existsSync } from 'node:fs'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import ReportRequest from '#models/report_request'
import ReportRequestFile from '#models/report_request_file'
import type User from '#models/user'
import { createRequestValidator, noteValidator } from '#validators/report_request'
import { REQUEST_STATUSES, filePurgeDate } from '#services/report_request_flow'
import {
  RequestFlowError,
  createRequest,
  recordDownload,
  requestFilePath,
  retentionDays,
  statusCounts,
  transition,
} from '#services/report_request_service'

/**
 * Requester side of the data/report request module: submit a request, follow
 * its status, cancel while pending, download the result files.
 */
export default class ReportRequestsController {
  async index({ view, auth, request, session }: HttpContext) {
    const user = auth.user as User
    const status = String(request.input('status', ''))

    const query = ReportRequest.query()
      .where('requesterId', user.id)
      .withCount('files')
      .orderBy('id', 'desc')
    if ((REQUEST_STATUSES as readonly string[]).includes(status)) query.where('status', status)

    return view.render('pages/requests/index', {
      requests: await query,
      status,
      counts: await statusCounts(user.id),
      message: session.flashMessages.get('message'),
      messageType: session.flashMessages.get('messageType'),
    })
  }

  async create({ view, session }: HttpContext) {
    return view.render('pages/requests/create', {
      today: DateTime.now().toISODate(),
      message: session.flashMessages.get('message'),
      messageType: session.flashMessages.get('messageType'),
    })
  }

  async store(ctx: HttpContext) {
    const { request, session, response } = ctx
    try {
      const payload = await createRequestValidator.validate(request.all())
      if (payload.data_level === 'identifiable' && !payload.purpose) {
        throw new RequestFlowError('คำขอข้อมูลรายบุคคลต้องระบุวัตถุประสงค์การนำข้อมูลไปใช้')
      }

      const dateFrom = this.parseDate(payload.date_from, 'วันที่เริ่มต้น')
      const dateTo = this.parseDate(payload.date_to, 'วันที่สิ้นสุด')
      const dueDate = this.parseDate(payload.due_date, 'วันที่ต้องการรับข้อมูล')
      if (dateFrom && dateTo && dateTo < dateFrom) {
        throw new RequestFlowError('วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น')
      }
      if (dueDate && dueDate < DateTime.now().startOf('day')) {
        throw new RequestFlowError('วันที่ต้องการรับข้อมูลต้องไม่ใช่วันที่ผ่านมาแล้ว')
      }

      const created = await createRequest(ctx, {
        title: payload.title,
        description: payload.description,
        purpose: payload.purpose ?? null,
        dataLevel: payload.data_level,
        dateFrom,
        dateTo,
        outputFormat: payload.output_format,
        dueDate,
      })
      this.flashOk(session, `ส่งคำขอเรียบร้อย เลขที่คำขอ ${created.reqNo}`)
      return response.redirect(`/requests/${created.id}`)
    } catch (err: any) {
      session.flashAll()
      this.flashErr(session, err)
      return response.redirect().back()
    }
  }

  async show({ params, view, auth, response, session }: HttpContext) {
    const user = auth.user as User
    const req = await this.loadVisible(Number(params.id), user)
    if (!req) return response.redirect('/requests')

    await req.load('requester')
    await req.load('assignee')
    await req.load('files', (q) => q.orderBy('id', 'asc'))
    await req.load('logs', (q) => q.orderBy('id', 'asc'))

    return view.render('pages/requests/show', {
      req,
      isOwner: req.requesterId === user.id,
      purgeDate: filePurgeDate(req, await retentionDays()),
      message: session.flashMessages.get('message'),
      messageType: session.flashMessages.get('messageType'),
    })
  }

  async cancel(ctx: HttpContext) {
    const { params, auth, request, session, response } = ctx
    const user = auth.user as User
    const req = await ReportRequest.find(Number(params.id))
    if (!req || req.requesterId !== user.id) return response.redirect('/requests')
    try {
      const { note } = await noteValidator.validate(request.all())
      const updated = await transition(ctx, req.id, 'cancelled', 'cancel', {
        note: note ?? null,
      })
      this.flashOk(session, `ยกเลิกคำขอ ${updated.reqNo} แล้ว`)
    } catch (err: any) {
      this.flashErr(session, err)
    }
    return response.redirect(`/requests/${req.id}`)
  }

  /** Files are only reachable here — owner or admin, never via public/. */
  async download(ctx: HttpContext) {
    const { params, auth, response } = ctx
    const user = auth.user as User
    const file = await ReportRequestFile.find(Number(params.fileId))
    if (!file) return response.notFound('ไม่พบไฟล์')
    const req = await this.loadVisible(file.requestId, user)
    if (!req) return response.forbidden('ไม่มีสิทธิ์ดาวน์โหลดไฟล์นี้')

    const path = requestFilePath(file)
    if (!existsSync(path)) return response.notFound('ไม่พบไฟล์ในระบบจัดเก็บ')

    await recordDownload(ctx, req, file)
    return response.attachment(path, file.originalName)
  }

  private async loadVisible(id: number, user: User): Promise<ReportRequest | null> {
    if (!Number.isFinite(id) || id <= 0) return null
    const req = await ReportRequest.find(id)
    if (!req) return null
    return req.requesterId === user.id || user.isAdmin ? req : null
  }

  private parseDate(value: string | undefined, label: string): DateTime | null {
    if (!value) return null
    const dt = DateTime.fromISO(value)
    if (!dt.isValid) throw new RequestFlowError(`${label}ไม่ถูกต้อง`)
    return dt
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
