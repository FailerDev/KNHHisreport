import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import {
  DATA_LEVEL_LABELS,
  OUTPUT_FORMAT_LABELS,
  REQUEST_STATUSES,
  statusMeta,
  type DataLevel,
  type OutputFormat,
  type RequestStatus,
} from '#services/report_request_flow'

/**
 * สรุปการขอรายงาน — numbers for the admin report on the request module,
 * over requests *submitted* in [from, to].
 */

export interface StatsRange {
  from: DateTime
  to: DateTime
}

/** Default range: start of the current fiscal year (1 Oct) → today. */
export function defaultStatsRange(now = DateTime.now()): StatsRange {
  const fyStartYear = now.month >= 10 ? now.year : now.year - 1
  return {
    from: DateTime.fromObject({ year: fyStartYear, month: 10, day: 1 }),
    to: now.startOf('day'),
  }
}

export interface GroupRow {
  label: string
  total: number
  completed: number
  open: number
  /** Average days from submission to completion; null when nothing completed */
  avgDays: number | null
}

export interface RequestStats {
  range: StatsRange
  total: number
  byStatus: Array<{ status: RequestStatus; label: string; badge: string; total: number }>
  completed: number
  /** Completed ÷ requests that reached a final decision (completed/rejected) */
  completionRate: number | null
  avgDays: number | null
  /** Completed requests with a due date, and how many made it in time */
  dueTracked: number
  onTime: number
  /** Still-open requests whose due date has passed */
  overdueOpen: number
  deliveredAsReport: number
  deliveredAsFile: number
  monthly: Array<GroupRow & { month: string }>
  byDepartment: GroupRow[]
  byAssignee: GroupRow[]
  byOutput: Array<{ label: string; total: number }>
  byDataLevel: Array<{ label: string; total: number }>
}

const THAI_MONTHS = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
]

/** '2026-10' → 'ต.ค. 2569' */
export function thaiMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m || m < 1 || m > 12) return ym
  return `${THAI_MONTHS[m - 1]} ${y + 543}`
}

const DAY_MINUTES = 1440
const avgDaysSql = `AVG(CASE WHEN r.status = 'completed' AND r.completed_at IS NOT NULL
  THEN TIMESTAMPDIFF(MINUTE, r.created_at, r.completed_at) END) / ${DAY_MINUTES}`

function base(range: StatsRange) {
  return db
    .from('report_requests as r')
    .where('r.created_at', '>=', range.from.startOf('day').toSQL({ includeOffset: false })!)
    .where('r.created_at', '<=', range.to.endOf('day').toSQL({ includeOffset: false })!)
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function days(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null
}

const groupCols = (labelExpr: string) =>
  db.raw(`${labelExpr} as label,
    COUNT(*) as total,
    SUM(r.status = 'completed') as completed,
    SUM(r.status IN ('pending', 'in_progress')) as open_count,
    ${avgDaysSql} as avg_days`)

function toGroupRow(row: any): GroupRow {
  return {
    label: String(row.label ?? '—') || '—',
    total: num(row.total),
    completed: num(row.completed),
    open: num(row.open_count),
    avgDays: days(row.avg_days),
  }
}

export async function requestStats(range: StatsRange): Promise<RequestStats> {
  const today = DateTime.now().toISODate()!

  const [summary] = await base(range).select(
    db.raw(
      `COUNT(*) as total,
      SUM(r.status = 'completed') as completed,
      SUM(r.status = 'rejected') as rejected,
      ${avgDaysSql} as avg_days,
      SUM(r.status = 'completed' AND r.due_date IS NOT NULL) as due_tracked,
      SUM(r.status = 'completed' AND r.due_date IS NOT NULL
        AND DATE(r.completed_at) <= r.due_date) as on_time,
      SUM(r.status IN ('pending', 'in_progress') AND r.due_date < ?) as overdue_open,
      SUM(r.status = 'completed' AND r.result_report_id IS NOT NULL) as as_report,
      SUM(r.status = 'completed' AND EXISTS (
        SELECT 1 FROM report_request_files f WHERE f.request_id = r.id)) as as_file`,
      [today]
    )
  )

  const statusRows: Array<{ status: string; total: unknown }> = await base(range)
    .select('r.status')
    .count('* as total')
    .groupBy('r.status')
  const statusMap = new Map(statusRows.map((s) => [s.status, num(s.total)]))

  const monthly = await base(range)
    .select(groupCols(`DATE_FORMAT(r.created_at, '%Y-%m')`))
    .groupBy('label')
    .orderBy('label', 'asc')

  const byDepartment = await base(range)
    .leftJoin('users as u', 'u.id', 'r.requester_id')
    .select(groupCols(`COALESCE(NULLIF(u.department, ''), 'ไม่ระบุหน่วยงาน')`))
    .groupBy('label')
    .orderBy('total', 'desc')

  const byAssignee = await base(range)
    .whereNotNull('r.assigned_to')
    .leftJoin('users as u', 'u.id', 'r.assigned_to')
    .select(groupCols(`COALESCE(NULLIF(u.fullname, ''), u.username, CONCAT('#', r.assigned_to))`))
    .groupBy('label')
    .orderBy('total', 'desc')

  const outputRows: Array<{ output_format: string; total: unknown }> = await base(range)
    .select('r.output_format')
    .count('* as total')
    .groupBy('r.output_format')
    .orderBy('total', 'desc')

  const levelRows: Array<{ data_level: string; total: unknown }> = await base(range)
    .select('r.data_level')
    .count('* as total')
    .groupBy('r.data_level')
    .orderBy('total', 'desc')

  const completed = num(summary?.completed)
  const decided = completed + num(summary?.rejected)

  return {
    range,
    total: num(summary?.total),
    byStatus: REQUEST_STATUSES.map((status) => ({
      status,
      label: statusMeta(status).label,
      badge: statusMeta(status).badge,
      total: statusMap.get(status) ?? 0,
    })),
    completed,
    completionRate: decided > 0 ? Math.round((completed / decided) * 100) : null,
    avgDays: days(summary?.avg_days),
    dueTracked: num(summary?.due_tracked),
    onTime: num(summary?.on_time),
    overdueOpen: num(summary?.overdue_open),
    deliveredAsReport: num(summary?.as_report),
    deliveredAsFile: num(summary?.as_file),
    monthly: monthly.map((m: any) => ({ ...toGroupRow(m), month: thaiMonth(String(m.label)) })),
    byDepartment: byDepartment.map(toGroupRow),
    byAssignee: byAssignee.map(toGroupRow),
    byOutput: outputRows.map((o) => ({
      label: OUTPUT_FORMAT_LABELS[o.output_format as OutputFormat] ?? o.output_format,
      total: num(o.total),
    })),
    byDataLevel: levelRows.map((l) => ({
      label: DATA_LEVEL_LABELS[l.data_level as DataLevel] ?? l.data_level,
      total: num(l.total),
    })),
  }
}

const thaiDate = (dt: DateTime | null | undefined) =>
  dt && dt.isValid ? `${dt.toFormat('dd/MM')}/${dt.year + 543}` : ''

/** One row per request in the range — the Excel export of the report. */
export async function requestStatsRows(range: StatsRange) {
  const rows = await base(range)
    .leftJoin('users as u', 'u.id', 'r.requester_id')
    .leftJoin('users as a', 'a.id', 'r.assigned_to')
    .select(
      'r.req_no',
      'r.title',
      'r.status',
      'r.data_level',
      'r.output_format',
      'r.created_at',
      'r.due_date',
      'r.completed_at',
      'r.result_report_id',
      db.raw(`COALESCE(NULLIF(u.fullname, ''), u.username) as requester`),
      'u.department',
      db.raw(`COALESCE(NULLIF(a.fullname, ''), a.username) as assignee`),
      db.raw(`(SELECT COUNT(*) FROM report_request_files f WHERE f.request_id = r.id) as files`)
    )
    .orderBy('r.id', 'asc')

  const toDt = (v: unknown) =>
    v instanceof Date ? DateTime.fromJSDate(v) : v ? DateTime.fromSQL(String(v)) : null

  return rows.map((r: any) => {
    const created = toDt(r.created_at)
    const done = toDt(r.completed_at)
    const spent = created && done ? Math.round(done.diff(created, 'days').days * 10) / 10 : ''
    return {
      'เลขที่คำขอ': r.req_no,
      'เรื่อง': r.title,
      'ผู้ขอ': r.requester ?? '',
      'หน่วยงาน': r.department ?? '',
      'วันที่ส่ง': thaiDate(created),
      'ต้องการภายใน': thaiDate(toDt(r.due_date)),
      'สถานะ': statusMeta(r.status).label,
      'ผู้รับผิดชอบ': r.assignee ?? '',
      'วันที่ปิดงาน': thaiDate(done),
      'ใช้เวลา (วัน)': spent,
      'รูปแบบที่ขอ': OUTPUT_FORMAT_LABELS[r.output_format as OutputFormat] ?? r.output_format,
      'ส่งมอบ': [r.result_report_id ? 'รายงาน' : '', num(r.files) > 0 ? `ไฟล์ ${num(r.files)}` : '']
        .filter(Boolean)
        .join(' + '),
      'ระดับข้อมูล': DATA_LEVEL_LABELS[r.data_level as DataLevel] ?? r.data_level,
    }
  })
}
