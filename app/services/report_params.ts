import db from '@adonisjs/lucid/services/db'
import vine from '@vinejs/vine'
import ReportParameter, { type ReportParamType } from '#models/report_parameter'
import ReportRunner from '#services/report_runner'

export const PARAM_TYPES = ['text', 'number', 'date', 'select', 'datetime', 'textarea'] as const

/**
 * Built-in definitions for the core date/time `@token`s, so imported reports
 * get a usable form without configuring `report_parameters` by hand. Every
 * other token gets a plain text field (label = token name) until an admin
 * configures it on the report's parameter page.
 */
export const KNOWN: Record<string, { label: string; type: ReportParamType; default?: string; required?: boolean }> = {
  start_d: { label: 'วันที่เริ่มต้น', type: 'date', required: true },
  end_d: { label: 'วันที่สิ้นสุด', type: 'date', required: true },
  start_t: { label: 'เวลาเริ่มต้น (HH.MM)', type: 'text', default: '08.00', required: true },
  end_t: { label: 'เวลาสิ้นสุด (HH.MM)', type: 'text', default: '16.00', required: true },
}

/** Tokens the runner fills itself — never shown as a form field. */
export const NO_INPUT = new Set(['chknull'])

function stub(name: string, sortOrder: number): ReportParameter {
  const k = KNOWN[name]
  const p = new ReportParameter()
  p.paramName = name
  p.paramLabel = k?.label ?? name
  p.paramType = k?.type ?? 'text'
  p.paramDefault = k?.default ?? null
  p.paramRequired = k?.required ?? false
  p.options = null
  p.sortOrder = sortOrder
  return p
}

/**
 * The parameter list a report's form should show: the admin-configured rows,
 * plus an unsaved stub for every `@token` in the SQL that has no row yet.
 * Nothing is written to the DB.
 */
export function effectiveParameters(sql: string | null, configured: ReportParameter[]): ReportParameter[] {
  const have = new Set(configured.map((p) => p.paramName))
  const missing = ReportRunner.detectParameters(sql ?? '').filter((n) => !have.has(n) && !NO_INPUT.has(n))
  const base = configured.reduce((m, p) => Math.max(m, p.sortOrder ?? 0), 0)
  return [...configured, ...missing.map((n, i) => stub(n, base + i + 1))]
}

export async function loadEffectiveParameters(report: { id: number; sql1: string | null }): Promise<ReportParameter[]> {
  const configured = await ReportParameter.query()
    .where('reportId', report.id)
    .orderBy('sortOrder', 'asc')
    .orderBy('paramName', 'asc')
  return effectiveParameters(report.sql1, configured)
}

/**
 * Select options are stored as a JSON array (legacy PHP format). Accepts a
 * JSON array or comma-separated text; other types keep the raw value.
 */
export function normalizeOptions(type: string, raw: string | undefined | null): string | null {
  if (type !== 'select' || !raw) return raw ? raw : null
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return JSON.stringify(parsed.map((o) => String(o)))
  } catch {
    /* fall through */
  }
  const arr = trimmed.split(',').map((v) => v.trim()).filter((v) => v !== '')
  return JSON.stringify(arr)
}

const paramListValidator = vine.compile(
  vine.array(
    vine.object({
      name: vine.string().trim().maxLength(50).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
      label: vine.string().trim().minLength(1).maxLength(100),
      type: vine.enum(PARAM_TYPES),
      default: vine.string().trim().maxLength(255).nullable().optional(),
      required: vine.boolean().optional(),
      options: vine.string().trim().nullable().optional(),
      sort: vine.number().min(1).max(9999).optional(),
    })
  )
)

export type ParamInput = Awaited<ReturnType<typeof paramListValidator.validate>>

/**
 * Parse the `params_json` field the report-settings popup posts. Returns null
 * when the popup was not used (field empty), so parameters stay untouched.
 */
export async function parseParamList(raw: unknown): Promise<ParamInput | null> {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error('ข้อมูลพารามิเตอร์ไม่ถูกต้อง')
  }
  try {
    return await paramListValidator.validate(data)
  } catch (err: any) {
    throw new Error(`พารามิเตอร์: ${err?.messages?.[0]?.message ?? 'ข้อมูลไม่ถูกต้อง'}`)
  }
}

/**
 * Make the report's saved parameters match `list`: rows for `@token`s still
 * in the SQL are upserted, every other row (removed tokens) is deleted.
 */
export async function syncReportParameters(reportId: number, sql: string | null, list: ParamInput) {
  const tokens = new Set(ReportRunner.detectParameters(sql ?? '').filter((n) => !NO_INPUT.has(n)))
  const keep = list.filter((p) => tokens.has(p.name))
  await db.transaction(async (trx) => {
    const existing = await ReportParameter.query({ client: trx }).where('reportId', reportId)
    const byName = new Map(existing.map((p) => [p.paramName, p]))
    for (const [i, item] of keep.entries()) {
      const row = byName.get(item.name) ?? new ReportParameter()
      row.useTransaction(trx)
      row.reportId = reportId
      row.paramName = item.name
      row.paramLabel = item.label
      row.paramType = item.type
      row.paramDefault = item.default || null
      row.paramRequired = !!item.required
      row.options = normalizeOptions(item.type, item.options)
      row.sortOrder = item.sort ?? i + 1
      await row.save()
      byName.delete(item.name)
    }
    for (const stale of byName.values()) {
      stale.useTransaction(trx)
      await stale.delete()
    }
  })
}
