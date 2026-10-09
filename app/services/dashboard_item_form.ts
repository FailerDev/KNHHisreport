import { normalizeSql } from '#services/his_sql_guard'

/** Validated form payload of the dashboard-settings modal. */
export interface DashboardItemInput {
  detail: string
  sql1: string
  sort?: number | null
  link_id?: string | null
  icons?: string | null
  color1?: string | null
  chart_type: string
  chart_name?: string | null
  chart_sql?: string | null
  chart_color?: string | null
}

/** The stored fields we must not clobber when editing a legacy row. */
export interface ExistingDashboardItem {
  sql1: string | null
  color1: string | null
  pieShow: string | null
  chartType: string | null
  chartSql: string | null
}

/**
 * Font Awesome class from what the admin typed: `users` → `fa-users`.
 * Legacy Themify names (`ti-*`) and multi-class values (`fas fa-users`) are
 * kept as-is.
 */
export function normalizeIcon(raw: string | null | undefined): string {
  const v = String(raw ?? '').trim()
  if (!v) return 'ti-bar-chart'
  if (/\s/.test(v) || v.startsWith('fa-') || v.startsWith('ti-')) return v
  return `fa-${v}`
}

/**
 * Map the form payload onto model attributes.
 *
 * Editing must round-trip legacy data the form can't express:
 *   - `sort` empty → NULL (tile hidden from /dashboard), never forced to 1.
 *   - chart name/SQL/colour are kept when the chart is switched off, and the
 *     legacy PHP `pie_show` flag is left alone, so a rollback to PHP still
 *     sees its pie configuration.
 *   - a colour the select can't represent is not submitted → keep the old one.
 */
export function buildDashboardItemAttributes(
  payload: DashboardItemInput,
  existing?: ExistingDashboardItem | null
) {
  const isChart = payload.chart_type !== 'none'
  return {
    detail: payload.detail,
    sql1: payload.sql1,
    sort: payload.sort ?? null,
    linkId: payload.link_id?.trim() ? payload.link_id.trim() : null,
    icons: normalizeIcon(payload.icons),
    color1: payload.color1 || existing?.color1 || 'icon-info',
    pieName: payload.chart_name ?? '',
    pieShow: isChart ? 'y' : (existing?.pieShow ?? 'n'),
    chartType: payload.chart_type,
    chartSql: payload.chart_sql ?? '',
    chartColor: payload.chart_color || 'default',
  }
}

/**
 * Which SQL needs to be (re)checked against HIS on save. Unchanged SQL is
 * skipped so admins can still rename / reorder tiles while HIS is down.
 */
export function sqlToVerify(payload: DashboardItemInput, existing?: ExistingDashboardItem | null) {
  const mainChanged = !existing || normalizeSql(payload.sql1) !== normalizeSql(existing.sql1)
  const isChart = payload.chart_type !== 'none'
  const chartWasOn = !!existing && (existing.chartType ?? 'none') !== 'none'
  const chartChanged =
    isChart && (!chartWasOn || normalizeSql(payload.chart_sql) !== normalizeSql(existing?.chartSql))
  return { main: mainChanged, chart: chartChanged }
}
