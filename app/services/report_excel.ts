import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import ExcelJS from 'exceljs'
import type ReportParameter from '#models/report_parameter'
import type { RawParams, ReportRunResult } from '#services/report_runner'

/**
 * Shared report → xlsx export, used by the report page download and by the
 * report-request module (admin "generate file from report").
 */

/**
 * Read report parameters (`param_<name>`) from a submitted form. `params`
 * comes from `loadEffectiveParameters`, so it covers every `@token`.
 */
export function collectReportParams(request: HttpContext['request'], params: ReportParameter[]): RawParams {
  const raw: RawParams = {}
  for (const p of params) {
    const v = request.input(`param_${p.paramName}`)
    raw[p.paramName] = typeof v === 'string' ? v.trim() : v
  }
  return raw
}

/**
 * Build the xlsx. Layout matches the PHP legacy `export_excel.php`:
 *   row 1: report title (merged across all columns)
 *   row 2+: "พารามิเตอร์:" header then one row per param (label : value)
 *   blank row
 *   header row
 *   data rows
 */
export async function buildReportXlsx(
  plainTitle: string,
  runResult: ReportRunResult,
  raw: RawParams,
  configured: ReportParameter[]
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'HisReport'
  wb.created = new Date()
  const sheet = wb.addWorksheet(safeSheetName(plainTitle))

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
      sheet.addRow(runResult.columns.map((c) => cellValue(row[c])))
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

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf as ArrayBuffer)
}

/** `<title>_<yyyy-MM-dd_HHmm>.xlsx`, safe for Content-Disposition and disks. */
export function reportXlsxFilename(plainTitle: string): string {
  return `${safeFilename(plainTitle)}_${DateTime.now().toFormat('yyyy-MM-dd_HHmm')}.xlsx`
}

/** Excel cell value normalization: render DateTime/Date as ISO string. */
function cellValue(v: any): any {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v
  if (typeof v === 'bigint') return v.toString()
  return v
}

/** Excel sheet names are limited to 31 chars and can't contain :\/?*[] */
function safeSheetName(name: string): string {
  return name.replace(/[:\\/?*\[\]]/g, '_').slice(0, 31) || 'Report'
}

function safeFilename(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?* -]/g, '_')
      .trim()
      .slice(0, 80) || 'report'
  )
}
