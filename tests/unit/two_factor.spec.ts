import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { TOTP, Secret } from 'otpauth'
import { buildTotpUri, generateTotpSecret, matchTotpStep, verifyTotpCode } from '#services/totp'
import {
  generateOtpCode,
  generateRecoveryCode,
  isValidCitizenId,
  twoFactorRequiredFor,
  type TwoFactorPolicyInput,
} from '#services/two_factor'
import { ipKey, isLocked, minutesRemaining, nextFailState, userKey } from '#services/login_lockout'

const codeAt = (secret: string, timestamp: number) =>
  new TOTP({ secret: Secret.fromBase32(secret), algorithm: 'SHA1', digits: 6, period: 30 }).generate({ timestamp })

test.group('totp', () => {
  test('secret is base32 and the URI carries issuer + account', ({ assert }) => {
    const secret = generateTotpSecret()
    assert.match(secret, /^[A-Z2-7]+=*$/)
    const uri = buildTotpUri(secret, 'somchai', 'HisReport KSN')
    assert.isTrue(uri.startsWith('otpauth://totp/'))
    assert.include(uri, 'HisReport%20KSN')
    assert.include(uri, 'somchai')
  })

  test('accepts the current code, rejects a wrong or malformed one', ({ assert }) => {
    const secret = generateTotpSecret()
    assert.isTrue(verifyTotpCode(secret, codeAt(secret, Date.now())))
    assert.isFalse(verifyTotpCode(secret, '00000a'))
    assert.isFalse(verifyTotpCode(secret, '12345'))
  })

  test('matchTotpStep returns the step the code belongs to (±1 window)', ({ assert }) => {
    const secret = generateTotpSecret()
    const now = 1_800_000_000_000
    const step = Math.floor(now / 30_000)
    assert.equal(matchTotpStep(secret, codeAt(secret, now), now), step)
    assert.equal(matchTotpStep(secret, codeAt(secret, now - 30_000), now), step - 1)
    assert.isNull(matchTotpStep(secret, codeAt(secret, now - 120_000), now))
  })
})

test.group('two factor policy', () => {
  const base: TwoFactorPolicyInput = {
    twofaEnabled: true,
    requiredLevels: [],
    userLevel: 'user',
    force: 'default',
    hasConfirmedMethod: false,
  }

  test('master switch off = never asked', ({ assert }) => {
    assert.isFalse(twoFactorRequiredFor({ ...base, twofaEnabled: false, hasConfirmedMethod: true, force: 'require' }))
  })

  test('exempt wins over enrolment and required level', ({ assert }) => {
    assert.isFalse(twoFactorRequiredFor({ ...base, force: 'exempt', hasConfirmedMethod: true, requiredLevels: ['user'] }))
  })

  test('enrolled, forced, or a required level = asked', ({ assert }) => {
    assert.isTrue(twoFactorRequiredFor({ ...base, hasConfirmedMethod: true }))
    assert.isTrue(twoFactorRequiredFor({ ...base, force: 'require' }))
    assert.isTrue(twoFactorRequiredFor({ ...base, userLevel: 'admin', requiredLevels: ['admin'] }))
    assert.isFalse(twoFactorRequiredFor({ ...base, requiredLevels: ['admin'] }))
  })
})

test.group('codes and citizen id', () => {
  test('recovery codes are 10 upper-case hex chars, OTPs 6 digits', ({ assert }) => {
    for (let i = 0; i < 20; i++) {
      assert.match(generateRecoveryCode(), /^[0-9A-F]{10}$/)
      assert.match(generateOtpCode(), /^\d{6}$/)
    }
  })

  test('citizen id checksum', ({ assert }) => {
    assert.isTrue(isValidCitizenId('1101700203450'))
    assert.isFalse(isValidCitizenId('1101700203451'))
    assert.isFalse(isValidCitizenId('110170020345'))
  })
})

test.group('login lockout', () => {
  const now = DateTime.fromISO('2026-10-09T10:00:00')

  test('locks once the limit is reached', ({ assert }) => {
    assert.isNull(nextFailState(3, 5, 15, now).lockedUntil)
    const locked = nextFailState(4, 5, 15, now)
    assert.equal(locked.failCount, 5)
    assert.equal(locked.lockedUntil!.toISO(), now.plus({ minutes: 15 }).toISO())
  })

  test('isLocked / minutesRemaining', ({ assert }) => {
    assert.isTrue(isLocked({ lockedUntil: now.plus({ minutes: 1 }) }, now))
    assert.isFalse(isLocked({ lockedUntil: now.minus({ seconds: 1 }) }, now))
    assert.isFalse(isLocked({ lockedUntil: null }, now))
    assert.equal(minutesRemaining(now.plus({ seconds: 61 }), now), 2)
    assert.equal(minutesRemaining(now.plus({ seconds: 5 }), now), 1)
  })

  test('keys are normalised and prefixed', ({ assert }) => {
    assert.equal(userKey('  Admin '), 'user:admin')
    assert.equal(ipKey('10.0.0.1'), 'ip:10.0.0.1')
  })
})
