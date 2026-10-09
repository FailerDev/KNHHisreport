import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import ReportHead from '#models/report_head'
import ReportHeadDetail from '#models/report_head_detail'
import ReportParameter from '#models/report_parameter'
import ReportRunner, { ReportRunnerError } from '#services/report_runner'
import { stripTitleHtml } from '#services/title_html'
import { buildReportXlsx, collectReportParams, reportXlsxFilename } from '#services/report_excel'

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
    const raw = collectReportParams(request, configured, useDynamic)
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
   * POST /reports/:id/export — download the report results as an xlsx file
   * (layout lives in `#services/report_excel`).
   */
  async export({ params, request, response }: HttpContext) {
    const id = Number(params.id)
    const report = await this.findActiveReport(id)
    if (!report) return response.redirect('/reports')

    const configured = await this.loadParameters(report.id)
    const useDynamic = configured.length > 0
    const raw = collectReportParams(request, configured, useDynamic)
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
    const buf = await buildReportXlsx(plainTitle, runResult, raw, configured)
    const filename = reportXlsxFilename(plainTitle)
    response.header(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    response.header(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`
    )
    return response.send(buf)
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
}
