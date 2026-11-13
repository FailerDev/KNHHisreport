import ReportParameter, { type ReportParamType } from '#models/report_parameter'
import ReportRunner from '#services/report_runner'

/**
 * Built-in definitions for the core date/time `@token`s, so imported reports
 * get a usable form without configuring `report_parameters` by hand. Every
 * other token gets a plain text field (label = token name) until an admin
 * configures it on the report's parameter page.
 */
const KNOWN: Record<string, { label: string; type: ReportParamType; default?: string; required?: boolean }> = {
  start_d: { label: 'วันที่เริ่มต้น', type: 'date', required: true },
  end_d: { label: 'วันที่สิ้นสุด', type: 'date', required: true },
  start_t: { label: 'เวลาเริ่มต้น (HH.MM)', type: 'text', default: '08.00', required: true },
  end_t: { label: 'เวลาสิ้นสุด (HH.MM)', type: 'text', default: '16.00', required: true },
}

/** Tokens the runner fills itself — never shown as a form field. */
const NO_INPUT = new Set(['chknull'])

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
