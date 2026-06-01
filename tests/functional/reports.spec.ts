import { test } from '@japa/runner'
import User from '#models/user'
import ReportHeadDetail from '#models/report_head_detail'

/**
 * Functional tests for /reports — exercises the system-DB report path so we
 * don't depend on the HIS server being reachable from CI. We pick a fixture
 * report whose `database_source='system'` and whose SQL has no `@token`
 * placeholders so the show handler runs it eagerly.
 */

async function pickSystemReportWithNoParams(): Promise<ReportHeadDetail | null> {
  const candidates = await ReportHeadDetail.query()
    .where('status', 1)
    .where((q) => q.where('databaseSource', 'system').orWhereNull('databaseSource'))
    .orderBy('id', 'asc')
    .limit(20)
  for (const r of candidates) {
    if (r.sql1 && !/@[a-zA-Z_][a-zA-Z0-9_]*/.test(r.sql1.replace(/@@/g, ''))) {
      return r
    }
  }
  return null
}

test.group('Reports — index', () => {
  test('GET /reports renders the list page with at least one category', async ({ client }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const res = await client.get('/reports').loginAs(admin)
    res.assertStatus(200)
    res.assertTextIncludes('รายงานทั้งหมด')
    res.assertTextIncludes('หมวดหมู่')
  })
})

test.group('Reports — show + auto-run for parameter-less system reports', () => {
  test('GET /reports/:id eagerly runs a no-param system report and shows results', async ({ client, assert }) => {
    const fixture = await pickSystemReportWithNoParams()
    if (!fixture) {
      assert.fail('test fixture missing: no active system-DB report without @-placeholders was found')
      return
    }

    const admin = await User.findByOrFail('username', 'admin')
    const res = await client.get(`/reports/${fixture.id}`).loginAs(admin)
    res.assertStatus(200)
    res.assertTextIncludes(fixture.detail)
    // Either we get a result table OR an empty-data state — both are valid
    // outcomes; what matters is that we did NOT bounce back to /login (auth
    // works) AND we did NOT crash (model + runner work end-to-end).
    const body = res.text()
    const ok =
      body.includes('ผลการค้นหา') ||
      body.includes('ไม่พบข้อมูล') ||
      body.includes('รายการ ·')
    if (!ok) {
      assert.fail(`expected results table or empty-state in body for report #${fixture.id}`)
    }
  })

  test('GET /reports/99999999 (nonexistent) redirects to /reports', async ({ client }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const res = await client.get('/reports/99999999').loginAs(admin).redirects(0)
    res.assertStatus(302)
    res.assertHeader('location', '/reports')
  })
})
