import { test } from '@japa/runner'
import ReportRequest from '#models/report_request'
import User from '#models/user'

/**
 * Read-only smoke tests for the report-request module (the suite runs against
 * the shared app DB, so nothing here writes data).
 */
test.group('Report requests — pages', () => {
  test('GET /requests renders the requester list', async ({ client }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const res = await client.get('/requests').loginAs(admin)
    res.assertStatus(200)
    res.assertTextIncludes('คำขอข้อมูล/รายงาน')
  })

  test('GET /requests/create renders the form', async ({ client }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const res = await client.get('/requests/create').loginAs(admin)
    res.assertStatus(200)
    res.assertTextIncludes('แบบฟอร์มขอข้อมูล/รายงาน')
  })

  test('GET /admin/requests renders the admin queue', async ({ client }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const res = await client.get('/admin/requests?status=all').loginAs(admin)
    res.assertStatus(200)
    res.assertTextIncludes('จัดการคำขอข้อมูล')
  })

  test('GET /requests/99999999 (nonexistent) redirects to /requests', async ({ client }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const res = await client.get('/requests/99999999').loginAs(admin).redirects(0)
    res.assertStatus(302)
    res.assertHeader('location', '/requests')
  })

  test('GET /requests/files/99999999 returns 404', async ({ client }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const res = await client.get('/requests/files/99999999').loginAs(admin)
    res.assertStatus(404)
  })

  test('detail pages render for the latest request (if any)', async ({ client }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const latest = await ReportRequest.query().orderBy('id', 'desc').first()
    if (!latest) return
    const adminPage = await client.get(`/admin/requests/${latest.id}`).loginAs(admin)
    adminPage.assertStatus(200)
    adminPage.assertTextIncludes(latest.reqNo)
    const ownerPage = await client.get(`/requests/${latest.id}`).loginAs(admin)
    ownerPage.assertStatus(200)
    ownerPage.assertTextIncludes(latest.reqNo)
  })

  test('in-progress request offers create-report with a parameters popup', async ({ client }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const working = await ReportRequest.query().where('status', 'in_progress').first()
    if (!working) return
    const res = await client.get(`/admin/requests/${working.id}`).loginAs(admin)
    res.assertStatus(200)
    res.assertTextIncludes('สร้างรายงานใหม่')
    res.assertTextIncludes('id="paramModal"')
    res.assertTextIncludes('new_report_params_json')
  })

  test('request form offers "report in the system" as a result', async ({ client }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const res = await client.get('/requests/create').loginAs(admin)
    res.assertStatus(200)
    res.assertTextIncludes('ดูเป็นรายงานในระบบ')
  })
})

test.group('Report requests — summary report (สรุปการขอรายงาน)', () => {
  test('GET /admin/requests/report renders for the current fiscal year', async ({ client }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const res = await client.get('/admin/requests/report').loginAs(admin)
    res.assertStatus(200)
    res.assertTextIncludes('สรุปการขอรายงาน')
  })

  test('an inverted range falls back with a message', async ({ client }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const res = await client
      .get('/admin/requests/report?from=2026-10-31&to=2026-10-01')
      .loginAs(admin)
    res.assertStatus(200)
    res.assertTextIncludes('วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น')
  })

  test('export returns an xlsx file', async ({ client }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const res = await client.get('/admin/requests/report/export').loginAs(admin)
    res.assertStatus(200)
    res.assertHeader(
      'content-type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
  })
})
