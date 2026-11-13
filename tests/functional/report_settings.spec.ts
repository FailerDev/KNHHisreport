import { test } from '@japa/runner'
import Tokens from 'csrf'
import User from '#models/user'

/**
 * Report-settings SQL test button. Read-only: only runs SELECTs against the
 * app DB ("system" source) and checks that unsafe SQL never executes.
 */
async function postTestSql(client: any, form: Record<string, string>) {
  const admin = await User.findByOrFail('username', 'admin')
  const secret = await new Tokens().secret()
  return client
    .post('/admin/report-settings/test-sql')
    .loginAs(admin)
    .withSession({ 'csrf-secret': secret })
    .form({ _csrf: new Tokens().create(secret), ...form })
}

test.group('Report settings — test SQL', () => {
  test('large result is capped and reported as "more than N rows"', async ({ client, assert }) => {
    const res = await postTestSql(client, {
      database_source: 'system',
      sql1: 'SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS',
    })
    res.assertStatus(200)
    const body = res.body()
    assert.isTrue(body.success, body.message)
    assert.isTrue(body.truncated)
    assert.equal(body.row_count, body.row_limit)
    assert.include(body.message, 'มากกว่า')
  })

  test('REPLACE() string function is allowed', async ({ client, assert }) => {
    const res = await postTestSql(client, { database_source: 'system', sql1: "SELECT REPLACE('a,b', ',', ' ') AS v" })
    assert.isTrue(res.body().success, res.body().message)
  })

  test('write / multi-statement SQL is refused before running', async ({ client, assert }) => {
    for (const sql1 of ['UPDATE users SET fullname = fullname', 'SELECT 1; DELETE FROM users', 'SELECT * FROM users INTO OUTFILE "/tmp/x"']) {
      const res = await postTestSql(client, { database_source: 'system', sql1 })
      assert.isFalse(res.body().success, sql1)
    }
  })
})

test.group('Report settings — default database', () => {
  test('admin can change which database a new report starts on', async ({ client, assert }) => {
    const { reportSettings, setSettings } = await import('#services/app_settings')
    const before = (await reportSettings()).defaultDatabaseSource
    const admin = await User.findByOrFail('username', 'admin')
    const secret = await new Tokens().secret()
    const post = (database_source: string) =>
      client
        .post('/admin/report-settings/default-db')
        .loginAs(admin)
        .withSession({ 'csrf-secret': secret })
        .form({ _csrf: new Tokens().create(secret), database_source })
    try {
      const other = before === 'his' ? 'system' : 'his'
      const res = await post(other)
      assert.isTrue(res.body().success, res.body().message)
      assert.equal((await reportSettings()).defaultDatabaseSource, other)

      const page = await client.get('/admin/report-settings').loginAs(admin)
      page.assertStatus(200)
      assert.include(page.text(), `let defaultDb = "${other}"`)

      const bad = await post('oracle')
      assert.isFalse(bad.body().success)
    } finally {
      await setSettings({ 'report.default_database_source': before }, null)
    }
  })
})
