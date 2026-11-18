import { randomUUID } from 'node:crypto'
import { mkdir, rm, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { HttpContext } from '@adonisjs/core/http'
import type { MultipartFile } from '@adonisjs/core/bodyparser'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import env from '#start/env'
import { notificationSettings } from '#services/app_settings'
import AuditLog from '#models/audit_log'
import ReportHead from '#models/report_head'
import ReportHeadDetail from '#models/report_head_detail'
import ReportRequest from '#models/report_request'
import ReportRequestFile from '#models/report_request_file'
import ReportRequestLog from '#models/report_request_log'
import type User from '#models/user'
import { writeAudit } from '#services/audit'
import { notifyRequestEvent } from '#services/notifier'
import { assertReadOnlySql } from '#services/his_sql_guard'
import {
  loadEffectiveParameters,
  syncReportParameters,
  type ParamInput,
} from '#services/report_params'
import { stripTitleHtml } from '#services/title_html'
import {
  canTransition,
  fiscalYearBE,
  reportLinkQuery,
  formatReqNo,
  statusMeta,
  UPLOAD_EXTNAMES,
  type DataLevel,
  type OutputFormat,
  type RequestStatus,
} from '#services/report_request_flow'

/** Thrown for workflow-rule violations; the message is safe to flash to users. */
export class RequestFlowError extends Error {}

export interface NewRequestData {
  title: string
  description: string
  purpose: string | null
  dataLevel: DataLevel
  dateFrom: DateTime | null
  dateTo: DateTime | null
  outputFormat: OutputFormat
  dueDate: DateTime | null
}

/**
 * Root folder for request files. Set REQUEST_STORAGE_PATH in production so the
 * files live outside `build/` (which `node ace build` wipes on every rebuild).
 */
function storageRoot(): string {
  const configured = env.get('REQUEST_STORAGE_PATH')
  if (!configured) return app.makePath('storage')
  return isAbsolute(configured) ? configured : app.makePath(configured)
}

export function requestStorageDir(requestId: number): string {
  return join(storageRoot(), 'report_requests', String(requestId))
}

export function requestFilePath(file: ReportRequestFile): string {
  return join(requestStorageDir(file.requestId), file.storedName)
}

/**
 * Allocate the next REQ number for the fiscal year of `now`. Must run inside
 * the transaction that inserts the request: the sequence row is locked with
 * SELECT … FOR UPDATE so concurrent submissions can't get the same number.
 */
async function nextReqNo(trx: TransactionClientContract, now: DateTime) {
  const fiscalYear = fiscalYearBE(now)
  await trx.rawQuery(
    'INSERT IGNORE INTO report_request_sequences (fiscal_year, last_no) VALUES (?, 0)',
    [fiscalYear]
  )
  const row = await trx
    .from('report_request_sequences')
    .where('fiscal_year', fiscalYear)
    .forUpdate()
    .first()
  const next = Number(row?.last_no ?? 0) + 1
  await trx
    .from('report_request_sequences')
    .where('fiscal_year', fiscalYear)
    .update({ last_no: next })
  return { fiscalYear, reqNo: formatReqNo(fiscalYear, next) }
}

/** Who performed an action; null = the system (e.g. scheduled purge). */
type Actor = { id: number; username: string } | null

function actorOf(ctx: HttpContext): Actor {
  const user = ctx.auth.user as User | undefined
  return user ? { id: user.id, username: user.username } : null
}

async function addLog(
  actor: Actor,
  requestId: number,
  action: string,
  opts: { from?: string | null; to?: string | null; note?: string | null },
  trx?: TransactionClientContract
) {
  await ReportRequestLog.create(
    {
      requestId,
      action,
      fromStatus: opts.from ?? null,
      toStatus: opts.to ?? null,
      note: opts.note ?? null,
      userId: actor?.id ?? null,
      username: actor?.username ?? 'ระบบ',
    },
    { client: trx }
  )
}

export async function createRequest(
  ctx: HttpContext,
  data: NewRequestData
): Promise<ReportRequest> {
  const user = ctx.auth.user as User
  const created = await db.transaction(async (trx) => {
    const { fiscalYear, reqNo } = await nextReqNo(trx, DateTime.now())
    const request = await ReportRequest.create(
      { ...data, reqNo, fiscalYear, requesterId: user.id, status: 'pending' },
      { client: trx }
    )
    await addLog(actorOf(ctx), request.id, 'create', { to: 'pending' }, trx)
    return request
  })
  await writeAudit(ctx, {
    action: 'report_request.create',
    entity: 'report_request',
    entityId: created.id,
    summary: `${created.reqNo} "${created.title}"`,
    meta: { dataLevel: created.dataLevel },
  })
  await notifyRequestEvent(created, 'create', user.id)
  return created
}

/**
 * Move a request to `to`, re-checking the rule against a row-locked copy so
 * two admins clicking at once can't both win. Returns the updated row.
 */
export async function transition(
  ctx: HttpContext,
  requestId: number,
  to: RequestStatus,
  action: string,
  opts: { note?: string | null; apply?: (r: ReportRequest) => void | Promise<void> } = {}
): Promise<ReportRequest> {
  const updated = await db.transaction(async (trx) => {
    const request = await ReportRequest.query({ client: trx })
      .where('id', requestId)
      .forUpdate()
      .first()
    if (!request) throw new RequestFlowError('ไม่พบคำขอ')
    const from = request.status
    if (!canTransition(from, to)) {
      throw new RequestFlowError(
        `ไม่สามารถเปลี่ยนสถานะจาก "${statusMeta(from).label}" เป็น "${statusMeta(to).label}" ได้`
      )
    }
    request.status = to
    await opts.apply?.(request)
    await request.save()
    await addLog(actorOf(ctx), request.id, action, { from, to, note: opts.note }, trx)
    return request
  })
  await writeAudit(ctx, {
    action: `report_request.${action}`,
    entity: 'report_request',
    entityId: updated.id,
    summary: `${updated.reqNo} → ${to}`,
    meta: opts.note ? { note: opts.note } : null,
  })
  await notifyRequestEvent(updated, action, actorOf(ctx)?.id ?? null, opts.note)
  return updated
}

export function assertWorkable(request: ReportRequest): void {
  if (request.status !== 'in_progress') {
    throw new RequestFlowError('แนบ/ลบไฟล์ได้เฉพาะคำขอที่อยู่ในสถานะ "กำลังจัดทำ"')
  }
}

export async function attachUpload(
  ctx: HttpContext,
  request: ReportRequest,
  file: MultipartFile
): Promise<ReportRequestFile> {
  assertWorkable(request)
  if (!file.isValid) {
    const type = file.errors[0]?.type
    throw new RequestFlowError(
      type === 'size'
        ? 'ไฟล์มีขนาดเกิน 20MB'
        : type === 'extname'
          ? `ไม่รองรับไฟล์ .${file.extname} — ใช้ได้เฉพาะ ${UPLOAD_EXTNAMES.join(', ')}`
          : (file.errors[0]?.message ?? 'ไฟล์ไม่ถูกต้อง')
    )
  }
  const storedName = `${randomUUID()}.${file.extname}`
  await file.move(requestStorageDir(request.id), { name: storedName })
  if (file.state !== 'moved') throw new RequestFlowError('บันทึกไฟล์ไม่สำเร็จ')

  return recordFile(ctx, request, {
    originalName: file.clientName,
    storedName,
    mime: file.headers['content-type'] ?? null,
    size: file.size,
    source: 'upload',
  })
}

export async function attachGenerated(
  ctx: HttpContext,
  request: ReportRequest,
  buffer: Buffer,
  originalName: string,
  note: string
): Promise<ReportRequestFile> {
  assertWorkable(request)
  const dir = requestStorageDir(request.id)
  await mkdir(dir, { recursive: true })
  const storedName = `${randomUUID()}.xlsx`
  await writeFile(join(dir, storedName), buffer)

  return recordFile(
    ctx,
    request,
    {
      originalName,
      storedName,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: buffer.length,
      source: 'generated',
    },
    note
  )
}

async function recordFile(
  ctx: HttpContext,
  request: ReportRequest,
  data: Pick<ReportRequestFile, 'originalName' | 'storedName' | 'mime' | 'size' | 'source'>,
  note?: string
): Promise<ReportRequestFile> {
  const user = ctx.auth.user as User
  const row = await ReportRequestFile.create({
    ...data,
    requestId: request.id,
    uploadedBy: user.id,
    downloadCount: 0,
  })
  const action = data.source === 'generated' ? 'generate' : 'upload'
  await addLog(actorOf(ctx), request.id, action, { note: note ?? data.originalName })
  await writeAudit(ctx, {
    action: `report_request.${action}`,
    entity: 'report_request',
    entityId: request.id,
    summary: `${request.reqNo} + ${data.originalName}`,
    meta: { fileId: row.id, size: data.size },
  })
  return row
}

export async function removeFile(
  ctx: HttpContext,
  request: ReportRequest,
  file: ReportRequestFile
) {
  assertWorkable(request)
  try {
    await unlink(requestFilePath(file))
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err
  }
  await file.delete()
  await addLog(actorOf(ctx), request.id, 'delete_file', { note: file.originalName })
  await writeAudit(ctx, {
    action: 'report_request.delete_file',
    entity: 'report_request',
    entityId: request.id,
    summary: `${request.reqNo} - ${file.originalName}`,
  })
}

export type StatusCounts = Record<RequestStatus, number> & { all: number; open: number }

/** Number of requests per status (optionally only one requester's). */
export async function statusCounts(requesterId?: number): Promise<StatusCounts> {
  const query = db.from('report_requests').select('status').count('* as total').groupBy('status')
  if (requesterId !== undefined) query.where('requester_id', requesterId)
  const rows: Array<{ status: string; total: number | string }> = await query

  const counts: StatusCounts = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    rejected: 0,
    cancelled: 0,
    all: 0,
    open: 0,
  }
  for (const row of rows) {
    const n = Number(row.total)
    if (row.status in counts) counts[row.status as RequestStatus] = n
    counts.all += n
  }
  counts.open = counts.pending + counts.in_progress
  return counts
}

export async function recordDownload(
  ctx: HttpContext,
  request: ReportRequest,
  file: ReportRequestFile
) {
  await ReportRequestFile.query().where('id', file.id).increment('download_count', 1)
  await writeAudit(ctx, {
    action: 'report_request.download',
    entity: 'report_request',
    entityId: request.id,
    summary: `${request.reqNo} ↓ ${file.originalName}`,
    meta: { fileId: file.id, dataLevel: request.dataLevel },
  })
}

export interface NewReportData {
  headId: number
  name: string
  sql: string
  source: 'his' | 'system'
  /** From the "ตั้งค่าพารามิเตอร์" popup; null = auto-detect from @tokens */
  params?: ParamInput | null
}

/**
 * The request needs a report the system doesn't have yet: create it under
 * `headId` (same SQL guard as the report-settings page) and deliver it to the
 * requester. Parameters are auto-detected from the @tokens in the SQL; the
 * admin can fine-tune them later on the parameters page.
 */
export async function createReportForRequest(
  ctx: HttpContext,
  request: ReportRequest,
  data: NewReportData
): Promise<ReportHeadDetail> {
  assertWorkable(request)
  try {
    assertReadOnlySql(data.sql)
  } catch (e: any) {
    throw new RequestFlowError(`SQL: ${e.message}`)
  }
  const head = await ReportHead.find(data.headId)
  if (!head) throw new RequestFlowError('ไม่พบหมวดหมู่รายงาน')

  const report = await ReportHeadDetail.create({
    headId: head.id,
    detail: data.name,
    sql1: data.sql,
    sql2: null,
    databaseSource: data.source,
    sort: 1,
    status: 1,
  })
  if (data.params) await syncReportParameters(report.id, report.sql1, data.params)
  request.workSql = data.sql
  request.workDbSource = data.source
  request.promotedReportId = report.id
  request.resultReportId = report.id
  await request.save()
  await addLog(actorOf(ctx), request.id, 'create_report', {
    note: `${data.name} (รายงาน #${report.id})`,
  })
  await writeAudit(ctx, {
    action: 'report_request.create_report',
    entity: 'report_request',
    entityId: request.id,
    summary: `${request.reqNo} → report #${report.id} "${data.name}"`,
    meta: { reportId: report.id, headId: head.id },
  })
  return report
}

/** Deliver an existing, active report to the requester (replaces any earlier link). */
export async function linkResultReport(
  ctx: HttpContext,
  request: ReportRequest,
  reportId: number
): Promise<ReportHeadDetail> {
  assertWorkable(request)
  const report = await ReportHeadDetail.query().where('id', reportId).where('status', 1).first()
  if (!report) throw new RequestFlowError('ไม่พบรายงานที่เลือก')
  request.resultReportId = report.id
  await request.save()
  const name = stripTitleHtml(report.detail) || `รายงาน #${report.id}`
  await addLog(actorOf(ctx), request.id, 'link_report', { note: `${name} (รายงาน #${report.id})` })
  await writeAudit(ctx, {
    action: 'report_request.link_report',
    entity: 'report_request',
    entityId: request.id,
    summary: `${request.reqNo} → report #${report.id}`,
    meta: { reportId: report.id },
  })
  return report
}

export async function unlinkResultReport(ctx: HttpContext, request: ReportRequest) {
  assertWorkable(request)
  if (!request.resultReportId) throw new RequestFlowError('คำขอนี้ยังไม่ได้ส่งมอบรายงาน')
  const old = request.resultReportId
  request.resultReportId = null
  await request.save()
  await addLog(actorOf(ctx), request.id, 'unlink_report', { note: `รายงาน #${old}` })
  await writeAudit(ctx, {
    action: 'report_request.unlink_report',
    entity: 'report_request',
    entityId: request.id,
    summary: `${request.reqNo} ✕ report #${old}`,
  })
}

export interface ResultReportView {
  id: number
  name: string
  url: string
}

/**
 * The delivered report as the request page shows it: its name and a link
 * that opens it with the request's date range filled in. Null when nothing
 * is linked or the report was since disabled/deleted.
 */
export async function resultReportView(request: ReportRequest): Promise<ResultReportView | null> {
  if (!request.resultReportId) return null
  const report = await ReportHeadDetail.query()
    .where('id', request.resultReportId)
    .where('status', 1)
    .first()
  if (!report) return null
  const params = await loadEffectiveParameters(report)
  const qs = reportLinkQuery(
    params,
    request.dateFrom?.toISODate() ?? null,
    request.dateTo?.toISODate() ?? null
  )
  return {
    id: report.id,
    name: stripTitleHtml(report.detail) || `รายงาน #${report.id}`,
    url: `/reports/${report.id}${qs}`,
  }
}

/** PDPA retention period (days), from the notification settings page or .env. */
export async function retentionDays(): Promise<number> {
  return (await notificationSettings()).retentionDays
}

export interface PurgeResult {
  reqNos: string[]
  files: number
}

/**
 * PDPA retention: delete result files of identifiable requests completed more
 * than `days` ago. Run daily via `node ace requests:purge-files`.
 */
export async function purgeExpiredFiles(opts: {
  days: number
  dryRun: boolean
  now?: DateTime
}): Promise<PurgeResult> {
  const now = opts.now ?? DateTime.now()
  const cutoff = now.minus({ days: opts.days })
  const due = await ReportRequest.query()
    .where('dataLevel', 'identifiable')
    .where('status', 'completed')
    .whereNull('filesPurgedAt')
    .where('completedAt', '<=', cutoff.toJSDate())
    .preload('files')

  const result: PurgeResult = { reqNos: [], files: 0 }
  for (const request of due) {
    result.reqNos.push(request.reqNo)
    result.files += request.files.length
    if (opts.dryRun) continue

    await rm(requestStorageDir(request.id), { recursive: true, force: true })
    await ReportRequestFile.query().where('requestId', request.id).delete()
    request.filesPurgedAt = now
    await request.save()
    await addLog(null, request.id, 'purge', {
      note: `ลบ ${request.files.length} ไฟล์ (ครบระยะเก็บ ${opts.days} วันหลังปิดงาน)`,
    })
    await AuditLog.create({
      userId: null,
      username: 'system',
      action: 'report_request.purge',
      entity: 'report_request',
      entityId: request.id,
      summary: `${request.reqNo} purged ${request.files.length} file(s)`,
      meta: { days: opts.days },
      ip: null,
      userAgent: null,
    })
    await notifyRequestEvent(request, 'purge', null)
  }
  return result
}
