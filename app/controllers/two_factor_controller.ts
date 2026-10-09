import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import QRCode from 'qrcode'
import type User from '#models/user'
import { securitySettings } from '#services/app_settings'
import { checkLockout, recordFailedAttempt, userKey } from '#services/login_lockout'
import { buildTotpUri, generateTotpSecret, matchTotpStep } from '#services/totp'
import {
  citizenIdOf,
  consumeRecoveryCode,
  enableLine,
  enableTotp,
  hasPendingLineOtp,
  isLineOtpAvailable,
  isValidCitizenId,
  regenerateRecoveryCodes,
  sendLineOtp,
  twoFactorRecord,
  verifyLineOtp,
  verifyTotpFor,
} from '#services/two_factor'
import { clearPendingLogin, completeLogin, landingFor, pendingLoginUser } from '#services/login_flow'
import { writeAudit } from '#services/audit'

const sixDigits = vine.compile(vine.object({ code: vine.string().trim().regex(/^\d{6}$/) }))
const anyCode = vine.compile(vine.object({ code: vine.string().trim().minLength(6).maxLength(20) }))
const citizenIdForm = vine.compile(vine.object({ citizen_id: vine.string().trim().regex(/^\d{13}$/) }))

interface Subject {
  user: User
  /** true = still in the middle of logging in (not authenticated yet) */
  pending: boolean
}

/** Whoever this 2FA page is for: the logged-in user, or the one parked mid-login. */
async function subjectOf(ctx: HttpContext): Promise<Subject | null> {
  if (await ctx.auth.use('web').check()) return { user: ctx.auth.use('web').user as User, pending: false }
  const user = await pendingLoginUser(ctx)
  return user ? { user, pending: true } : null
}

/**
 * /2fa/* — second login step and 2FA enrolment (ported from 99CLAIM's
 * TwoFactorVerifyController + TwoFactorSetupController).
 */
export default class TwoFactorController {
  // ------------------------------------------------------------ verify (login step 2)

  async showVerify(ctx: HttpContext) {
    const { view, response, session } = ctx
    const subject = await subjectOf(ctx)
    if (!subject) return response.redirect('/login')
    if (!subject.pending) return response.redirect(landingFor(subject.user))

    const record = await twoFactorRecord(subject.user.id)
    if (!record?.method) return response.redirect('/2fa/setup')

    return view.render('pages/two_factor/verify', {
      method: record.method,
      username: subject.user.username,
      lineAvailable: await isLineOtpAvailable(),
      lineOtpPending: record.method === 'line' && (await hasPendingLineOtp(subject.user.id, 'login')),
      error: session.flashMessages.get('error'),
      notice: session.flashMessages.get('notice'),
    })
  }

  async sendVerifyLine(ctx: HttpContext) {
    const { response, session } = ctx
    const user = await pendingLoginUser(ctx)
    if (!user) return response.redirect('/login')

    const record = await twoFactorRecord(user.id)
    const cid = record?.method === 'line' ? citizenIdOf(record) : null
    if (!cid) return response.redirect('/2fa/verify')

    const result = await sendLineOtp(user.id, cid, 'login')
    if (result.success) session.flash('notice', 'ส่งรหัส OTP ไปทาง LINE (หมอพร้อม) แล้ว รหัสมีอายุ 5 นาที')
    else session.flash('error', result.message ?? 'ส่งรหัสไม่สำเร็จ')
    return response.redirect('/2fa/verify')
  }

  async verify(ctx: HttpContext) {
    const { request, response, session } = ctx
    const user = await pendingLoginUser(ctx)
    if (!user) {
      session.flash('error', 'หมดเวลายืนยันตัวตน กรุณาเข้าสู่ระบบใหม่')
      return response.redirect('/login')
    }
    const record = await twoFactorRecord(user.id)
    if (!record?.method) return response.redirect('/2fa/setup')

    const key = userKey(user.username)
    const lockedFor = await checkLockout(key)
    if (lockedFor !== null) return this.lockedOut(ctx, lockedFor)

    const data = await anyCode.validate(request.all()).catch(() => null)
    const code = data?.code.replace(/\s/g, '') ?? ''
    let via: 'totp' | 'line' | 'recovery' | null = null
    if (code && record.method === 'totp' && (await verifyTotpFor(record, code))) via = 'totp'
    else if (code && record.method === 'line' && (await verifyLineOtp(user.id, 'login', code))) via = 'line'
    else if (code && (await consumeRecoveryCode(user.id, code))) via = 'recovery'

    if (via) {
      await writeAudit(ctx, {
        action: 'auth.2fa_verified',
        entity: 'user',
        entityId: user.id,
        summary: `2FA passed for ${user.username} via ${via}`,
      })
      if (via === 'recovery') session.flash('notice', 'ใช้รหัสสำรองไปแล้ว 1 รหัส — ตรวจสอบจำนวนที่เหลือได้ที่หน้า "ความปลอดภัยบัญชี"')
      return completeLogin(ctx, user)
    }

    const s = await securitySettings()
    const nowLocked = await recordFailedAttempt(key, s.loginMaxAttempts, s.loginLockoutMinutes)
    if (nowLocked !== null) return this.lockedOut(ctx, nowLocked)

    session.flash('error', 'รหัสไม่ถูกต้อง กรุณาลองใหม่')
    return response.redirect('/2fa/verify')
  }

  /** Abandon the login midway (the pending user isn't logged in, so /logout doesn't apply). */
  async cancel(ctx: HttpContext) {
    clearPendingLogin(ctx)
    return ctx.response.redirect('/login')
  }

  private lockedOut(ctx: HttpContext, minutes: number) {
    clearPendingLogin(ctx)
    ctx.session.flash(
      'error',
      `ยืนยันตัวตนผิดพลาดหลายครั้ง บัญชีถูกล็อกชั่วคราว กรุณาลองใหม่ในอีก ${minutes} นาที`
    )
    return ctx.response.redirect('/login')
  }

  // ------------------------------------------------------------ setup (enrolment)

  async showSetup(ctx: HttpContext) {
    const { view, response, session, request } = ctx
    const subject = await subjectOf(ctx)
    if (!subject) return response.redirect('/login')
    const { user, pending } = subject

    const record = await twoFactorRecord(user.id)
    if (record?.method) return response.redirect(pending ? '/2fa/verify' : '/account/security')

    let secret = session.get('twofa.setupSecret') as string | undefined
    if (!secret) {
      secret = generateTotpSecret()
      session.put('twofa.setupSecret', secret)
    }
    const s = await securitySettings()
    const qrDataUrl = await QRCode.toDataURL(buildTotpUri(secret, user.username, s.twofaTotpIssuer), {
      margin: 1,
      width: 220,
    })
    const lineAvailable = await isLineOtpAvailable(s)

    return view.render('pages/two_factor/setup', {
      pending,
      username: user.username,
      secret,
      qrDataUrl,
      lineAvailable,
      lineSetupMessage: s.lineSetupMessage,
      lineOtpPending: lineAvailable && (await hasPendingLineOtp(user.id, 'setup')),
      method: request.input('method') === 'line' && lineAvailable ? 'line' : 'totp',
      citizenId: session.get('twofa.setupCitizenId') ?? '',
      error: session.flashMessages.get('error'),
      notice: session.flashMessages.get('notice'),
    })
  }

  async confirmTotp(ctx: HttpContext) {
    const { request, response, session } = ctx
    const subject = await subjectOf(ctx)
    if (!subject) return response.redirect('/login')
    if ((await twoFactorRecord(subject.user.id))?.method) return response.redirect('/2fa/setup')

    const data = await sixDigits.validate(request.all()).catch(() => null)
    const secret = session.get('twofa.setupSecret') as string | undefined
    const step = data && secret ? matchTotpStep(secret, data.code) : null
    if (step === null) {
      session.flash('error', 'รหัสไม่ถูกต้อง — ตรวจสอบว่าเวลาในโทรศัพท์ตรง แล้วลองรหัสล่าสุดอีกครั้ง')
      return response.redirect('/2fa/setup')
    }

    await enableTotp(subject.user.id, secret!, step)
    return this.finishSetup(ctx, subject, 'totp')
  }

  async sendSetupLine(ctx: HttpContext) {
    const { request, response, session } = ctx
    const subject = await subjectOf(ctx)
    if (!subject) return response.redirect('/login')
    if ((await twoFactorRecord(subject.user.id))?.method) return response.redirect('/2fa/setup')

    const data = await citizenIdForm.validate(request.all()).catch(() => null)
    if (!data || !isValidCitizenId(data.citizen_id)) {
      session.flash('error', 'เลขบัตรประชาชนไม่ถูกต้อง (13 หลัก)')
      return response.redirect('/2fa/setup?method=line')
    }

    session.put('twofa.setupCitizenId', data.citizen_id)
    const result = await sendLineOtp(subject.user.id, data.citizen_id, 'setup')
    if (result.success) session.flash('notice', 'ส่งรหัส OTP ไปทาง LINE (หมอพร้อม) แล้ว รหัสมีอายุ 5 นาที')
    else session.flash('error', result.message ?? 'ส่งรหัสไม่สำเร็จ')
    return response.redirect('/2fa/setup?method=line')
  }

  async confirmLine(ctx: HttpContext) {
    const { request, response, session } = ctx
    const subject = await subjectOf(ctx)
    if (!subject) return response.redirect('/login')
    if ((await twoFactorRecord(subject.user.id))?.method) return response.redirect('/2fa/setup')

    const data = await sixDigits.validate(request.all()).catch(() => null)
    const citizenId = session.get('twofa.setupCitizenId') as string | undefined
    if (!data || !citizenId || !(await verifyLineOtp(subject.user.id, 'setup', data.code))) {
      session.flash('error', 'รหัสไม่ถูกต้องหรือหมดอายุ กรุณาลองใหม่')
      return response.redirect('/2fa/setup?method=line')
    }

    await enableLine(subject.user.id, citizenId)
    return this.finishSetup(ctx, subject, 'line')
  }

  private async finishSetup(ctx: HttpContext, subject: Subject, method: 'totp' | 'line') {
    const { session, response } = ctx
    session.forget('twofa.setupSecret')
    session.forget('twofa.setupCitizenId')
    const codes = await regenerateRecoveryCodes(subject.user.id)
    await writeAudit(ctx, {
      action: 'auth.2fa_enabled',
      entity: 'user',
      entityId: subject.user.id,
      summary: `2FA enabled for ${subject.user.username} (${method})`,
    })

    // A forced enrolment during login doubles as the second step.
    const redirect = subject.pending
      ? await completeLogin(ctx, subject.user, '/2fa/recovery-codes')
      : response.redirect('/2fa/recovery-codes')
    session.put('twofa.recoveryCodes', codes)
    return redirect
  }

  /** Recovery codes are shown exactly once, right after they are generated. */
  async showRecoveryCodes({ view, session, response, auth }: HttpContext) {
    const codes = session.pull('twofa.recoveryCodes', null) as string[] | null
    if (!codes) return response.redirect('/account/security')
    return view.render('pages/two_factor/recovery_codes', {
      recoveryCodes: codes,
      continueUrl: landingFor(auth.user as User),
    })
  }
}
