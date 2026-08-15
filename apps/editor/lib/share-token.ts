import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * View-only share links.
 *
 * The token is stateless: scene id and expiry travel inside it, signed with a
 * server secret. No share record is stored, so there is no new table to
 * migrate, nothing to garbage-collect, and a link cannot outlive its own `exp`
 * through a stale row. The cost is that an individual link cannot be revoked
 * without rotating the secret — acceptable while links are short-lived and
 * grant reading plus commenting, never editing.
 */

export type ShareTokenPayload = {
  /** Scene id the link grants read access to. */
  sid: string
  /** Issued at, epoch seconds. */
  iat: number
  /** Expires at, epoch seconds. Absent means the link does not expire. */
  exp?: number
}

export type ShareTokenError = 'secret_missing' | 'malformed' | 'bad_signature' | 'expired'

export type ShareTokenResult =
  | { ok: true; payload: ShareTokenPayload }
  | { ok: false; error: ShareTokenError }

const SECRET_ENV = 'PASCAL_SHARE_LINK_SECRET'

export function shareSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = env[SECRET_ENV]?.trim()
  return secret ? secret : null
}

const base64UrlEncode = (value: Buffer | string): string =>
  (Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8')).toString('base64url')

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url')
}

/**
 * Mint a token for `sceneId`. `ttlSeconds` of 0 or undefined means no expiry.
 * Returns `null` when no secret is configured — the caller must fail the
 * request rather than hand out an unsigned link.
 */
export function createShareToken(
  sceneId: string,
  options: { ttlSeconds?: number; now?: number; env?: NodeJS.ProcessEnv } = {},
): { token: string; payload: ShareTokenPayload } | null {
  const secret = shareSecret(options.env)
  if (!secret) return null

  const iat = Math.floor((options.now ?? Date.now()) / 1000)
  const payload: ShareTokenPayload = { sid: sceneId, iat }
  if (options.ttlSeconds && options.ttlSeconds > 0) {
    payload.exp = iat + Math.floor(options.ttlSeconds)
  }

  const body = base64UrlEncode(JSON.stringify(payload))
  return { token: `${body}.${sign(body, secret)}`, payload }
}

/**
 * Verify a token and return its payload.
 *
 * The signature is compared before the payload is trusted for anything, and
 * with a constant-time compare so a wrong token cannot be refined byte by byte
 * from response timing.
 */
export function verifyShareToken(
  token: string,
  options: { now?: number; env?: NodeJS.ProcessEnv } = {},
): ShareTokenResult {
  const secret = shareSecret(options.env)
  if (!secret) return { ok: false, error: 'secret_missing' }

  const separator = token.lastIndexOf('.')
  if (separator <= 0 || separator === token.length - 1) {
    return { ok: false, error: 'malformed' }
  }

  const body = token.slice(0, separator)
  const signature = token.slice(separator + 1)
  const expected = sign(body, secret)
  const signatureBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return { ok: false, error: 'bad_signature' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, error: 'malformed' }
  }

  if (typeof parsed !== 'object' || parsed === null) return { ok: false, error: 'malformed' }
  const { sid, iat, exp } = parsed as Record<string, unknown>
  if (typeof sid !== 'string' || !sid) return { ok: false, error: 'malformed' }
  if (typeof iat !== 'number' || !Number.isFinite(iat)) return { ok: false, error: 'malformed' }
  if (exp !== undefined && (typeof exp !== 'number' || !Number.isFinite(exp))) {
    return { ok: false, error: 'malformed' }
  }

  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000)
  if (typeof exp === 'number' && nowSeconds >= exp) return { ok: false, error: 'expired' }

  const payload: ShareTokenPayload = { sid, iat }
  if (typeof exp === 'number') payload.exp = exp
  return { ok: true, payload }
}
