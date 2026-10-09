import { test } from '@japa/runner'
import User from '#models/user'

/**
 * Read-only: the in-app manual renders for every signed-in user, and the
 * admin chapters are only shown to admins.
 */
test.group('Manual', () => {
  test('admin sees user and admin chapters', async ({ client }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const res = await client.get('/manual').loginAs(admin)
    res.assertStatus(200)
    for (const text of ['คู่มือการใช้งาน', 'id="reports"', 'id="requests"', 'id="admin-requests"', 'id="admin-security"']) {
      res.assertTextIncludes(text)
    }
  })

  test('regular user sees user chapters only', async ({ client, assert }) => {
    const user = await User.findByOrFail('username', 'user')
    const res = await client.get('/manual').loginAs(user)
    res.assertStatus(200)
    res.assertTextIncludes('id="account-security"')
    assert.notInclude(res.text(), 'id="admin-settings"')
    assert.notInclude(res.text(), 'สำหรับผู้ดูแลระบบ')
  })

  test('topbar help button links to the chapter of the current page', async ({ client }) => {
    const user = await User.findByOrFail('username', 'user')
    const res = await client.get('/reports').loginAs(user)
    res.assertStatus(200)
    res.assertTextIncludes('href="/manual#reports"')
  })

  test('guest is redirected to login', async ({ client }) => {
    const res = await client.get('/manual').redirects(0)
    res.assertStatus(302)
  })
})
