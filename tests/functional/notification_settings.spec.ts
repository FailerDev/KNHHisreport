import { test } from '@japa/runner'
import Tokens from 'csrf'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { clearSettingsCache, notificationSettings } from '#services/app_settings'

/**
 * Notification settings page. The suite runs against the shared app DB, so the
 * save test snapshots `app_settings` and puts it back afterwards.
 */
test.group('Notification settings', (group) => {
  let snapshot: Array<Record<string, any>> = []
  group.each.setup(async () => {
    snapshot = await db.from('app_settings').select('*')
    return async () => {
      await db.from('app_settings').delete()
      if (snapshot.length) await db.table('app_settings').multiInsert(snapshot)
      clearSettingsCache()
    }
  })

  test('GET /admin/notification-settings renders events, MOPH LINE and PDPA sections', async ({
    client,
  }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const res = await client.get('/admin/notification-settings').loginAs(admin)
    res.assertStatus(200)
    for (const text of [
      'เหตุการณ์ที่จะแจ้งเตือน',
      'MOPH Notify',
      'รูปแบบข้อความ',
      'ระยะเวลาเก็บไฟล์ข้อมูลรายบุคคล',
    ]) {
      res.assertTextIncludes(text)
    }
  })

  test('saving stores toggles, encrypts the MOPH keys and never echoes them', async ({
    client,
    assert,
  }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const secret = await new Tokens().secret()
    const clientKey = 'client-key-AAAA1111'
    const secretKey = 'secret-key-BBBB2222'

    const res = await client
      .post('/admin/notification-settings')
      .loginAs(admin)
      .withSession({ 'csrf-secret': secret })
      .form({
        _csrf: new Tokens().create(secret),
        line_enabled: '1',
        moph_client_key: clientKey,
        moph_secret_key: secretKey,
        line_format: 'flex',
        app_url: 'http://hisreport.local',
        retention_days: '45',
        event_admin_new_request: '1',
        event_line_completed: '1',
      })
      .redirects(0)
    res.assertStatus(302)
    assert.equal(res.flashMessages().messageType, 'success', String(res.flashMessages().message))

    clearSettingsCache()
    const s = await notificationSettings()
    assert.isTrue(s.lineEnabled)
    assert.equal(s.mophClientKey, clientKey)
    assert.equal(s.mophSecretKey, secretKey)
    assert.equal(s.lineFormat, 'flex')
    assert.equal(s.retentionDays, 45)
    assert.deepEqual(s.events, {
      adminNewRequest: true,
      requesterUpdates: false,
      lineNewRequest: false,
      lineCompleted: true,
    })

    const rows = await db
      .from('app_settings')
      .whereIn('key', ['notify.moph_client_key', 'notify.moph_secret_key'])
    assert.lengthOf(rows, 2)
    for (const row of rows) {
      assert.notInclude(row.value, clientKey)
      assert.notInclude(row.value, secretKey)
    }

    const page = await client.get('/admin/notification-settings').loginAs(admin)
    assert.notInclude(page.text(), clientKey)
    assert.notInclude(page.text(), secretKey)
    page.assertTextIncludes('…1111')
  })

  test('enabling LINE without keys is rejected', async ({ client, assert }) => {
    const admin = await User.findByOrFail('username', 'admin')
    const secret = await new Tokens().secret()
    const res = await client
      .post('/admin/notification-settings')
      .loginAs(admin)
      .withSession({ 'csrf-secret': secret })
      .form({
        _csrf: new Tokens().create(secret),
        line_enabled: '1',
        clear_moph_keys: '1',
        line_format: 'text',
        retention_days: '30',
      })
      .redirects(0)
    assert.equal(res.flashMessages().messageType, 'error')
    clearSettingsCache()
    assert.isFalse((await notificationSettings()).lineEnabled)
  })

  test('non-admin cannot open notification settings', async ({ client }) => {
    const user = await User.findByOrFail('username', 'user')
    const res = await client.get('/admin/notification-settings').loginAs(user).redirects(0)
    res.assertStatus(302)
    res.assertHeader('location', '/reports')
  })
})
