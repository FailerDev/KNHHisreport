import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import HisSetting from '#models/his_setting'
import hisDb from '#services/his_db'
import User from '#models/user'
import { writeAudit } from '#services/audit'

const settingsValidator = vine.compile(
  vine.object({
    db_host_his: vine.string().trim().minLength(1).maxLength(255),
    db_name_his: vine.string().trim().minLength(1).maxLength(255),
    db_username_his: vine.string().trim().minLength(1).maxLength(255),
    db_password_his: vine.string().maxLength(1024).optional(),
    db_port_his: vine.string().trim().regex(/^\d+$/).optional(),
  })
)

const testValidator = vine.compile(
  vine.object({
    db_host_his: vine.string().trim().minLength(1).maxLength(255),
    db_name_his: vine.string().trim().minLength(1).maxLength(255),
    db_username_his: vine.string().trim().minLength(1).maxLength(255),
    db_password_his: vine.string().maxLength(1024).optional(),
    db_port_his: vine.string().trim().regex(/^\d+$/).optional(),
  })
)

export default class HisSettingsController {
  async show({ view, session }: HttpContext) {
    const current = await HisSetting.query().orderBy('id', 'desc').first()
    const status = await hisDb.checkStatus()
    return view.render('pages/admin/his_settings', {
      current,
      status,
      message: session.flashMessages.get('message'),
      messageType: session.flashMessages.get('messageType'),
    })
  }

  async test({ request, response }: HttpContext) {
    try {
      const payload = await request.validateUsing(testValidator)
      let password = payload.db_password_his ?? ''
      if (password === '') {
        const existing = await HisSetting.query().orderBy('id', 'desc').first()
        password = existing?.dbPassword ?? ''
      }
      if (password === '') {
        return response.json({ success: false, message: 'กรุณากรอกรหัสผ่านฐานข้อมูล' })
      }
      const result = await hisDb.testConnection({
        host: payload.db_host_his,
        port: Number(payload.db_port_his || '3306'),
        user: payload.db_username_his,
        password,
        database: payload.db_name_his,
      })
      return response.json({
        success: result.connected,
        message: result.message,
        database: payload.db_name_his,
        host: payload.db_host_his,
        port: payload.db_port_his || '3306',
        username: payload.db_username_his,
        mysql_version: result.mysqlVersion,
        server_time: result.serverTime,
        debug: result.debug,
      })
    } catch (err: any) {
      return response.json({
        success: false,
        message: err?.messages?.[0]?.message ?? err?.message ?? 'เกิดข้อผิดพลาด',
      })
    }
  }

  async save(ctx: HttpContext) {
    const { request, auth, session, response } = ctx
    try {
      const payload = await request.validateUsing(settingsValidator)
      const existing = await HisSetting.query().orderBy('id', 'desc').first()

      let password = payload.db_password_his ?? ''
      if (password === '' && existing?.dbPassword) {
        password = existing.dbPassword
      }
      if (password === '') {
        session.flash('message', 'กรุณากรอกรหัสผ่านฐานข้อมูล')
        session.flash('messageType', 'error')
        return response.redirect().back()
      }

      const testResult = await hisDb.testConnection({
        host: payload.db_host_his,
        port: Number(payload.db_port_his || '3306'),
        user: payload.db_username_his,
        password,
        database: payload.db_name_his,
      })
      if (!testResult.connected) {
        session.flash('message', `การทดสอบเชื่อมต่อล้มเหลว: ${testResult.message}`)
        session.flash('messageType', 'error')
        return response.redirect().back()
      }

      const currentUser = auth.user as User
      if (existing) {
        existing.dbHost = payload.db_host_his
        existing.dbName = payload.db_name_his
        existing.dbUsername = payload.db_username_his
        existing.dbPassword = password
        existing.dbPort = payload.db_port_his || '3306'
        existing.updatedBy = currentUser?.id ?? null
        await existing.save()
      } else {
        await HisSetting.create({
          dbHost: payload.db_host_his,
          dbName: payload.db_name_his,
          dbUsername: payload.db_username_his,
          dbPassword: password,
          dbPort: payload.db_port_his || '3306',
          createdBy: currentUser?.id ?? null,
        })
      }

      // Refresh the live 'his' connection so subsequent requests use the new
      // credentials without restarting the server.
      await hisDb.applyFromDb()
      await writeAudit(ctx, {
        action: existing ? 'his_settings.update' : 'his_settings.create',
        entity: 'his_settings',
        entityId: existing?.id ?? null,
        summary: `HIS connection updated to ${payload.db_username_his}@${payload.db_host_his}:${payload.db_port_his || '3306'}/${payload.db_name_his}`,
        meta: { host: payload.db_host_his, port: payload.db_port_his, db: payload.db_name_his, user: payload.db_username_his },
      })

      session.flash('message', 'บันทึกการตั้งค่า HIS Database สำเร็จ')
      session.flash('messageType', 'success')
    } catch (err: any) {
      session.flash('message', err?.messages?.[0]?.message ?? err?.message ?? 'เกิดข้อผิดพลาด')
      session.flash('messageType', 'error')
    }
    return response.redirect().back()
  }
}
