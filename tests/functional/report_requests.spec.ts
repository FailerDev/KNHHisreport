import { test } from '@japa/runner'
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
})
