import db from '@adonisjs/lucid/services/db'
import HisSetting from '#models/his_setting'
import logger from '@adonisjs/core/services/logger'

const CONNECTION_NAME = 'his'

export interface HisConnectionParams {
  host: string
  port: number
  user: string
  password: string
  database: string
}

export interface HisStatus {
  connected: boolean
  message: string
  hasConfig: boolean
  serverTime?: string
  mysqlVersion?: string
  debug?: string
}

/**
 * HisDbService — owns the lifecycle of the runtime-configurable 'his'
 * Lucid connection.
 *
 * Why this exists:
 *   - HIS DB credentials live in the `his_settings` table, not .env.
 *   - Admin users can change them at runtime (admin/his-settings page).
 *   - We must swap the live Lucid connection without restarting the server.
 *
 * The class is a thin wrapper around `db.manager` plus a typed helper for
 * status checks the admin UI uses.
 */
class HisDbService {
  /**
   * Read the latest his_settings row and (re)register the 'his' connection
   * with those credentials. Safe to call repeatedly — closes the previous
   * connection first when settings change.
   */
  async applyFromDb(): Promise<HisSetting | null> {
    let setting: HisSetting | null = null
    try {
      setting = await HisSetting.query().orderBy('id', 'desc').first()
    } catch (err: any) {
      logger.warn({ err }, 'HisDbService.applyFromDb: failed to read his_settings')
      return null
    }
    if (!setting) {
      logger.info('HisDbService.applyFromDb: no his_settings row yet')
      return null
    }

    this.registerConnection({
      host: setting.dbHost,
      port: Number(setting.dbPort || 3306),
      user: setting.dbUsername,
      password: setting.dbPassword ?? '',
      database: setting.dbName,
    })
    return setting
  }

  /**
   * (Re)register the 'his' Lucid connection with explicit params.
   * Closes the existing connection first if it was open.
   */
  registerConnection(params: HisConnectionParams): void {
    // Close existing 'his' if it was opened, so manager.add can replace it.
    if (db.manager.has(CONNECTION_NAME)) {
      try {
        db.manager.close(CONNECTION_NAME, true).catch(() => {})
        db.manager.release(CONNECTION_NAME)
      } catch {
        /* ignore — manager may not have an open pool yet */
      }
    }

    db.manager.add(CONNECTION_NAME, {
      client: 'mysql2',
      connection: {
        host: params.host,
        port: params.port,
        user: params.user,
        password: params.password,
        database: params.database,
        timezone: '+07:00',
        dateStrings: true,
      },
      pool: {
        min: 0,
        max: 5,
        acquireTimeoutMillis: 10_000,
      },
    })
  }

  /**
   * Try to connect with the supplied params (without saving / replacing the
   * live connection). Used by the "Test connection" button on the UI.
   */
  async testConnection(params: HisConnectionParams): Promise<HisStatus> {
    const tmpName = `__his_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    db.manager.add(tmpName, {
      client: 'mysql2',
      connection: {
        host: params.host,
        port: params.port,
        user: params.user,
        password: params.password,
        database: params.database,
      },
      pool: { min: 0, max: 1, acquireTimeoutMillis: 10_000 },
    })
    try {
      const rows = (await db
        .connection(tmpName)
        .rawQuery(
          'SELECT 1 AS connection_test, NOW() AS server_time, DATABASE() AS current_database, USER() AS mysql_user, VERSION() AS mysql_version'
        )) as any
      const row = rows?.[0]?.[0]
      return {
        connected: true,
        hasConfig: true,
        message: 'การเชื่อมต่อสำเร็จ',
        serverTime: row?.server_time,
        mysqlVersion: row?.mysql_version,
      }
    } catch (err: any) {
      return {
        connected: false,
        hasConfig: true,
        message: this.friendlyError(err?.message ?? String(err)),
        debug: err?.message ?? String(err),
      }
    } finally {
      try {
        await db.manager.close(tmpName, true)
      } catch {
        /* ignore */
      }
      try {
        db.manager.release(tmpName)
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Quick ping of the currently-registered 'his' connection.
   * Returns hasConfig=false if no his_settings row exists yet.
   */
  async checkStatus(): Promise<HisStatus> {
    if (!db.manager.has(CONNECTION_NAME)) {
      return {
        connected: false,
        hasConfig: false,
        message: 'ยังไม่ได้ตั้งค่าการเชื่อมต่อ HIS Database',
      }
    }
    try {
      const rows = (await db
        .connection(CONNECTION_NAME)
        .rawQuery('SELECT 1 AS ok, NOW() AS server_time, VERSION() AS mysql_version')) as any
      const row = rows?.[0]?.[0]
      return {
        connected: true,
        hasConfig: true,
        message: 'เชื่อมต่อ HIS Database สำเร็จ',
        serverTime: row?.server_time,
        mysqlVersion: row?.mysql_version,
      }
    } catch (err: any) {
      return {
        connected: false,
        hasConfig: true,
        message: this.friendlyError(err?.message ?? String(err)),
        debug: err?.message ?? String(err),
      }
    }
  }

  get connectionName(): string {
    return CONNECTION_NAME
  }

  private friendlyError(msg: string): string {
    const lower = msg.toLowerCase()
    if (lower.includes('access denied')) return 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'
    if (lower.includes('unknown database')) return 'ไม่พบฐานข้อมูลที่ระบุ'
    if (lower.includes('connection refused') || lower.includes('econnrefused'))
      return 'ไม่สามารถเชื่อมต่อกับโฮสต์ที่ระบุได้'
    if (lower.includes('timed out') || lower.includes('etimedout'))
      return 'การเชื่อมต่อเกินเวลาที่กำหนด'
    if (lower.includes('enotfound') || lower.includes('host')) return 'ไม่พบโฮสต์ที่ระบุ'
    return msg.length > 140 ? msg.slice(0, 140) + '…' : msg
  }
}

const hisDb = new HisDbService()
export default hisDb
