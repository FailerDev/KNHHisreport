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
import { safeReportTitle, stripTitleHtml } from '#services/title_html'

edge.global('safeReportTitle', safeReportTitle)
edge.global('stripTitleHtml', stripTitleHtml)
