import { TOTP, Secret } from 'otpauth'

/** TOTP (Google Authenticator / Microsoft Authenticator) — RFC 6238, SHA1, 6 digits, 30 s. */

const PERIOD = 30

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32
}

function totpFor(secretBase32: string, label = 'user', issuer = 'HisReport') {
  return new TOTP({
    issuer,
    label,
    secret: Secret.fromBase32(secretBase32),
    algorithm: 'SHA1',
    digits: 6,
    period: PERIOD,
  })
}

export function buildTotpUri(secretBase32: string, accountName: string, issuer: string): string {
  return totpFor(secretBase32, accountName, issuer).toString()
}

/**
 * Check a code (±1 step for clock drift). Returns the time step it matched so
 * the caller can refuse the same code twice, or null when it doesn't match.
 */
export function matchTotpStep(secretBase32: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null
  const delta = totpFor(secretBase32).validate({ token: code, timestamp: now, window: 1 })
  return delta === null ? null : Math.floor(now / 1000 / PERIOD) + delta
}

export function verifyTotpCode(secretBase32: string, code: string): boolean {
  return matchTotpStep(secretBase32, code) !== null
}
