import logger from '@adonisjs/core/services/logger'

/**
 * MOPH Notify client (หมอพร้อม / morpromt2f) — sends LINE messages into a
 * room identified by its client-key + secret-key pair.
 *
 * Follows the approach proven in KNHLinemoph (app/services/line_api_service.ts)
 * and E:\line\MOPH_FLEX_GUIDE.md:
 *   - The API answers HTTP 200 almost always, even for a wrong key; the real
 *     outcome is the `status` field of the JSON body.
 *   - Retry only 5xx / network errors (300ms, 600ms back-off); 4xx won't change.
 *   - Keep Flex bubbles simple (body only, small) — very large bubbles have
 *     been seen to return status 200 yet never reach the room.
 */

export const DEFAULT_MOPH_API_URL = 'https://morpromt2f.moph.go.th/api/notify/send'

export interface MophTarget {
  apiUrl: string
  clientKey: string
  secretKey: string
}

export type MophMessage =
  | { type: 'text'; text: string }
  | { type: 'flex'; altText: string; contents: Record<string, unknown> }

export interface MophResult {
  ok: boolean
  /** HTTP status (0 = network error / timeout) */
  code: number
  /** `status` from the JSON body, null when the body isn't JSON */
  apiStatus: number | null
  response: string
  attempts: number
}

export async function sendMoph(
  target: MophTarget,
  messages: MophMessage[],
  options: { timeoutSec?: number; maxRetries?: number } = {}
): Promise<MophResult> {
  const timeoutSec = options.timeoutSec ?? 15
  const maxRetries = Math.max(0, options.maxRetries ?? 2)
  const body = JSON.stringify({ messages })
  const headers = {
    'Content-Type': 'application/json',
    'client-key': target.clientKey,
    'secret-key': target.secretKey,
  }

  let last: MophResult = { ok: false, code: 0, apiStatus: null, response: '', attempts: 0 }
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    last = { ...(await doRequest(target.apiUrl, headers, body, timeoutSec)), attempts: attempt }
    if (last.ok) return last

    const clientError =
      (last.code >= 400 && last.code < 500) ||
      (last.apiStatus !== null && last.apiStatus >= 400 && last.apiStatus < 500)
    if (clientError) break
    if (attempt <= maxRetries) await new Promise((r) => setTimeout(r, 300 * 2 ** (attempt - 1)))
  }

  logger.warn(
    { code: last.code, apiStatus: last.apiStatus, response: last.response.slice(0, 300) },
    'MOPH Notify send failed'
  )
  return last
}

async function doRequest(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutSec: number
): Promise<Omit<MophResult, 'attempts'>> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(timeoutSec * 1000),
    })
    const text = await res.text()
    const apiStatus = parseApiStatus(text)
    const httpOk = res.status >= 200 && res.status < 300
    const apiOk = apiStatus === null || (apiStatus >= 200 && apiStatus < 300)
    return { ok: httpOk && apiOk, code: res.status, apiStatus, response: text }
  } catch (err: any) {
    return {
      ok: false,
      code: 0,
      apiStatus: null,
      response: 'Network error: ' + (err?.message ?? String(err)),
    }
  }
}

function parseApiStatus(body: string): number | null {
  try {
    const parsed = JSON.parse(body)
    return parsed && typeof parsed.status === 'number' ? parsed.status : null
  } catch {
    return null
  }
}

/** Human-readable reason for a failed send (shown on the settings page). */
export function describeMophError(r: MophResult): string {
  if (r.code === 0) return r.response
  if (r.apiStatus === 401 || r.code === 401)
    return 'client-key / secret-key ไม่ถูกต้อง (401 Unauthorized)'
  let message = ''
  try {
    message = JSON.parse(r.response)?.message ?? ''
  } catch {}
  return `HTTP ${r.code}${r.apiStatus !== null ? ` · status ${r.apiStatus}` : ''}${message ? ` · ${message}` : ''}`
}

/**
 * Small body-only Flex bubble for a request event: coloured title bar, a few
 * label/value rows and an optional "open" button.
 */
export function requestFlexBubble(opts: {
  title: string
  color: string
  rows: Array<[string, string]>
  url?: string | null
}): Record<string, unknown> {
  const contents: Record<string, unknown>[] = [
    {
      type: 'box',
      layout: 'vertical',
      backgroundColor: opts.color,
      cornerRadius: 'md',
      paddingAll: 'md',
      contents: [{ type: 'text', text: opts.title, weight: 'bold', color: '#FFFFFF', wrap: true }],
    },
    {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      margin: 'lg',
      contents: opts.rows.map(([label, value]) => ({
        type: 'box',
        layout: 'baseline',
        spacing: 'sm',
        contents: [
          { type: 'text', text: label, size: 'sm', color: '#888888', flex: 2 },
          { type: 'text', text: value || '-', size: 'sm', color: '#333333', wrap: true, flex: 5 },
        ],
      })),
    },
  ]
  if (opts.url && /^https?:\/\//.test(opts.url)) {
    contents.push({
      type: 'button',
      style: 'primary',
      color: opts.color,
      height: 'sm',
      margin: 'lg',
      action: { type: 'uri', label: 'เปิดในระบบ', uri: opts.url },
    })
  }
  return {
    type: 'bubble',
    size: 'kilo',
    body: { type: 'box', layout: 'vertical', paddingAll: 'lg', contents },
  }
}
