import { DateTime } from 'luxon'

/**
 * Pure rules for the data/report request workflow — no DB access, so they
 * can be unit-tested directly and shared by models, controllers and views.
 *
 *   pending ──approve──▶ in_progress ──complete──▶ completed
 *      │                     │
 *      ├──reject──▶ rejected ◀──reject (ทำไม่ได้)──┘
 *      └──cancel (ผู้ขอ)──▶ cancelled
 *
 * "อนุมัติ" and "กำลังจัดทำ" are the same state (in_progress): any admin who
 * approves a request also takes it on.
 */

export const REQUEST_STATUSES = [
  'pending',
  'in_progress',
  'completed',
  'rejected',
  'cancelled',
] as const
export type RequestStatus = (typeof REQUEST_STATUSES)[number]

export const DATA_LEVELS = ['aggregate', 'identifiable'] as const
export type DataLevel = (typeof DATA_LEVELS)[number]

export const OUTPUT_FORMATS = ['xlsx', 'csv', 'pdf', 'any'] as const
export type OutputFormat = (typeof OUTPUT_FORMATS)[number]

export const UPLOAD_EXTNAMES = ['xlsx', 'xls', 'csv', 'pdf']

const TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  pending: ['in_progress', 'rejected', 'cancelled'],
  in_progress: ['completed', 'rejected'],
  completed: [],
  rejected: [],
  cancelled: [],
}

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

export function isOpenStatus(status: RequestStatus): boolean {
  return status === 'pending' || status === 'in_progress'
}

/**
 * Thai government fiscal year (ปีงบประมาณ) in Buddhist Era. FY starts on
 * 1 October, so 2026-10-09 belongs to ปีงบ 2570 and 2026-09-30 to 2569.
 */
export function fiscalYearBE(date: DateTime): number {
  const ce = date.month >= 10 ? date.year + 1 : date.year
  return ce + 543
}

export function formatReqNo(fiscalYear: number, runningNo: number): string {
  return `REQ-${fiscalYear}-${String(runningNo).padStart(4, '0')}`
}

export interface StatusMeta {
  label: string
  badge: string // hic-badge-* modifier
  icon: string // font-awesome icon name
}

export const STATUS_META: Record<RequestStatus, StatusMeta> = {
  pending: { label: 'รอตรวจสอบ', badge: 'hic-badge-warn', icon: 'fa-hourglass-half' },
  in_progress: { label: 'กำลังจัดทำ', badge: 'hic-badge-brand', icon: 'fa-gears' },
  completed: { label: 'เสร็จสิ้น', badge: 'hic-badge-ok', icon: 'fa-circle-check' },
  rejected: { label: 'ไม่อนุมัติ', badge: 'hic-badge-bad', icon: 'fa-circle-xmark' },
  cancelled: { label: 'ยกเลิก', badge: 'hic-badge-muted', icon: 'fa-ban' },
}

export function statusMeta(status: string): StatusMeta {
  return (
    STATUS_META[status as RequestStatus] ?? {
      label: status,
      badge: 'hic-badge-muted',
      icon: 'fa-circle',
    }
  )
}

export const LOG_ACTION_LABELS: Record<string, string> = {
  create: 'ส่งคำขอ',
  approve: 'อนุมัติ / รับงาน',
  reject: 'ไม่อนุมัติ',
  cancel: 'ผู้ขอยกเลิกคำขอ',
  upload: 'แนบไฟล์',
  generate: 'สร้างไฟล์จากรายงานในระบบ',
  delete_file: 'ลบไฟล์',
  complete: 'จัดทำเสร็จสิ้น',
  promote: 'บันทึกเป็นรายงานถาวร',
  purge: 'ลบไฟล์ตามระยะเวลาจัดเก็บ (PDPA)',
}

export const DATA_LEVEL_LABELS: Record<DataLevel, string> = {
  aggregate: 'ข้อมูลสรุป (ตัวเลข/สถิติ)',
  identifiable: 'ข้อมูลรายบุคคล (มี HN/ชื่อ)',
}

export const OUTPUT_FORMAT_LABELS: Record<OutputFormat, string> = {
  xlsx: 'Excel (.xlsx)',
  csv: 'CSV',
  pdf: 'PDF',
  any: 'รูปแบบใดก็ได้',
}

/**
 * When the result files of a request will be auto-deleted (PDPA retention),
 * or null if the request is not subject to it. Only identifiable requests
 * that are completed and not yet purged qualify.
 */
export function filePurgeDate(
  req: {
    dataLevel: string
    status: string
    completedAt: DateTime | null
    filesPurgedAt: DateTime | null
  },
  days: number
): DateTime | null {
  if (req.dataLevel !== 'identifiable' || req.status !== 'completed') return null
  if (!req.completedAt || req.filesPurgedAt) return null
  return req.completedAt.plus({ days })
}
