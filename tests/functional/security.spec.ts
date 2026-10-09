import { test } from '@japa/runner'
import User from '#models/user'

/** Read-only smoke tests for the rate-limit / 2FA pages (no rows written). */
test.group('Security — pages', () => {
  test('admin sees /admin/security-settings', async ({ client }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const res = await client.get('/admin/security-settings').loginAs(admin)
    res.assertStatus(200)
    res.assertTextIncludes('จำกัดการเข้าสู่ระบบผิดพลาด')
  })

  test('signed-in user sees /account/security', async ({ client }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const res = await client.get('/account/security').loginAs(admin)
    res.assertStatus(200)
    res.assertTextIncludes('ยืนยันตัวตน 2 ขั้นตอน')
  })

  test('/2fa/verify without a pending login goes back to /login', async ({ client }) => {
    const res = await client.get('/2fa/verify').redirects(0)
    res.assertStatus(302)
    res.assertHeader('location', '/login')
  })

  test('/2fa/setup without a session goes back to /login', async ({ client }) => {
    const res = await client.get('/2fa/setup').redirects(0)
    res.assertStatus(302)
    res.assertHeader('location', '/login')
  })
})
