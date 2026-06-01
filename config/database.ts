import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'

const dbConfig = defineConfig({
  connection: 'mysql',
  connections: {
    mysql: {
      client: 'mysql2',
      connection: {
        host: env.get('DB_HOST'),
        port: env.get('DB_PORT'),
        user: env.get('DB_USER'),
        password: env.get('DB_PASSWORD'),
        database: env.get('DB_DATABASE'),
      },
      pool: {
        min: 0,
        max: 10,
      },
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
      },
    },

    his: {
      client: 'mysql2',
      connection: {
        host: env.get('HIS_DB_HOST', '127.0.0.1'),
        port: Number(env.get('HIS_DB_PORT', 3306)),
        user: env.get('HIS_DB_USER', ''),
        password: env.get('HIS_DB_PASSWORD', ''),
        database: env.get('HIS_DB_DATABASE', ''),
        timezone: '+07:00',
        dateStrings: true,
      },
      pool: {
        min: 0,
        max: 5,
        acquireTimeoutMillis: 10_000,
      },
    },
  },
})

export default dbConfig
