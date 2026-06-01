import { test } from '@japa/runner'
import User from '#models/user'

/**
 * Functional tests for the admin gate.
 *
 * Strategy: log in as a non-admin user and verify that every admin-only
 * route bounces back to /reports. We pick a known non-admin user
 * (`username='user'` — verified earlier with the password:check command,
 * userLevel='user', status=1).
 */

const ADMIN_ROUTES = [
  '/admin/users',
  '/admin/his-settings',
  '/admin/report-settings',
  '/admin/dashboard-settings',
]

test.group('Admin middleware — non-admin access', () => {
  test('non-admin gets redirected to /reports for each admin-only route', async ({ client, assert }) => {
    const nonAdmin = await User.findBy('username', 'user')
    if (!nonAdmin) {
      assert.fail('test fixture missing: expected a `users` row with username=user, level=user, status=1')
      return
    }
    if (nonAdmin.userLevel === 'admin') {
      assert.fail('test fixture problem: the `user` row has userLevel=admin; expected level=user')
      return
    }

    for (const route of ADMIN_ROUTES) {
      const res = await client.get(route).loginAs(nonAdmin).redirects(0)
      assert.equal(res.status(), 302, `route ${route} should 302-redirect for non-admin`)
      assert.equal(res.headers().location, '/reports', `route ${route} should redirect to /reports`)
    }
  })
})

test.group('Admin middleware — admin access', () => {
  test('admin can reach all admin-only routes (200)', async ({ client }) => {
    const admin = await User.findByOrFail('username', 'admin')
    for (const route of ADMIN_ROUTES) {
      const res = await client.get(route).loginAs(admin)
      res.assertStatus(200)
    }
  })
})
