/**
 * Mirrors the PHP `safe_report_title()` helper from
 * `HisReport/includes/functions.php`. Existing report rows in `report_head_detail`
 * use inline `<font color=red>…</font>` (and friends) for visual emphasis, so the
 * Adonis port must render those tags verbatim while still stripping anything
 * that could lead to XSS.
 */

const ALLOWED_TAGS = new Set([
  'font',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'small',
  'sub',
  'sup',
  'br',
  'span',
])

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
}

function decodeEntities(input: string): string {
  let prev = ''
  let out = input
  while (prev !== out) {
    prev = out
    out = out
      .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITY_MAP[m] ?? m)
      .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  }
  return out
}

/**
 * Sanitize HTML for report titles. Returns a string suitable to print as raw
 * HTML (via Edge's `{{{ }}}`). Allows the same whitelist as PHP and removes
 * on*-style event handler attributes and `javascript:` URIs.
 */
export function safeReportTitle(input: unknown): string {
  if (input === null || input === undefined || input === '') return ''
  let html = decodeEntities(String(input))

  // Strip any tag that isn't on the allow-list. Mirrors `strip_tags($html, $allowed)`.
  html = html.replace(/<\/?\s*([a-z][a-z0-9]*)\b[^>]*>/gi, (match, tag) => {
    return ALLOWED_TAGS.has(String(tag).toLowerCase()) ? match : ''
  })

  // Drop event-handler attributes (onclick=, onerror=, …) from allowed tags.
  html = html.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')

  // Drop javascript: URIs anywhere they appear.
  html = html.replace(/javascript\s*:/gi, '')

  return html
}

/**
 * Plain-text version of the title — used in <title>, data-search attributes,
 * Excel exports, and anywhere HTML markup must NOT appear. Mirrors the
 * `htmlspecialchars(strip_tags(...))` pattern from the PHP templates (Edge's
 * `{{ }}` will handle the htmlspecialchars half).
 */
export function stripTitleHtml(input: unknown): string {
  if (input === null || input === undefined || input === '') return ''
  return decodeEntities(String(input))
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export type TitleNoteTone = 'bad' | 'info' | 'muted'
export interface ReportTitleParts {
  no: string | null
  title: string
  notes: { text: string; tone: TitleNoteTone }[]
}

function noteTone(color: string): TitleNoteTone {
  const c = color.toLowerCase()
  if (/red|#f00|#ff0000|crimson|maroon|orange/.test(c)) return 'bad'
  if (/blue|#00f|#0000ff|navy|green|purple/.test(c)) return 'info'
  return 'muted'
}

/**
 * Splits a legacy report title like
 * `01.รายชื่อผู้ป่วย OPD <font color=blue>(ระบุวันได้)</font>` into its running
 * number, plain-text title and coloured parenthetical notes so the list can
 * render them as a badge + tags instead of inline red/blue text.
 */
export function reportTitleParts(input: unknown): ReportTitleParts {
  const notes: ReportTitleParts['notes'] = []
  let html = decodeEntities(String(input ?? ''))

  html = html.replace(
    /<font\b([^>]*)>([\s\S]*?)<\/font>/gi,
    (_match, attrs: string, inner: string) => {
      const text = stripTitleHtml(inner)
      if (!/^\(.*\)$/.test(text)) return ` ${text} `
      const color = /color\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1] ?? ''
      notes.push({ text: text.slice(1, -1).trim(), tone: noteTone(color) })
      return ' '
    }
  )

  let title = stripTitleHtml(html)
  let no: string | null = null
  const m = /^(\d{1,3})\s*[.)\-:]\s*(?=\S)/.exec(title)
  if (m) {
    no = m[1].padStart(2, '0')
    title = title.slice(m[0].length)
  }
  return { no, title, notes: notes.filter((n) => n.text) }
}
