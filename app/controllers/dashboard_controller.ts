import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import DashboardItem from '#models/dashboard_item'
import hisDb from '#services/his_db'
import dashboardDataCache from '#services/dashboard_cache'

interface ItemMeta {
  id: number
  title: string
  icon: string
  color: string
  link_id: string | null
  sort: number
  chart_type: string
  chart_name: string
}

interface ChartData {
  id: number
  title: string
  type: string
  labels: string[]
  values: number[]
  colors: string[]
  status: 'ok' | 'empty' | 'error' | 'invalid'
  message: string
}

interface DashboardPayload {
  his_status: any
  items: ItemMeta[]
  counts: Record<string, number | null>
  charts: ChartData[]
  summary: {
    total_services: number
    active_items: number
    chart_count: number
  }
  generated_at: string
  generated_ts: number
}

const CHART_PALETTES: Record<string, string[]> = {
  default: ['#0EA5E9', '#14B8A6', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#84CC16', '#F97316', '#EC4899', '#6366F1'],
  blue: ['#0369A1', '#0284C7', '#0EA5E9', '#38BDF8', '#7DD3FC', '#BAE6FD'],
  green: ['#047857', '#059669', '#10B981', '#34D399', '#6EE7B7', '#A7F3D0'],
  red: ['#B91C1C', '#DC2626', '#EF4444', '#F87171', '#FCA5A5', '#FECACA'],
  purple: ['#7E22CE', '#9333EA', '#A855F7', '#C084FC', '#D8B4FE', '#E9D5FF'],
  orange: ['#C2410C', '#EA580C', '#F97316', '#FB923C', '#FDBA74', '#FED7AA'],
}

function chartColor(index: number, scheme: string = 'default'): string {
  const palette = CHART_PALETTES[scheme] ?? CHART_PALETTES.default
  return palette[(index - 1) % palette.length]
}


export default class DashboardController {
  /**
   * GET /dashboard — render the skeleton + load items metadata from system DB.
   * Heavy lifting (HIS counts/charts) happens via the JSON endpoint.
   */
  async index({ view, auth }: HttpContext) {
    const items = await DashboardItem.query()
      .whereNotNull('sort')
      .orderBy('sort', 'asc')
    const user = auth.user as any
    return view.render('pages/dashboard_widgets', {
      items: items.map(this.publicItem),
      isAdmin: user?.userLevel === 'admin',
    })
  }

  /**
   * GET /dashboard/data — JSON hydration endpoint. Returns cached payload
   * unless ?nocache=1 is provided.
   */
  async data({ request, response }: HttpContext) {
    const noCache = !!request.input('nocache')
    if (!noCache) {
      const cached = dashboardDataCache.get()
      if (cached) {
        return response.json({
          ...cached.data,
          from_cache: true,
          age_seconds: cached.ageSeconds,
        })
      }
    }

    try {
      const his_status = await hisDb.checkStatus()
      const items = await DashboardItem.query()
        .whereNotNull('sort')
        .orderBy('sort', 'asc')

      // Run all count queries in parallel against HIS.
      const counts: Record<string, number | null> = {}
      let totalServices = 0
      const countPromises = items.map(async (item) => {
        const c = await this.runCount(item.sql1)
        counts[String(item.id)] = c
        if (typeof c === 'number' && Number.isFinite(c)) totalServices += c
      })
      await Promise.all(countPromises)

      // Charts (only items with a chart_sql and chart_type != 'none').
      const chartItems = items.filter(
        (i) => i.chartType && i.chartType !== 'none' && i.chartSql && i.chartSql.trim() !== ''
      )
      const charts: ChartData[] = []
      for (const i of chartItems) {
        charts.push(await this.runChart(i))
      }

      const payload: DashboardPayload = {
        his_status,
        items: items.map(this.publicItem),
        counts,
        charts,
        summary: {
          total_services: totalServices,
          active_items: items.length,
          chart_count: chartItems.length,
        },
        generated_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
        generated_ts: Math.floor(Date.now() / 1000),
      }

      dashboardDataCache.set(payload)
      return response.json({ ...payload, from_cache: false, age_seconds: 0 })
    } catch (err: any) {
      return response.internalServerError({
        error: 'Server error',
        message: err?.message ?? String(err),
      })
    }
  }

  // ───────────────────────── helpers ─────────────────────────

  private publicItem = (item: DashboardItem): ItemMeta => ({
    id: item.id,
    title: item.detail || 'ไม่มีชื่อ',
    icon: item.icons || 'ti-bar-chart',
    color: item.color1 || 'icon-info',
    link_id: item.linkId,
    sort: item.sort ?? 999,
    chart_type: item.chartType ?? 'none',
    chart_name: item.pieName ?? '',
  })

  private async runCount(sql: string | null): Promise<number | null> {
    if (!sql || !sql.trim()) return null
    if (!db.manager.has('his')) return null
    try {
      const result = (await db.connection('his').rawQuery(sql)) as any
      const rows: any[] = Array.isArray(result?.[0]) ? result[0] : Array.isArray(result) ? result : []
      const first = rows[0]
      if (!first || typeof first !== 'object') return null
      const val = first[Object.keys(first)[0]]
      if (typeof val === 'number') return Number.isFinite(val) ? val : null
      if (typeof val === 'string' && val.trim() !== '' && !Number.isNaN(Number(val))) return Number(val)
      return null
    } catch {
      return null
    }
  }

  private async runChart(item: DashboardItem): Promise<ChartData> {
    const entry: ChartData = {
      id: item.id,
      title: item.pieName?.trim() || item.detail || 'Chart',
      type: item.chartType ?? 'none',
      labels: [],
      values: [],
      colors: [],
      status: 'empty',
      message: '',
    }
    if (!db.manager.has('his')) {
      entry.status = 'error'
      entry.message = 'HIS connection not configured'
      return entry
    }
    try {
      const result = (await db.connection('his').rawQuery(item.chartSql!)) as any
      const rows: any[] = Array.isArray(result?.[0]) ? result[0] : Array.isArray(result) ? result : []
      if (rows.length === 0) {
        entry.message = 'ยังไม่มีข้อมูลตามเงื่อนไข'
        return entry
      }
      const sample = rows[0]
      if (!sample || Object.keys(sample).length < 2) {
        entry.status = 'invalid'
        entry.message = 'SQL ต้องคืนอย่างน้อย 2 คอลัมน์ (label, value)'
        return entry
      }
      const keys = Object.keys(sample)
      const labelKey = keys[0]
      // Pick the first numeric value column after the label.
      let valueKey = keys[1]
      for (let i = 1; i < keys.length; i++) {
        const c = sample[keys[i]]
        if (typeof c === 'number' || (typeof c === 'string' && !Number.isNaN(Number(c.trim())))) {
          valueKey = keys[i]
          break
        }
      }
      const scheme = item.chartColor || 'default'
      for (const row of rows) {
        entry.labels.push(String(row[labelKey] ?? 'Unknown'))
        const v = row[valueKey] ?? 0
        const num = typeof v === 'number' ? v : Number(String(v).trim())
        entry.values.push(Number.isFinite(num) ? num : 0)
        entry.colors.push(chartColor(entry.labels.length, scheme))
      }
      entry.status = entry.labels.length > 0 ? 'ok' : 'empty'
      if (entry.status === 'empty' && !entry.message) entry.message = 'ยังไม่มีข้อมูลตามเงื่อนไข'
    } catch (err: any) {
      entry.status = 'error'
      entry.message = err?.message ?? String(err)
    }
    return entry
  }
}
