import { test } from '@japa/runner'
import User from '#models/user'

/**
 * Read-only: the settings hub and every settings page render with the shared
 * settings sub-nav, and non-admins can't reach the hub.
 */
test.group('Admin settings', () => {
  test('GET /admin/settings renders every settings group', async ({ client }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const res = await client.get('/admin/settings').loginAs(admin)
    res.assertStatus(200)
    for (const text of [
      'ตั้งค่าระบบ',
      'รายงานและแดชบอร์ด',
      'ผู้ใช้และสิทธิ์',
      'HIS Database',
      'การแจ้งเตือนและการคุ้มครองข้อมูล',
    ]) {
      res.assertTextIncludes(text)
    }
  })

  for (const path of [
    '/admin/report-settings',
    '/admin/dashboard-settings',
    '/admin/users',
    '/admin/his-settings',
  ]) {
    test(`GET ${path} shows the settings sub-nav`, async ({ client }) => {
      const admin = await User.findByOrFail('username', 'admin')
      const res = await client.get(path).loginAs(admin)
      res.assertStatus(200)
      res.assertTextIncludes('aria-label="เมนูตั้งค่าระบบ"')
      res.assertTextIncludes('href="/admin/settings"')
    })
  }

  test('non-admin is redirected away from /admin/settings', async ({ client }) => {
    const user = await User.findByOrFail('username', 'user')
    const res = await client.get('/admin/settings').loginAs(user).redirects(0)
    res.assertStatus(302)
    res.assertHeader('location', '/reports')
  })
})
