import db from '@adonisjs/lucid/services/db'

/**
 * Read-only guard + bounded runner for admin-entered SQL that runs against HIS
 * (dashboard tiles/charts).
 *
 * The guard is defence in depth only — the real protection is a HIS DB user
 * with SELECT-only privileges (see DEPLOY.md).
 */

export class UnsafeSqlError extends Error {}

/** Default cap for probe queries (test button / save-time validation). */
export const PROBE_ROW_LIMIT = 50
/** Default wall-clock limit for any HIS query started from the dashboard. */
export const HIS_QUERY_TIMEOUT_MS = 15_000

const FORBIDDEN = [
  // REPLACE(…) / INSERT(…) are also read-only string functions — only the
  // statement forms (not followed by "(") are blocked.
  /\b(INSERT|REPLACE)\b(?!\s*\()/i,
  /\b(UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|RENAME|GRANT|REVOKE)\b/i,
  /\b(LOAD|CALL|HANDLER|LOCK|UNLOCK|EXEC|EXECUTE|PREPARE|DEALLOCATE|INTO)\b/i,
  /\b(SLEEP|BENCHMARK|GET_LOCK|LOAD_FILE)\s*\(/i,
]

/** Trim whitespace and trailing semicolons. */
export function normalizeSql(sql: string | null | undefined): string {
  return String(sql ?? '').trim().replace(/[\s;]+$/, '')
}

/**
 * Replace string literals, quoted identifiers and comments with blanks so the
 * keyword scan only sees real SQL tokens (`WHERE note = 'DELETE'` is fine,
 * `` `update` `` as a column name is fine). MySQL executable comments
 * (`/*! … *\/`) are rejected because their contents do run.
 */
export function stripLiteralsAndComments(sql: string): string {
  let out = ''
  let i = 0
  const n = sql.length
  while (i < n) {
    const c = sql[i]
    const next = sql[i + 1]
    if (c === "'" || c === '"' || c === '`') {
      const q = c
      i++
      while (i < n) {
        if (sql[i] === '\\' && q !== '`') {
          i += 2
          continue
        }
        if (sql[i] === q) {
          if (sql[i + 1] === q) {
            i += 2
            continue
          }
          break
        }
        i++
      }
      i++
      out += ` ${q}${q} `
      continue
    }
    if (c === '/' && next === '*') {
      if (sql[i + 2] === '!') {
        throw new UnsafeSqlError('ไม่อนุญาตให้ใช้ MySQL executable comment (/*! … */)')
      }
      const end = sql.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      out += ' '
      continue
    }
    if ((c === '-' && next === '-') || c === '#') {
      const end = sql.indexOf('\n', i)
      i = end === -1 ? n : end + 1
      out += ' '
      continue
    }
    out += c
    i++
  }
  return out
}

/**
 * Throws UnsafeSqlError unless `sql` is a single read-only SELECT / WITH
 * statement. Returns the normalized SQL (no trailing `;`).
 */
export function assertReadOnlySql(sql: string): string {
  const normalized = normalizeSql(sql)
  if (!normalized) throw new UnsafeSqlError('กรุณากรอก SQL')
  const bare = stripLiteralsAndComments(normalized).trim()

  if (bare.includes(';')) {
    throw new UnsafeSqlError('อนุญาตเพียงคำสั่งเดียว (ห้ามมี ; คั่นหลายคำสั่ง)')
  }
  if (!/^\(*\s*(SELECT|WITH)\b/i.test(bare)) {
    throw new UnsafeSqlError('อนุญาตเฉพาะคำสั่ง SELECT (หรือ WITH … SELECT) เท่านั้น')
  }
  for (const re of FORBIDDEN) {
    const m = bare.match(re)
    if (m) {
      throw new UnsafeSqlError(`SQL มีคำสั่งที่ไม่อนุญาต: ${m[1].toUpperCase()} (อนุญาตเฉพาะการอ่านข้อมูล)`)
    }
  }
  return normalized
}

export function extractRows(result: any): any[] {
  return Array.isArray(result?.[0]) ? result[0] : Array.isArray(result) ? result : []
}

/** Run raw SQL with a server-side cancel after `timeoutMs`. */
export async function runQuery(
  connection: string,
  sql: string,
  timeoutMs = HIS_QUERY_TIMEOUT_MS
): Promise<any[]> {
  const result = await db.connection(connection).rawQuery(sql).timeout(timeoutMs, { cancel: true })
  return extractRows(result)
}

/** Run raw SQL on HIS with a server-side cancel after `timeoutMs`. */
export function runHisQuery(sql: string, timeoutMs = HIS_QUERY_TIMEOUT_MS): Promise<any[]> {
  return runQuery('his', sql, timeoutMs)
}

export interface ProbeResult {
  rows: any[]
  /** true when the result was capped at `limit` (there may be more rows). */
  truncated: boolean
  execMs: number
}

export interface ProbeOptions {
  limit?: number
  timeoutMs?: number
}

/**
 * Run a guarded SELECT on HIS but only pull back `limit` rows, so a careless
 * test of a huge query can't load the whole result into memory.
 */
export function probeHisQuery(sql: string, opts: ProbeOptions = {}): Promise<ProbeResult> {
  return probeQuery('his', sql, opts)
}

/**
 * probeHisQuery() against any Lucid connection (e.g. 'mysql' for system
 * reports). Wrapping as a derived table fails for some valid queries
 * (duplicate column names, CTEs on MySQL 5.x) — in that case fall back to the
 * plain query, still time-boxed.
 */
export async function probeQuery(
  connection: string,
  sql: string,
  { limit = PROBE_ROW_LIMIT, timeoutMs = HIS_QUERY_TIMEOUT_MS }: ProbeOptions = {}
): Promise<ProbeResult> {
  const safe = assertReadOnlySql(sql)
  const start = Date.now()
  let rows: any[]
  try {
    rows = await runQuery(connection, `SELECT * FROM (\n${safe}\n) AS _hr_probe LIMIT ${limit + 1}`, timeoutMs)
  } catch (err: any) {
    if (isConnectionError(err) || isTimeoutError(err)) throw err
    rows = await runQuery(connection, safe, timeoutMs)
  }
  const truncated = rows.length > limit
  return { rows: rows.slice(0, limit), truncated, execMs: Date.now() - start }
}

const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'PROTOCOL_CONNECTION_LOST',
  'ER_ACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
  'ER_CON_COUNT_ERROR',
])

/** True when the error means "couldn't reach HIS" rather than "bad SQL". */
export function isConnectionError(err: any): boolean {
  if (CONNECTION_CODES.has(err?.code)) return true
  return /Knex: Timeout acquiring a connection/i.test(String(err?.message ?? ''))
}

export function isTimeoutError(err: any): boolean {
  return err?.name === 'KnexTimeoutError' || /Defined query timeout/i.test(String(err?.message ?? ''))
}

/** Human-readable (Thai) message for a failed HIS query. */
export function describeHisError(err: any, timeoutMs = HIS_QUERY_TIMEOUT_MS): string {
  if (err instanceof UnsafeSqlError) return err.message
  if (isTimeoutError(err)) return `ใช้เวลาเกิน ${timeoutMs / 1000} วินาที — ระบบยกเลิกคำสั่งแล้ว`
  if (isConnectionError(err)) return `เชื่อมต่อ HIS ไม่ได้ (${err?.code ?? err?.message ?? 'unknown'})`
  return err?.sqlMessage ?? err?.message ?? String(err)
}
