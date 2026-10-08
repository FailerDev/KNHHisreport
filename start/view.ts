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
import { reportTitleParts, safeReportTitle, stripTitleHtml } from '#services/title_html'

edge.global('safeReportTitle', safeReportTitle)
edge.global('stripTitleHtml', stripTitleHtml)
edge.global('reportTitleParts', reportTitleParts)
