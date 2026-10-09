/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  APP_KEY: Env.schema.string(),
  APP_NAME: Env.schema.string.optional(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const),

  /*
  |----------------------------------------------------------
  | Variables for configuring session package
  |----------------------------------------------------------
  */
  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory'] as const),

  /*
  |----------------------------------------------------------
  | Variables for configuring database connection
  |----------------------------------------------------------
  */
  DB_HOST: Env.schema.string({ format: 'host' }),
  DB_PORT: Env.schema.number(),
  DB_USER: Env.schema.string(),
  DB_PASSWORD: Env.schema.string.optional(),
  DB_DATABASE: Env.schema.string(),

  /*
  |----------------------------------------------------------
  | HIS database (read-only source for reports)
  | Bootstrap values only — runtime overrides will come from
  | the his_settings table (port of PHP includes/db_his.php).
  |----------------------------------------------------------
  */
  HIS_DB_HOST: Env.schema.string.optional({ format: 'host' }),
  HIS_DB_PORT: Env.schema.number.optional(),
  HIS_DB_USER: Env.schema.string.optional(),
  HIS_DB_PASSWORD: Env.schema.string.optional(),
  HIS_DB_DATABASE: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Report-request module
  |----------------------------------------------------------
  */
  // Public base URL used in links sent outside the app (LINE), e.g. http://hisreport.local
  APP_URL: Env.schema.string.optional(),
  // LINE via MOPH Notify (หมอพร้อม) — fallback when not set on the notification settings page
  MOPH_NOTIFY_API_URL: Env.schema.string.optional(),
  MOPH_NOTIFY_CLIENT_KEY: Env.schema.string.optional(),
  MOPH_NOTIFY_SECRET_KEY: Env.schema.string.optional(),
  // Days to keep result files of identifiable (PDPA) requests after completion (default 30)
  REQUEST_FILE_RETENTION_DAYS: Env.schema.number.optional(),
})

