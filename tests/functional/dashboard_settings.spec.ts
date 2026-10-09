import { test } from '@japa/runner'
import Tokens from 'csrf'
import env from '#start/env'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import DashboardItem from '#models/dashboard_item'
import hisDb from '#services/his_db'

/**
 * Dashboard settings CRUD. The suite runs against the shared app DB, so:
 *   - the 'his' connection is pointed at the app DB for the duration (only
 *     `SELECT 1`-style SQL is run against it) and restored afterwards;
 *   - every tile created here is tagged with MARKER, saved hidden (sort
 *     empty) and removed in teardown together with its audit rows.
 */
const MARKER = '__test_dashboard_settings__'

async function csrf() {
  const secret = await new Tokens().secret()
  return { session: { 'csrf-secret': secret }, token: new Tokens().create(secret) }
}

const tile = (overrides: Record<string, string> = {}) => ({
  detail: MARKER,
  sql1: 'SELECT 1 AS n',
  sort: '',
  link_id: '',
  icons: 'users',
  color1: 'icon-success',
  chart_type: 'none',
  chart_name: '',
  chart_sql: '',
  chart_color: 'default',
  ...overrides,
})

test.group('Dashboard settings — CRUD', (group) => {
  group.setup(() => {
    hisDb.registerConnection({
      host: env.get('DB_HOST'),
      port: Number(env.get('DB_PORT')),
      user: env.get('DB_USER'),
      password: env.get('DB_PASSWORD') ?? '',
      database: env.get('DB_DATABASE'),
    })
    return async () => {
      await hisDb.applyFromDb()
    }
  })

  group.each.teardown(async () => {
    const ids = (await DashboardItem.query().where('detail', MARKER)).map((i) => i.id)
    if (ids.length) {
      await db.from('audit_logs').where('entity', 'dashboard_item').whereIn('entity_id', ids).delete()
      await DashboardItem.query().whereIn('id', ids).delete()
    }
  })

  test('create → update → delete round-trip over AJAX', async ({ client, assert }) => {
    const admin = await User.findByOrFail('username', 'admin')

    let c = await csrf()
    const created = await client
      .post('/admin/dashboard-settings')
      .loginAs(admin)
      .withSession(c.session)
      .accept('json')
      .form({ _csrf: c.token, ...tile() })
    created.assertStatus(200)
    created.assertBodyContains({ success: true })

    const row = await DashboardItem.findByOrFail('detail', MARKER)
    assert.isNull(row.sort, 'empty sort = hidden')
    assert.equal(row.icons, 'fa-users')
    assert.equal(row.pieShow, 'n')

    c = await csrf()
    const updated = await client
      .post('/admin/dashboard-settings/update')
      .loginAs(admin)
      .withSession(c.session)
      .accept('json')
      .form({
        _csrf: c.token,
        ...tile({ id: String(row.id), chart_type: 'bar', chart_sql: "SELECT 'a' AS label, 1 AS value" }),
      })
    updated.assertStatus(200)
    await row.refresh()
    assert.equal(row.chartType, 'bar')
    assert.equal(row.pieShow, 'y')

    c = await csrf()
    const deleted = await client
      .post('/admin/dashboard-settings/delete')
      .loginAs(admin)
      .withSession(c.session)
      .accept('json')
      .form({ _csrf: c.token, id: String(row.id) })
    deleted.assertStatus(200)
    assert.isNull(await DashboardItem.find(row.id))
  })

  test('unsafe SQL is rejected with 422 JSON and nothing is saved', async ({ client, assert }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const c = await csrf()
    const res = await client
      .post('/admin/dashboard-settings')
      .loginAs(admin)
      .withSession(c.session)
      .accept('json')
      .form({ _csrf: c.token, ...tile({ sql1: 'SELECT 1; DELETE FROM users' }) })
    res.assertStatus(422)
    res.assertBodyContains({ success: false })
    assert.include(res.body().message, 'SQL หลัก')
    assert.isNull(await DashboardItem.findBy('detail', MARKER))
  })

  test('chart enabled without chart SQL is rejected', async ({ client }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const c = await csrf()
    const res = await client
      .post('/admin/dashboard-settings')
      .loginAs(admin)
      .withSession(c.session)
      .accept('json')
      .form({ _csrf: c.token, ...tile({ chart_type: 'pie' }) })
    res.assertStatus(422)
    res.assertBodyContains({ success: false, message: 'กรุณากรอก SQL สำหรับกราฟ' })
  })

  test('broken SQL reports the HIS error', async ({ client, assert }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const c = await csrf()
    const res = await client
      .post('/admin/dashboard-settings')
      .loginAs(admin)
      .withSession(c.session)
      .accept('json')
      .form({ _csrf: c.token, ...tile({ sql1: 'SELECT no_such_column FROM no_such_table_xyz' }) })
    res.assertStatus(422)
    assert.include(res.body().message, 'SQL หลักไม่ถูกต้อง')
  })

  test('update / delete of a missing id fail cleanly', async ({ client }) => {
    const admin = await User.findByOrFail('username', 'admin')
    let c = await csrf()
    const up = await client
      .post('/admin/dashboard-settings/update')
      .loginAs(admin)
      .withSession(c.session)
      .accept('json')
      .form({ _csrf: c.token, ...tile({ id: '99999999' }) })
    up.assertStatus(422)
    up.assertBodyContains({ message: 'ไม่พบรายการที่จะแก้ไข' })

    c = await csrf()
    const del = await client
      .post('/admin/dashboard-settings/delete')
      .loginAs(admin)
      .withSession(c.session)
      .accept('json')
      .form({ _csrf: c.token, id: '99999999' })
    del.assertStatus(422)
  })

  test('plain form post (no JS) still redirects back with a flash', async ({ client }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const c = await csrf()
    const res = await client
      .post('/admin/dashboard-settings')
      .loginAs(admin)
      .withSession(c.session)
      .header('referer', '/admin/dashboard-settings')
      .redirects(0)
      .form({ _csrf: c.token, ...tile({ sql1: 'DROP TABLE users' }) })
    res.assertStatus(302)
  })

  test('test-sql returns capped rows and detects chart columns', async ({ client, assert }) => {
    const admin = await User.findByOrFail('username', 'admin')
    let c = await csrf()
    const res = await client
      .post('/admin/dashboard-settings/test-sql')
      .loginAs(admin)
      .withSession(c.session)
      .form({
        _csrf: c.token,
        kind: 'chart',
        sql_to_test: 'SELECT COLUMN_NAME AS label, 1 AS value FROM information_schema.COLUMNS',
      })
    res.assertStatus(200)
    const body = res.body()
    assert.isTrue(body.success, body.message)
    assert.isTrue(body.truncated)
    assert.equal(body.rows, body.row_limit)
    assert.equal(body.detected_value, 'value')

    c = await csrf()
    const bad = await client
      .post('/admin/dashboard-settings/test-sql')
      .loginAs(admin)
      .withSession(c.session)
      .form({ _csrf: c.token, sql_to_test: 'UPDATE users SET fullname = 1' })
    bad.assertBodyContains({ success: false })
  })
})
