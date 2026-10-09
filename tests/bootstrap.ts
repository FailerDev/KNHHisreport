import { assert } from '@japa/assert'
import { apiClient } from '@japa/api-client'
import { sessionApiClient } from '@adonisjs/session/plugins/api_client'
import { authApiClient } from '@adonisjs/auth/plugins/api_client'
import app from '@adonisjs/core/services/app'
import type { Config } from '@japa/runner/types'
import { pluginAdonisJS } from '@japa/plugin-adonisjs'
import testUtils from '@adonisjs/core/services/test_utils'

/**
 * Plugin order matters:
 *   1. pluginAdonisJS — wires up the app context.
 *   2. apiClient      — makes `client` available on the test context.
 *   3. sessionApiClient — adds `request.withSession({...})` (needed by auth).
 *   4. authApiClient  — adds `request.loginAs(user)` (depends on session).
 */
export const plugins: Config['plugins'] = [
  assert(),
  pluginAdonisJS(app),
  // PORT can be overridden (e.g. PORT=3344) when a dev server already holds 3333
  apiClient({ baseURL: `http://localhost:${process.env.PORT ?? 3333}` }),
  sessionApiClient(app),
  authApiClient(app),
]

export const runnerHooks: Required<Pick<Config, 'setup' | 'teardown'>> = {
  setup: [],
  teardown: [],
}

export const configureSuite: Config['configureSuite'] = (suite) => {
  if (['browser', 'functional', 'e2e'].includes(suite.name)) {
    return suite.setup(() => testUtils.httpServer().start())
  }
}
