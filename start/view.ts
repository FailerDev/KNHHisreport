/*
|--------------------------------------------------------------------------
| Edge globals
|--------------------------------------------------------------------------
|
| Helpers callable from any .edge template. Mirrors the inline-HTML title
| sanitisation behaviour of the legacy PHP HisReport project.
|
*/

import edge from 'edge.js'
import type { DateTime } from 'luxon'
import { reportTitleParts, safeReportTitle, stripTitleHtml } from '#services/title_html'
import {
  DATA_LEVEL_LABELS,
  LOG_ACTION_LABELS,
  OUTPUT_FORMAT_LABELS,
  statusMeta,
  type DataLevel,
  type OutputFormat,
} from '#services/report_request_flow'

edge.global('safeReportTitle', safeReportTitle)
edge.global('stripTitleHtml', stripTitleHtml)
edge.global('reportTitleParts', reportTitleParts)

// Report-request module labels / formatting
edge.global('requestStatusMeta', statusMeta)
edge.global('requestLogLabel', (action: string) => LOG_ACTION_LABELS[action] ?? action)
edge.global('dataLevelLabel', (v: string) => DATA_LEVEL_LABELS[v as DataLevel] ?? v)
edge.global('outputFormatLabel', (v: string) => OUTPUT_FORMAT_LABELS[v as OutputFormat] ?? v)

/** Luxon DateTime → Thai Buddhist-era date, e.g. 09/10/2569 or 09/10/2569 14:05 */
edge.global('thaiDate', (dt: DateTime | null | undefined, withTime = false) => {
  if (!dt || !dt.isValid) return '—'
  const base = `${dt.toFormat('dd/MM')}/${dt.year + 543}`
  return withTime ? `${base} ${dt.toFormat('HH:mm')}` : base
})
