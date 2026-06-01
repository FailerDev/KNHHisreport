import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import ExcelJS from 'exceljs'
import ReportHead from '#models/report_head'
import ReportHeadDetail from '#models/report_head_detail'
import ReportParameter from '#models/report_parameter'
import ReportRunner, { ReportRunnerError, RawParams } from '#services/report_runner'
import { stripTitleHtml } from '#services/title_html'

export default class ReportsController {
  async index({ view, request }: HttpContext) {
    const dep = Number(request.input('dep') ?? '0')
    const allHeads = await ReportHead.query().where('status', 1).orderBy('sort', 'asc')
    const headsToShow = dep > 0 ? allHeads.filter((h) => h.id === dep) : allHeads

    const reportsByHead: Record<number, ReportHeadDetail[]> = {}
    let totalReports = 0
    for (const h of headsToShow) {
      const list = await ReportHeadDetail.query()
        .where('headId', h.id)
        .where('status', 1)
        .orderBy('sort', 'asc')
        .orderBy('detail', 'asc')
      reportsByHead[h.id] = list
      totalReports += list.length
    }

    return view.render('pages/reports/index', {
      heads: headsToShow,
      allHeads,
      reportsByHead,
      dep,
      search: request.input('search', ''),
      stats: { categories: headsToShow.length, total: totalReports },
    })
  }

  async show({ params, view, response }: HttpContext) {
    const id = Number(params.id)
    const report = await this.findActiveReport(id)
    if (!report) return response.redirect('/reports')
    const configured = await this.loadParameters(report.id)
    const detected = ReportRunner.detectParameters(report.sql1 ?? '')
    const hasPlaceholders = detected.length > 0
    const useDynamic = configured.length > 0

    const values: Record<string, string> = {}
    for (const p of configured) {
      let def = p.paramDefault ?? ''
      if (!def) {
        if (p.paramType === 'date') def = DateTime.now().toFormat('yyyy-MM-dd')
        if (p.paramType === 'datetime') def = DateTime.now().toFormat("yyyy-MM-dd'T'HH:mm")
      }
      values[p.paramName] = def
    }

    let runResult = null
    let error: string | null = null
    if (!hasPlaceholders) {
      try {
        runResult = await ReportRunner.runReport(report, {})
      } catch (e: any) {
        error = e instanceof ReportRunnerError ? e.message : String(e?.message ?? e)
      }
    }

    return view.render('pages/reports/show', {
      report,
      head: await report.related('head').query().first(),
      configured,
      useDynamic,
      hasPlaceholders,
      values,
      validationErrors: [],
      runResult,
      error,
    })
  }

  async run({ params, request, view, response }: HttpContext) {
    const id = Number(params.id)
    const report = await this.findActiveReport(id)
    if (!report) return response.redirect('/reports')

    const configured = await this.loadParameters(report.id)
    const useDynamic = configured.length > 0
    const raw = this.collectParams(request, configured, useDynamic)
    const validationErrors = useDynamic ? ReportRunner.validate(raw, configured) : []

    let runResult = null
    let error: string | null = null
    if (validationErrors.length === 0) {
      try {
        runResult = await ReportRunner.runReport(report, raw)
      } catch (e: any) {
        error = e instanceof ReportRunnerError ? e.message : String(e?.message ?? e)
      }
    }

    const values: Record<string, string> = {}
    for (const p of configured) {
      const v = raw[p.paramName]
      values[p.paramName] = typeof v === 'string' ? v : ''
    }

    return view.render('pages/reports/show', {
      report,
      head: await report.related('head').query().first(),
      configured,
      useDynamic,
      hasPlaceholders: ReportRunner.detectParameters(report.sql1 ?? '').length > 0,
      values,
      validationErrors,
      runResult,
      error,
    })
  }

  /**
   * POST /reports/:id/export — stream the report results as an xlsx file.
   *
   * Layout matches the PHP legacy `export_excel.php` so users get the same
   * shape:
   *   row 1: report title (merged across all columns)
   *   row 2+: "พารามิเตอร์:" header then one row per param (label : value)
   *   blank row
   *   header row
   *   data rows
   *
   * Streamed via `WorkbookWriter` so 20k+ HIS rows don't balloon RAM.
   */
  async export({ params, request, response }: HttpContext) {
    const id = Number(params.id)
    const report = await this.findActiveReport(id)
    if (!report) return response.redirect('/reports')

    const configured = await this.loadParameters(report.id)
    const useDynamic = configured.length > 0
    const raw = this.collectParams(request, configured, useDynamic)
    const validationErrors = useDynamic ? ReportRunner.validate(raw, configured) : []
    if (validationErrors.length > 0) {
      return response.badRequest({ errors: validationErrors })
    }

    let runResult
    try {
      runResult = await ReportRunner.runReport(report, raw)
    } catch (e: any) {
      const msg = e instanceof ReportRunnerError ? e.message : String(e?.message ?? e)
      return response.internalServerError({ error: msg })
    }

    const plainTitle = stripTitleHtml(report.detail) || 'Report'
    const wb = new ExcelJS.Workbook()
    wb.creator = 'HisReport'
    wb.created = new Date()
    const sheet = wb.addWorksheet(this.safeSheetName(plainTitle))

    const colCount = Math.max(runResult.columns.length, 2)
    const lastCol = String.fromCharCode(64 + colCount) // A=65; OK up to 26 cols

    // Title row (merged)
    sheet.addRow([plainTitle])
    sheet.mergeCells(`A1:${lastCol}1`)
    const titleCell = sheet.getCell('A1')
    titleCell.font = { bold: true, size: 14 }
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
    sheet.getRow(1).height = 22

    // Parameters block
    const usedParams = Object.entries(raw).filter(
      ([k, v]) => k && v !== undefined && v !== null && v !== '' && k !== 'dayofweek'
    )
    if (usedParams.length > 0) {
      const hdr = sheet.addRow(['พารามิเตอร์:'])
      hdr.getCell(1).font = { bold: true }
      for (const [k, v] of usedParams) {
        const label = configured.find((c) => c.paramName === k)?.paramLabel ?? k
        const row = sheet.addRow([label, Array.isArray(v) ? v.join(', ') : String(v)])
        row.getCell(1).font = { bold: true }
      }
      sheet.addRow([])
    }

    // Header
    if (runResult.columns.length > 0) {
      const headerRow = sheet.addRow(runResult.columns)
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF3B82F6' },
        }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
      })

      // Data
      for (const row of runResult.rows) {
        sheet.addRow(runResult.columns.map((c) => this.cellValue(row[c])))
      }

      // Auto-width (capped to keep file lean)
      runResult.columns.forEach((col, idx) => {
        const colObj = sheet.getColumn(idx + 1)
        const headerLen = String(col).length
        let max = headerLen
        for (const row of runResult.rows) {
          const len = String(row[col] ?? '').length
          if (len > max) max = len
        }
        colObj.width = Math.min(Math.max(headerLen + 2, max + 1), 40)
      })
    } else {
      sheet.addRow(['ไม่พบข้อมูล'])
    }

    // Stream out
    const filename = `${this.safeFilename(plainTitle)}_${DateTime.now().toFormat('yyyy-MM-dd_HHmm')}.xlsx`
    response.header(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    response.header(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`
    )
    const buf = await wb.xlsx.writeBuffer()
    return response.send(Buffer.from(buf as ArrayBuffer))
  }

  private collectParams(
    request: HttpContext['request'],
    configured: ReportParameter[],
    useDynamic: boolean
  ): RawParams {
    const raw: RawParams = {}
    if (useDynamic) {
      for (const p of configured) {
        const v = request.input(`param_${p.paramName}`)
        raw[p.paramName] = typeof v === 'string' ? v.trim() : v
      }
      return raw
    }
    const grab = (k: string, fb = '') => {
      const v = request.input(k)
      return typeof v === 'string' ? v : fb
    }
    raw.start_d = grab('datepick1')
    raw.end_d = grab('datepick2')
    raw.start_t = grab('start_t', '08.00')
    raw.end_t = grab('end_t', '16.00')
    raw.an = grab('an')
    raw.main_dep = grab('main_dep')
    raw.spclty = grab('spclty')
    raw.drug1 = grab('drug1')
    raw.drug2 = grab('drug2')
    raw.fbs1 = grab('fbs1')
    raw.fbs2 = grab('fbs2')

    const days: string[] = []
    for (let i = 1; i <= 7; i++) {
      const v = request.input(`chk0${i}`)
      if (v) days.push(String(v))
    }
    raw.dayofweek = days.length === 0 ? '1,2,3,4,5,6,7' : days.join(',')
    return raw
  }

  private async findActiveReport(id: number): Promise<ReportHeadDetail | null> {
    if (!Number.isFinite(id) || id <= 0) return null
    return await ReportHeadDetail.query().where('id', id).where('status', 1).first()
  }

  private async loadParameters(reportId: number): Promise<ReportParameter[]> {
    return await ReportParameter.query()
      .where('reportId', reportId)
      .orderBy('sortOrder', 'asc')
      .orderBy('paramName', 'asc')
  }

  /** Excel cell value normalization: render DateTime/Date as ISO string. */
  private cellValue(v: any): any {
    if (v === null || v === undefined) return ''
    if (v instanceof Date) return v
    if (typeof v === 'bigint') return v.toString()
    return v
  }

  /** Excel sheet names are limited to 31 chars and can't contain :\/?*[] */
  private safeSheetName(name: string): string {
    return name.replace(/[:\\/?*\[\]]/g, '_').slice(0, 31) || 'Report'
  }

  private safeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?* -]/g, '_')
      .trim()
      .slice(0, 80) || 'report'
  }
}
