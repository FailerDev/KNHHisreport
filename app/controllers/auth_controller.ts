import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import vine from '@vinejs/vine'
import User from '#models/user'

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
  async showLogin({ view, auth, response }: HttpContext) {
    if (await auth.use('web').check()) {
      return response.redirect(this.landingFor(auth.use('web').user as User))
    }
    return view.render('pages/login')
  }

  async login({ request, auth, response, view }: HttpContext) {
    let payload
    try {
      payload = await request.validateUsing(loginValidator)
    } catch {
      return view.render('pages/login', {
        error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน',
        username: request.input('username'),
      })
    }

    let user: User
    try {
      user = await User.verifyCredentials(payload.username, payload.password)
    } catch {
      return view.render('pages/login', {
        error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
        username: payload.username,
      })
    }

    if (user.status !== 1) {
      return view.render('pages/login', {
        error: 'บัญชีของคุณยังไม่ได้รับการอนุมัติจากผู้ดูแลระบบ',
        username: payload.username,
      })
    }

    await auth.use('web').login(user)

    user.lastLogin = DateTime.now()
    try {
      await user.save()
    } catch {
      /* best-effort */
    }

    return response.redirect(this.landingFor(user))
  }

  async logout({ auth, response }: HttpContext) {
    await auth.use('web').logout()
    return response.redirect('/login')
  }

  async showRegister({ view, auth, response }: HttpContext) {
    if (await auth.use('web').check()) {
      return response.redirect(this.landingFor(auth.use('web').user as User))
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

  private landingFor(user: User): string {
    return user?.userLevel === 'admin' ? '/admin/dashboard' : '/reports'
  }
}
