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
      // inline scripts must still be valid JS after Edge renders them
      const { Script } = await import('node:vm')
      for (const m of page.text().matchAll(/<script>([\s\S]*?)<\/script>/g)) {
        assert.doesNotThrow(() => new Script(m[1]))
      }

      const bad = await post('oracle')
      assert.isFalse(bad.body().success)
    } finally {
      await setSettings({ 'report.default_database_source': before }, null)
    }
  })
})

test.group('Report settings — parameter popup', () => {
  test('parameters are saved with the report and stale tokens are removed', async ({ client, assert }) => {
    const { default: ReportHead } = await import('#models/report_head')
    const { default: ReportHeadDetail } = await import('#models/report_head_detail')
    const { default: ReportParameter } = await import('#models/report_parameter')
    const head = await ReportHead.query().where('status', 1).firstOrFail()
    const admin = await User.findByOrFail('username', 'admin')
    const secret = await new Tokens().secret()
    const post = (url: string, form: Record<string, string>) =>
      client
        .post(url)
        .loginAs(admin)
        .withSession({ 'csrf-secret': secret })
        .form({ _csrf: new Tokens().create(secret), ...form })
        .redirects(0)
    const name = `__test_params_${Date.now()}`
    let reportId: number | undefined
    try {
      await post('/admin/report-settings/reports', {
        head_id: String(head.id),
        detail: name,
        database_source: 'system',
        sql1: 'SELECT 1 FROM dual WHERE @start_d IS NOT NULL AND @ward = 1',
        params_json: JSON.stringify([
          { name: 'start_d', label: 'เริ่ม', type: 'date', required: true, sort: 1 },
          { name: 'ward', label: 'วอร์ด', type: 'select', options: 'A, B', sort: 2 },
          { name: 'ghost', label: 'ไม่มีใน SQL', type: 'text', sort: 3 },
        ]),
      })
      const report = await ReportHeadDetail.findByOrFail('detail', name)
      reportId = report.id
      let rows = await ReportParameter.query().where('reportId', report.id).orderBy('sortOrder')
      assert.deepEqual(rows.map((p) => p.paramName), ['start_d', 'ward'])
      assert.isTrue(rows[0].paramRequired)
      assert.deepEqual(rows[1].parsedOptions, ['A', 'B'])

      // SQL no longer uses @ward → its row is deleted; label change is kept
      await post('/admin/report-settings/reports/update', {
        id: String(report.id),
        head_id: String(head.id),
        detail: name,
        database_source: 'system',
        sql1: 'SELECT 1 FROM dual WHERE @start_d IS NOT NULL',
        params_json: JSON.stringify([{ name: 'start_d', label: 'วันเริ่ม', type: 'date', sort: 1 }]),
      })
      rows = await ReportParameter.query().where('reportId', report.id)
      assert.deepEqual(rows.map((p) => [p.paramName, p.paramLabel]), [['start_d', 'วันเริ่ม']])

      // Popup not opened (no params_json) → parameters untouched
      await post('/admin/report-settings/reports/update', {
        id: String(report.id),
        head_id: String(head.id),
        detail: name,
        database_source: 'system',
        sql1: 'SELECT 1 FROM dual WHERE @start_d IS NOT NULL',
      })
      assert.lengthOf(await ReportParameter.query().where('reportId', report.id), 1)
    } finally {
      if (reportId) {
        await ReportParameter.query().where('reportId', reportId).delete()
        await ReportHeadDetail.query().where('id', reportId).delete()
      }
    }
  })
})
