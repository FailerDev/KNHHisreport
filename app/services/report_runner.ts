import db from '@adonisjs/lucid/services/db'
import ReportHeadDetail from '#models/report_head_detail'
import ReportParameter from '#models/report_parameter'

const RESERVED_PARAMS = new Set([
  'start_d',
  'end_d',
  'start_t',
  'end_t',
  'an',
  'main_dep',
  'spclty',
  'drug1',
  'drug2',
  'fbs1',
  'fbs2',
  'dayofweek',
  'chknull',
])

export type RawParams = Record<string, string | string[] | undefined>

export interface ReportRunResult {
  rows: any[]
  columns: string[]
  count: number
  sql: string
  source: 'system' | 'his'
}

export class ReportRunnerError extends Error {
  public readonly sql?: string
  constructor(message: string, sql?: string) {
    super(message)
    this.sql = sql
  }
}

/**
 * ReportRunner — ports the dynamic-SQL execution path from
 * `includes/functions.php::executeQueryWithParameters` / `processSQLParameters`
 * onto Lucid.
 *
 * The legacy PHP system uses string substitution against `@token` placeholders.
 * We mirror its semantics 1:1 so existing report rows in `report_head_detail`
 * keep working without rewrites:
 *   - `@start_d` / `@end_d` → `'YYYY-MM-DD'` (accepts dd/mm/yyyy from PHP forms)
 *   - `@start_t` / `@end_t` → `'HH:MM'` (PHP form uses "HH.MM")
 *   - `@an`, `@drug1`, `@drug2`, `@fbs1`, `@fbs2` → quoted string
 *   - `@main_dep`: literal "all" → `BETWEEN '0' AND '999'`, else `= 'value'`
 *   - `@spclty`: literal "00" → `IN ('01',…'20')`, else `= 'value'`
 *   - `@dayofweek` → raw comma-separated string (used inside `IN (...)`)
 *   - Generic: any other `@name` matching a key in `parameters` is quoted
 *     ('' → empty quoted, numeric → bare, otherwise SQL-quote with `''` escape)
 *
 * ⚠️ This is a templating-based substitution layer, NOT prepared statements.
 * The legacy app assumes admin-trusted SQL in `report_head_detail.sql1`. The
 * end user only supplies parameter values, which are escaped via single-quote
 * doubling. We refuse multi-statement queries (semicolon outside strings) as
 * a defense-in-depth measure.
 */
export class ReportRunner {
  /**
   * Substitute `@param` tokens in a SQL template.
   * Public for testing — controller uses `runReport` which calls this internally.
   */
  static processSql(sql: string, parameters: RawParams): string {
    // Hide MySQL session vars (`@@name`) behind a sentinel so the @-token
    // substitutions below cannot match the `@name` inside `@@name`. Restored
    // before returning.
    const SENTINEL = 'AT_AT'
    let processed = sql.replaceAll('@@', SENTINEL)

    if (parameters.start_d) {
      processed = processed.replaceAll('@start_d', `'${this.normalizeDate(parameters.start_d as string)}'`)
    }
    if (parameters.end_d) {
      processed = processed.replaceAll('@end_d', `'${this.normalizeDate(parameters.end_d as string)}'`)
    }
    if (parameters.start_t !== undefined) {
      processed = processed.replaceAll('@start_t', `'${String(parameters.start_t).replace('.', ':')}'`)
    }
    if (parameters.end_t !== undefined) {
      processed = processed.replaceAll('@end_t', `'${String(parameters.end_t).replace('.', ':')}'`)
    }

    for (const k of ['an', 'drug1', 'drug2', 'fbs1', 'fbs2'] as const) {
      const v = parameters[k]
      if (v) processed = processed.replaceAll(`@${k}`, `'${this.escapeSql(String(v))}'`)
    }

    if (parameters.main_dep) {
      const v = String(parameters.main_dep)
      processed = processed.replaceAll(
        '@main_dep',
        v === 'all' ? `BETWEEN '0' AND '999'` : `= '${this.escapeSql(v)}'`
      )
    }
    if (parameters.spclty) {
      const v = String(parameters.spclty)
      if (v === '00') {
        const all = Array.from({ length: 20 }, (_, i) => `'${String(i + 1).padStart(2, '0')}'`).join(',')
        processed = processed.replaceAll('@spclty', `IN (${all})`)
      } else {
        processed = processed.replaceAll('@spclty', `= '${this.escapeSql(v)}'`)
      }
    }
    if (parameters.dayofweek) {
      // dayofweek is used inline as `IN (@dayofweek)` — no quoting.
      processed = processed.replaceAll('@dayofweek', String(parameters.dayofweek))
    }

    // Generic substitution for any other @name.
    for (const [key, raw] of Object.entries(parameters)) {
      if (!key || RESERVED_PARAMS.has(key)) continue
      if (Array.isArray(raw)) continue
      const token = `@${key}`
      if (!processed.includes(token)) continue
      const v = raw ?? ''
      let replacement: string
      if (v === '' || v === null || v === undefined) {
        replacement = `''`
      } else if (/^-?\d+(\.\d+)?$/.test(String(v))) {
        replacement = String(v)
      } else {
        replacement = `'${this.escapeSql(String(v))}'`
      }
      processed = processed.replaceAll(token, replacement)
    }

    return processed.replaceAll(SENTINEL, '@@')
  }

  /**
   * Find `@param` references in a SQL template, ignoring MySQL `@@var` and
   * tokens that appear inside quoted strings.
   */
  static detectParameters(sql: string): string[] {
    if (!sql) return []
    let clean = sql.replace(/@@/g, '')
    clean = clean.replace(/'(?:[^'\\]|\\.)*'/g, '')
    clean = clean.replace(/"(?:[^"\\]|\\.)*"/g, '')
    const matches = clean.matchAll(/@([a-zA-Z_][a-zA-Z0-9_]*)/g)
    return Array.from(new Set(Array.from(matches, (m) => m[1])))
  }

  /**
   * Validate user-supplied parameter values against the admin's parameter
   * definitions (required flag, type sanity-check).
   */
  static validate(parameters: RawParams, configured: ReportParameter[]): string[] {
    const errors: string[] = []
    for (const p of configured) {
      const v = parameters[p.paramName]
      const isEmpty = v === undefined || v === null || v === ''
      if (p.paramRequired && isEmpty) {
        errors.push(`พารามิเตอร์ '${p.paramLabel}' จำเป็นต้องกรอก`)
        continue
      }
      if (isEmpty) continue
      const value = String(v)
      switch (p.paramType) {
        case 'number':
          if (!/^-?\d+(\.\d+)?$/.test(value))
            errors.push(`พารามิเตอร์ '${p.paramLabel}' ต้องเป็นตัวเลข`)
          break
        case 'date':
        case 'datetime':
          if (Number.isNaN(Date.parse(this.normalizeDate(value))))
            errors.push(`พารามิเตอร์ '${p.paramLabel}' ต้องเป็นวันที่ที่ถูกต้อง`)
          break
      }
    }
    return errors
  }

  /**
   * Run a report: substitute, defend, execute against the right Lucid
   * connection, return rows + metadata.
   */
  static async runReport(report: ReportHeadDetail, parameters: RawParams): Promise<ReportRunResult> {
    const source: 'system' | 'his' = (report.databaseSource ?? 'system') === 'his' ? 'his' : 'system'
    const sql = this.processSql(report.sql1 ?? '', parameters)

    this.assertSingleStatement(sql)
    this.assertReadOnly(sql)

    const connection = source === 'his' ? 'his' : 'mysql'
    if (source === 'his' && !db.manager.has('his')) {
      throw new ReportRunnerError(
        'ยังไม่ได้ตั้งค่าการเชื่อมต่อ HIS Database — กรุณาตั้งค่าที่หน้า "ตั้งค่า HIS"',
        sql
      )
    }

    try {
      const result = (await db.connection(connection).rawQuery(sql)) as any
      const rows: any[] = Array.isArray(result?.[0]) ? result[0] : Array.isArray(result) ? result : []
      const columns = rows[0] ? Object.keys(rows[0]) : []
      return { rows, columns, count: rows.length, sql, source }
    } catch (err: any) {
      throw new ReportRunnerError(err?.message ?? String(err), sql)
    }
  }

  // ───────────────────────── helpers ─────────────────────────

  /** dd/mm/yyyy → yyyy-mm-dd, passthrough otherwise. */
  private static normalizeDate(input: string): string {
    const m = String(input).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (!m) return input
    const [, d, mo, y] = m
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  private static escapeSql(value: string): string {
    return value.replace(/'/g, "''")
  }

  /**
   * Block multi-statement payloads by checking for a semicolon outside of
   * string literals. Defense-in-depth — the substitution layer already
   * escapes single quotes, but this catches templates that mistakenly use
   * raw unquoted user input.
   */
  private static assertSingleStatement(sql: string): void {
    const stripped = sql.replace(/'(?:[^'\\]|\\.)*'/g, '').replace(/"(?:[^"\\]|\\.)*"/g, '')
    const idx = stripped.indexOf(';')
    if (idx !== -1 && stripped.slice(idx + 1).trim() !== '') {
      throw new ReportRunnerError(
        'รายงานมีคำสั่ง SQL หลายคำสั่ง ไม่อนุญาตให้รัน (ตรวจสอบ template)',
        sql
      )
    }
  }

  /**
   * Refuse anything that isn't an obvious read-only query. Same allow-list
   * as the PHP `validateSQL` but enforced on every run (not just admin test).
   */
  private static assertReadOnly(sql: string): void {
    const forbidden = /\b(DROP|DELETE|TRUNCATE|ALTER|CREATE|INSERT|UPDATE|GRANT|REVOKE|EXEC)\b/i
    if (forbidden.test(sql)) {
      throw new ReportRunnerError('รายงานนี้มีคำสั่ง SQL ที่ไม่อนุญาต (เฉพาะ SELECT/SHOW)', sql)
    }
  }
}

export default ReportRunner
