import { test } from '@japa/runner'
import User from '#models/user'

/**
 * Functional tests for the auth flow.
 *
 * Strategy: split into two flavours.
 *   1. Guest tests — hit endpoints anonymously and assert redirect/render.
 *   2. Authenticated tests — use the auth plugin's `loginAs(user)` to bypass
 *      the login form + CSRF + session-cookie juggling. We get a real
 *      authenticated session attached to the request without round-tripping
 *      through POST /login.
 *
 * Depends on the live `users` table having a row `username = admin`.
 */

test.group('Auth — guest access', () => {
  test('GET /login renders the login form', async ({ client, assert }) => {
    const res = await client.get('/login')
    res.assertStatus(200)
    res.assertTextIncludes('เข้าสู่ระบบ')
    assert.match(res.text(), /name='_csrf' value='[^']+'/)
  })

  test('GET / works for guests', async ({ client }) => {
    const res = await client.get('/')
    res.assertStatus(200)
  })

  test('GET /reports redirects unauthenticated users to /login', async ({ client }) => {
    const res = await client.get('/reports').redirects(0)
    res.assertStatus(302)
    res.assertHeader('location', '/login')
  })

  test('GET /admin/users redirects unauthenticated users to /login', async ({ client }) => {
    const res = await client.get('/admin/users').redirects(0)
    res.assertStatus(302)
    res.assertHeader('location', '/login')
  })

  test('GET /admin/his-settings redirects unauthenticated users to /login', async ({ client }) => {
    const res = await client.get('/admin/his-settings').redirects(0)
    res.assertStatus(302)
    res.assertHeader('location', '/login')
  })
})

test.group('Auth — authenticated session via loginAs()', () => {
  test('admin can access /reports', async ({ client }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const res = await client.get('/reports').loginAs(admin)
    res.assertStatus(200)
    res.assertTextIncludes('รายงานทั้งหมด')
  })

  test('admin can access /admin/users', async ({ client }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const res = await client.get('/admin/users').loginAs(admin)
    res.assertStatus(200)
    res.assertTextIncludes('จัดการผู้ใช้')
  })

  test('admin can access /admin/his-settings', async ({ client }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const res = await client.get('/admin/his-settings').loginAs(admin)
    res.assertStatus(200)
    res.assertTextIncludes('ตั้งค่า HIS Database')
  })

  test('admin can access /admin/dashboard-settings', async ({ client }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const res = await client.get('/admin/dashboard-settings').loginAs(admin)
    res.assertStatus(200)
    res.assertTextIncludes('ตั้งค่าแดชบอร์ด')
  })

  test('admin landing redirect for /admin/dashboard renders an admin page', async ({ client }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const res = await client.get('/admin/dashboard').loginAs(admin)
    res.assertStatus(200)
  })
})
