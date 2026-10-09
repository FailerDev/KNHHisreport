import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import User from '#models/user'
import { writeAudit } from '#services/audit'
import UserTwoFactor from '#models/user_two_factor'
import { clearLockout, lockedUsernames, userKey } from '#services/login_lockout'
import { disableTwoFactor, setForce } from '#services/two_factor'

const idField = () => vine.string().trim().transform((v) => Number(v))

const createUserValidator = vine.compile(
  vine.object({
    username: vine.string().trim().minLength(3).maxLength(64),
    password: vine.string().minLength(6).maxLength(255),
    fullname: vine.string().trim().minLength(1).maxLength(255),
    email: vine.string().trim().email().optional(),
    department: vine.string().trim().maxLength(255).optional(),
    user_level: vine.enum(['admin', 'user']),
    status: vine.string().trim().transform((v) => Number(v)).optional(),
  })
)

const updateUserValidator = vine.compile(
  vine.object({
    user_id: idField(),
    fullname: vine.string().trim().minLength(1).maxLength(255),
    email: vine.string().trim().email().optional(),
    department: vine.string().trim().maxLength(255).optional(),
    user_level: vine.enum(['admin', 'user']),
    status: vine.string().trim().transform((v) => Number(v)),
  })
)

const resetPasswordValidator = vine.compile(
  vine.object({
    user_id: idField(),
    new_password: vine.string().minLength(6).maxLength(255),
    confirm_password: vine.string().minLength(6).maxLength(255),
  })
)

const twoFactorValidator = vine.compile(
  vine.object({
    user_id: idField(),
    force: vine.enum(['default', 'require', 'exempt'] as const),
    reset: vine.string().optional(),
    unlock: vine.string().optional(),
  })
)

const deleteUserValidator = vine.compile(
  vine.object({
    user_id: idField(),
  })
)

export default class UsersController {
  async index({ view, session }: HttpContext) {
    const users = await User.query().orderBy('id', 'desc')
    const [twofaRows, locked] = await Promise.all([UserTwoFactor.all(), lockedUsernames()])
    const twofa = Object.fromEntries(
      twofaRows.map((r) => [r.userId, { method: r.method, force: r.force }])
    )

    const total = users.length
    const active = users.filter((u) => u.status === 1).length
    const admins = users.filter((u) => u.userLevel === 'admin').length
    const inactive = total - active

    return view.render('pages/admin/users', {
      users,
      twofa,
      lockedUsernames: [...locked],
      stats: { total, active, admins, inactive },
      message: session.flashMessages.get('message'),
      messageType: session.flashMessages.get('messageType'),
    })
  }

  async store(ctx: HttpContext) {
    const { request, session, response } = ctx
    try {
      const payload = await request.validateUsing(createUserValidator)

      const existing = await User.findBy('username', payload.username)
      if (existing) {
        session.flash('message', `ชื่อผู้ใช้ "${payload.username}" มีอยู่ในระบบแล้ว`)
        session.flash('messageType', 'error')
        return response.redirect().back()
      }

      const created = await User.create({
        username: payload.username,
        password: payload.password,
        fullname: payload.fullname,
        email: payload.email ?? null,
        department: payload.department ?? null,
        userLevel: payload.user_level,
        groupId: payload.user_level === 'admin' ? 1 : 2,
        status: payload.status !== undefined ? Number(payload.status) : 1,
      })
      await writeAudit(ctx, {
        action: 'user.create',
        entity: 'user',
        entityId: created.id,
        summary: `created user ${created.username} (level=${created.userLevel}, status=${created.status})`,
      })

      session.flash('message', `เพิ่มผู้ใช้ ${payload.username} สำเร็จ`)
      session.flash('messageType', 'success')
    } catch (err: any) {
      session.flash('message', err?.messages?.[0]?.message ?? err?.message ?? 'เกิดข้อผิดพลาด')
      session.flash('messageType', 'error')
    }
    return response.redirect().back()
  }

  async update(ctx: HttpContext) {
    const { request, session, response } = ctx
    try {
      const payload = await request.validateUsing(updateUserValidator)
      const user = await User.find(payload.user_id)
      if (!user) {
        session.flash('message', 'ไม่พบผู้ใช้ที่ระบุ')
        session.flash('messageType', 'error')
        return response.redirect().back()
      }

      const before = { userLevel: user.userLevel, status: user.status, fullname: user.fullname }
      user.fullname = payload.fullname
      user.email = payload.email ?? null
      user.department = payload.department ?? null
      user.userLevel = payload.user_level
      user.groupId = payload.user_level === 'admin' ? 1 : 2
      user.status = Number(payload.status)
      await user.save()
      await writeAudit(ctx, {
        action: 'user.update',
        entity: 'user',
        entityId: user.id,
        summary: `updated user ${user.username}`,
        meta: { before, after: { userLevel: user.userLevel, status: user.status, fullname: user.fullname } },
      })

      session.flash('message', 'อัพเดทข้อมูลผู้ใช้สำเร็จ')
      session.flash('messageType', 'success')
    } catch (err: any) {
      session.flash('message', err?.messages?.[0]?.message ?? err?.message ?? 'เกิดข้อผิดพลาด')
      session.flash('messageType', 'error')
    }
    return response.redirect().back()
  }

  async resetPassword(ctx: HttpContext) {
    const { request, session, response } = ctx
    try {
      const payload = await request.validateUsing(resetPasswordValidator)
      if (payload.new_password !== payload.confirm_password) {
        session.flash('message', 'รหัสผ่านยืนยันไม่ตรงกัน')
        session.flash('messageType', 'error')
        return response.redirect().back()
      }

      const user = await User.find(payload.user_id)
      if (!user) {
        session.flash('message', 'ไม่พบผู้ใช้ที่ระบุ')
        session.flash('messageType', 'error')
        return response.redirect().back()
      }

      user.password = payload.new_password
      await user.save()
      await writeAudit(ctx, {
        action: 'user.reset_password',
        entity: 'user',
        entityId: user.id,
        summary: `reset password for ${user.username}`,
      })

      session.flash('message', 'รีเซ็ตรหัสผ่านสำเร็จ')
      session.flash('messageType', 'success')
    } catch (err: any) {
      session.flash('message', err?.messages?.[0]?.message ?? err?.message ?? 'เกิดข้อผิดพลาด')
      session.flash('messageType', 'error')
    }
    return response.redirect().back()
  }

  /** Per-user 2FA override (default / require / exempt), reset enrolment, lift login lock. */
  async twoFactor(ctx: HttpContext) {
    const { request, session, response } = ctx
    try {
      const payload = await request.validateUsing(twoFactorValidator)
      const user = await User.find(payload.user_id)
      if (!user) {
        session.flash('message', 'ไม่พบผู้ใช้ที่ระบุ')
        session.flash('messageType', 'error')
        return response.redirect().back()
      }

      await setForce(user.id, payload.force)
      if (payload.reset) await disableTwoFactor(user.id)
      if (payload.unlock) await clearLockout(userKey(user.username))
      await writeAudit(ctx, {
        action: 'user.2fa',
        entity: 'user',
        entityId: user.id,
        summary: `2FA settings for ${user.username}: force=${payload.force}${payload.reset ? ', reset' : ''}${payload.unlock ? ', unlocked' : ''}`,
      })

      session.flash('message', `บันทึกการตั้งค่า 2FA ของ ${user.username} แล้ว`)
      session.flash('messageType', 'success')
    } catch (err: any) {
      session.flash('message', err?.messages?.[0]?.message ?? err?.message ?? 'เกิดข้อผิดพลาด')
      session.flash('messageType', 'error')
    }
    return response.redirect().back()
  }

  async destroy(ctx: HttpContext) {
    const { request, auth, session, response } = ctx
    try {
      const payload = await request.validateUsing(deleteUserValidator)
      const currentUser = auth.user as User
      if (Number(payload.user_id) === currentUser.id) {
        session.flash('message', 'ไม่สามารถลบบัญชีของตัวเองได้')
        session.flash('messageType', 'error')
        return response.redirect().back()
      }
      const user = await User.find(payload.user_id)
      if (!user) {
        session.flash('message', 'ไม่พบผู้ใช้ที่ระบุ')
        session.flash('messageType', 'error')
        return response.redirect().back()
      }
      const usernameBefore = user.username
      await user.delete()
      await disableTwoFactor(user.id)
      await UserTwoFactor.query().where('user_id', user.id).delete()
      await clearLockout(userKey(usernameBefore))
      await writeAudit(ctx, {
        action: 'user.delete',
        entity: 'user',
        entityId: Number(payload.user_id),
        summary: `deleted user ${usernameBefore}`,
      })
      session.flash('message', 'ลบผู้ใช้สำเร็จ')
      session.flash('messageType', 'success')
    } catch (err: any) {
      session.flash('message', err?.messages?.[0]?.message ?? err?.message ?? 'เกิดข้อผิดพลาด')
      session.flash('messageType', 'error')
    }
    return response.redirect().back()
  }
}
