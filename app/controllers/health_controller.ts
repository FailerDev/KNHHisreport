import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import hisDb from '#services/his_db'

/**
 * GET /health — unauthenticated health probe.
 *
 * Returns 200 with `status:"ok"` only when the primary app DB is reachable.
 * The HIS connection is reported but does NOT down-grade the overall status
 * (HIS being unconfigured is normal post-fresh-install, and an offline HIS
 * is the dashboard's concern, not a reason to fail load balancer checks).
 *
 * Designed for: load balancer /readiness, `curl --fail`, container probes.
 */
export default class HealthController {
  async show({ response }: HttpContext) {
    const checks: Record<string, { ok: boolean; message?: string; meta?: any }> = {}
    let overallOk = true

    // App DB
    try {
      const r = (await db.connection('mysql').rawQuery('SELECT 1 AS ok, VERSION() AS v')) as any
      const row = r?.[0]?.[0]
      checks.app_db = { ok: true, meta: { version: row?.v } }
    } catch (err: any) {
      checks.app_db = { ok: false, message: err?.message ?? String(err) }
      overallOk = false
    }

    // HIS DB — reported but not gating.
    try {
      const s = await hisDb.checkStatus()
      checks.his_db = {
        ok: s.connected,
        message: s.message,
        meta: s.connected ? { version: s.mysqlVersion } : undefined,
      }
    } catch (err: any) {
      checks.his_db = { ok: false, message: err?.message ?? String(err) }
    }

    return response.status(overallOk ? 200 : 503).json({
      status: overallOk ? 'ok' : 'degraded',
      checks,
      uptime_seconds: Math.floor(process.uptime()),
      now: new Date().toISOString(),
    })
  }
}
