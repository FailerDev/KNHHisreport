import { DateTime } from 'luxon'
import { randomBytes, randomInt } from 'node:crypto'
import hash from '@adonisjs/core/services/hash'
import encryption from '@adonisjs/core/services/encryption'
import type User from '#models/user'
import UserTwoFactor, { type TwoFactorForce } from '#models/user_two_factor'
import UserRecoveryCode from '#models/user_recovery_code'
import OtpCode from '#models/otp_code'
import { securitySettings, type SecuritySettings } from '#services/app_settings'
import { matchTotpStep } from '#services/totp'
import { sendMophOtp } from '#services/moph_alert'

/**
 * Two-factor authentication (ported from 99CLAIM, adapted to HisReport):
 *   - methods: TOTP (authenticator app) or LINE OTP (MOPH Alert, by citizen ID)
 *   - 10 one-time recovery codes per enrolment
 *   - policy: master switch + required user levels + per-user admin override
 */

// ---------------------------------------------------------------- policy

export interface TwoFactorPolicyInput {
  twofaEnabled: boolean
  requiredLevels: string[]
  userLevel: string
  force: TwoFactorForce
  hasConfirmedMethod: boolean
}

export function twoFactorRequiredFor(input: TwoFactorPolicyInput): boolean {
  // The master switch wins: off = nobody is asked for a code, even users who
  // enrolled or were set to "require".
  if (!input.twofaEnabled) return false
  if (input.force === 'exempt') return false
  if (input.hasConfirmedMethod) return true
  if (input.force === 'require') return true
  return input.requiredLevels.includes(input.userLevel)
}

export async function twoFactorRecord(userId: number): Promise<UserTwoFactor | null> {
  return UserTwoFactor.find(userId)
}

export async function isTwoFactorRequired(
  user: User,
  record?: UserTwoFactor | null,
  settings?: SecuritySettings
): Promise<boolean> {
  const s = settings ?? (await securitySettings())
  const r = record === undefined ? await twoFactorRecord(user.id) : record
  return twoFactorRequiredFor({
    twofaEnabled: s.twofaEnabled,
    requiredLevels: s.twofaRequiredLevels,
    userLevel: user.userLevel,
    force: r?.force ?? 'default',
    hasConfirmedMethod: !!r?.method,
  })
}

/** The user may not switch 2FA off themselves while it is required for them. */
export async function canSelfDisable(user: User, record: UserTwoFactor): Promise<boolean> {
  const s = await securitySettings()
  if (!s.twofaEnabled) return true
  if (record.force === 'exempt') return true
  return record.force !== 'require' && !s.twofaRequiredLevels.includes(user.userLevel)
}

// ---------------------------------------------------------------- record

const seal = (v: string) => encryption.encrypt(v)
const unseal = (v: string | null) => (v ? (encryption.decrypt<string>(v) ?? null) : null)

export const totpSecretOf = (r: UserTwoFactor) => unseal(r.totpSecret)
export const citizenIdOf = (r: UserTwoFactor) => unseal(r.citizenId)

async function upsertRecord(userId: number) {
  return (await UserTwoFactor.find(userId)) ?? new UserTwoFactor().merge({ userId, force: 'default' })
}

export async function enableTotp(userId: number, secretBase32: string, step: number) {
  const r = await upsertRecord(userId)
  r.merge({
    method: 'totp',
    totpSecret: seal(secretBase32),
    totpLastStep: step,
    citizenId: null,
    enabledAt: DateTime.now(),
  })
  await r.save()
}

export async function enableLine(userId: number, citizenId: string) {
  const r = await upsertRecord(userId)
  r.merge({ method: 'line', totpSecret: null, totpLastStep: null, citizenId: seal(citizenId), enabledAt: DateTime.now() })
  await r.save()
}

/** Remove the enrolment (keeps the admin override) and every code tied to it. */
export async function disableTwoFactor(userId: number) {
  const r = await UserTwoFactor.find(userId)
  if (r) {
    r.merge({ method: null, totpSecret: null, totpLastStep: null, citizenId: null, enabledAt: null })
    await r.save()
  }
  // Old recovery codes / OTPs must die with the enrolment, or a printed
  // recovery code would still get past the next enrolment.
  await UserRecoveryCode.query().where('user_id', userId).delete()
  await OtpCode.query().where('user_id', userId).delete()
}

export async function setForce(userId: number, force: TwoFactorForce) {
  const r = await upsertRecord(userId)
  r.force = force
  await r.save()
}

/** TOTP check that also refuses a code already used (same or earlier time step). */
export async function verifyTotpFor(record: UserTwoFactor, code: string): Promise<boolean> {
  const secret = totpSecretOf(record)
  if (record.method !== 'totp' || !secret) return false
  const step = matchTotpStep(secret, code)
  if (step === null) return false
  if (record.totpLastStep !== null && step <= Number(record.totpLastStep)) return false
  record.totpLastStep = step
  await record.save()
  return true
}

// ---------------------------------------------------------------- recovery codes

export const RECOVERY_CODE_COUNT = 10

export function generateRecoveryCode(): string {
  return randomBytes(5).toString('hex').toUpperCase()
}

export async function regenerateRecoveryCodes(userId: number): Promise<string[]> {
  await UserRecoveryCode.query().where('user_id', userId).delete()
  const codes: string[] = []
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const plain = generateRecoveryCode()
    codes.push(plain)
    await UserRecoveryCode.create({ userId, codeHash: await hash.make(plain), usedAt: null })
  }
  return codes
}

export async function consumeRecoveryCode(userId: number, code: string): Promise<boolean> {
  // Codes are generated upper-case; accept lower-case and stray spaces/dashes.
  const normalized = code.replace(/[\s-]/g, '').toUpperCase()
  if (!/^[0-9A-F]{10}$/.test(normalized)) return false
  const rows = await UserRecoveryCode.query().where('user_id', userId).whereNull('used_at')
  for (const row of rows) {
    if (await hash.verify(row.codeHash, normalized)) {
      row.usedAt = DateTime.now()
      await row.save()
      return true
    }
  }
  return false
}

export async function remainingRecoveryCodes(userId: number): Promise<number> {
  const [row] = await UserRecoveryCode.query()
    .where('user_id', userId)
    .whereNull('used_at')
    .count('* as total')
  return Number(row?.$extras.total ?? 0)
}

// ---------------------------------------------------------------- LINE OTP

const OTP_TTL_MINUTES = 5
const RESEND_COOLDOWN_SECONDS = 60
const OTP_MAX_ATTEMPTS = 5

export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function isValidCitizenId(cid: string): boolean {
  if (!/^\d{13}$/.test(cid)) return false
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(cid[i]) * (13 - i)
  return (11 - (sum % 11)) % 10 === Number(cid[12])
}

export async function isLineOtpAvailable(settings?: SecuritySettings): Promise<boolean> {
  const s = settings ?? (await securitySettings())
  return !!(s.mophAlertApiUrl && s.mophAlertClientKey && s.mophAlertSecretKey)
}

export async function sendLineOtp(
  userId: number,
  citizenId: string,
  purpose: 'login' | 'setup'
): Promise<{ success: boolean; message: string | null }> {
  const recent = await OtpCode.query()
    .where('user_id', userId)
    .where('purpose', purpose)
    .whereNull('consumed_at')
    .where('created_at', '>', DateTime.now().minus({ seconds: RESEND_COOLDOWN_SECONDS }).toSQL({ includeOffset: false })!)
    .first()
  if (recent) return { success: false, message: 'ส่งรหัสไปแล้วเมื่อสักครู่ กรุณารอ 1 นาทีก่อนขอรหัสใหม่' }

  const s = await securitySettings()
  const code = generateOtpCode()
  const result = await sendMophOtp(citizenId, code, {
    apiUrl: s.mophAlertApiUrl ?? '',
    clientKey: s.mophAlertClientKey ?? '',
    secretKey: s.mophAlertSecretKey ?? '',
    systemName: s.twofaTotpIssuer,
  })
  if (!result.success) return result

  await OtpCode.query().where('user_id', userId).where('purpose', purpose).whereNull('consumed_at').delete()
  await OtpCode.create({
    userId,
    codeHash: await hash.make(code),
    purpose,
    expiresAt: DateTime.now().plus({ minutes: OTP_TTL_MINUTES }),
    attempts: 0,
    consumedAt: null,
  })
  return { success: true, message: null }
}

export async function hasPendingLineOtp(userId: number, purpose: 'login' | 'setup'): Promise<boolean> {
  const row = await OtpCode.query()
    .where('user_id', userId)
    .where('purpose', purpose)
    .whereNull('consumed_at')
    .where('expires_at', '>', DateTime.now().toSQL({ includeOffset: false })!)
    .first()
  return !!row
}

export async function verifyLineOtp(userId: number, purpose: 'login' | 'setup', code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false
  const row = await OtpCode.query()
    .where('user_id', userId)
    .where('purpose', purpose)
    .whereNull('consumed_at')
    .where('expires_at', '>', DateTime.now().toSQL({ includeOffset: false })!)
    .orderBy('id', 'desc')
    .first()
  if (!row || row.attempts >= OTP_MAX_ATTEMPTS) return false

  row.attempts += 1
  const valid = await hash.verify(row.codeHash, code)
  if (valid) row.consumedAt = DateTime.now()
  await row.save()
  return valid
}
