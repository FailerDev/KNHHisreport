import type { ApplicationService } from '@adonisjs/core/types'

export default class HisDbProvider {
  constructor(protected app: ApplicationService) {}

  register() {}
  async boot() {}
  async start() {}

  /**
   * Once the HTTP server is up and the app is fully booted, read his_settings
   * and register the runtime-configurable 'his' Lucid connection. We do it in
   * `ready` (not `boot`) because Lucid's own provider registers in `boot` and
   * we want it fully initialised before we touch its manager.
   *
   * Failure here must not crash the app — the admin can configure HIS later
   * from the UI; report endpoints will surface the disconnected state then.
   */
  async ready() {
    try {
      const { default: hisDb } = await import('#services/his_db')
      const setting = await hisDb.applyFromDb()
      const logger = (await import('@adonisjs/core/services/logger')).default
      if (setting) {
        logger.info(
          { host: setting.dbHost, db: setting.dbName },
          'HIS connection registered from his_settings'
        )
      } else {
        logger.info('No his_settings row yet — HIS connection will be registered after first save')
      }
    } catch (err: any) {
      const logger = (await import('@adonisjs/core/services/logger')).default
      logger.warn({ err }, 'HisDbProvider.ready: failed to bootstrap HIS connection')
    }
  }

  async shutdown() {}
}
