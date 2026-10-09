import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import User from '#models/user'
import { securitySettings } from '#services/app_settings'
import { checkLockout, ipKey, recordFailedAttempt, userKey } from '#services/login_lockout'
import { isTwoFactorRequired, twoFactorRecord } from '#services/two_factor'
import {
  clearPendingLogin,
  completeLogin,
  landingFor,
  startPendingLogin,
} from '#services/login_flow'
import { writeAudit } from '#services/audit'

const loginValidator = vine.compile(
  vine.object({
    username: vine.string().trim().minLength(1),
    password: vine.string().minLength(1),
  })
)

const registerValidator = vine.compile(
  vine.object({
    username: vine.string().trim().minLength(3).maxLength(64),
    password: vine.string().minLength(6).maxLength(255),
    fullname: vine.string().trim().minLength(1).maxLength(255),
    department: vine.string().trim().maxLength(255).optional(),
  })
)

export default class AuthController {
  async showLogin({ view, auth, response, session }: HttpContext) {
    if (await auth.use('web').check()) {
      return response.redirect(landingFor(auth.use('web').user as User))
    }
    return view.render('pages/login', {
      error: session.flashMessages.get('error'),
      notice: session.flashMessages.get('notice'),
    })
  }

  async login(ctx: HttpContext) {
    const { request, response, view } = ctx
    let payload
    try {
      payload = await request.validateUsing(loginValidator)
    } catch {
      return view.render('pages/login', {
        error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน',
        username: request.input('username'),
      })
    }

    const fail = (error: string) => view.render('pages/login', { error, username: payload.username })
    const security = await securitySettings()
    const uKey = userKey(payload.username)
    const iKey = ipKey(request.ip())

    // Rate limit: refuse before even checking the password while locked
    const userLocked = await checkLockout(uKey)
    const ipLocked = security.ipMaxAttempts > 0 ? await checkLockout(iKey) : null
    if (userLocked !== null || ipLocked !== null) {
      return fail(
        `เข้าสู่ระบบผิดพลาดหลายครั้ง ระบบล็อกชั่วคราว กรุณาลองใหม่ในอีก ${Math.max(userLocked ?? 0, ipLocked ?? 0)} นาที`
      )
    }

    let user: User
    try {
      user = await User.verifyCredentials(payload.username, payload.password)
    } catch {
      const lockedFor = await recordFailedAttempt(uKey, security.loginMaxAttempts, security.loginLockoutMinutes)
      const ipLockedFor =
        security.ipMaxAttempts > 0
          ? await recordFailedAttempt(iKey, security.ipMaxAttempts, security.loginLockoutMinutes)
          : null
      if (lockedFor !== null || ipLockedFor !== null) {
        await writeAudit(ctx, {
          action: 'auth.lockout',
          entity: 'user',
          summary: `login locked for ${payload.username} from ${request.ip()}`,
          meta: { byUsername: lockedFor !== null, byIp: ipLockedFor !== null },
        })
        return fail(
          `เข้าสู่ระบบผิดพลาดหลายครั้ง ระบบล็อกชั่วคราว ${security.loginLockoutMinutes} นาที`
        )
      }
      return fail('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
    }

    if (user.status !== 1) {
      return fail('บัญชีของคุณยังไม่ได้รับการอนุมัติจากผู้ดูแลระบบ')
    }

    const record = await twoFactorRecord(user.id)
    if (await isTwoFactorRequired(user, record, security)) {
      startPendingLogin(ctx, user)
      return response.redirect(record?.method ? '/2fa/verify' : '/2fa/setup')
    }

    return completeLogin(ctx, user)
  }

  async logout(ctx: HttpContext) {
    const { auth, response } = ctx
    clearPendingLogin(ctx)
    if (await auth.use('web').check()) await auth.use('web').logout()
    return response.redirect('/login')
  }

  async showRegister({ view, auth, response }: HttpContext) {
    if (await auth.use('web').check()) {
      return response.redirect(landingFor(auth.use('web').user as User))
    }
    return view.render('pages/register')
  }

  async register({ request, view }: HttpContext) {
    let payload
    try {
      payload = await request.validateUsing(registerValidator)
    } catch (err: any) {
      return view.render('pages/register', {
        error: err?.messages?.[0]?.message ?? 'ข้อมูลไม่ถูกต้อง',
        old: request.only(['username', 'fullname', 'department']),
      })
    }

    const existing = await User.findBy('username', payload.username)
    if (existing) {
      return view.render('pages/register', {
        error: 'ชื่อผู้ใช้นี้มีอยู่แล้ว',
        old: payload,
      })
    }

    await User.create({
      username: payload.username,
      password: payload.password,
      fullname: payload.fullname,
      department: payload.department ?? null,
      userLevel: 'user',
      groupId: 2,
      status: 0,
    })

    return view.render('pages/register', {
      success: 'สมัครสมาชิกสำเร็จ! รอการอนุมัติจากผู้ดูแลระบบ',
    })
  }
}
