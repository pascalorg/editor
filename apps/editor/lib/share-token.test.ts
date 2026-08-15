import { describe, expect, test } from 'bun:test'
import { createShareToken, shareSecret, verifyShareToken } from './share-token'

const env = { PASCAL_SHARE_LINK_SECRET: 'test-secret' } as unknown as NodeJS.ProcessEnv
const otherEnv = { PASCAL_SHARE_LINK_SECRET: 'other-secret' } as unknown as NodeJS.ProcessEnv
const emptyEnv = {} as NodeJS.ProcessEnv

const NOW = Date.UTC(2026, 7, 15, 12, 0, 0)

describe('shareSecret', () => {
  test('treats a blank secret as absent so a stray empty var cannot sign links', () => {
    expect(shareSecret({ PASCAL_SHARE_LINK_SECRET: '   ' } as never)).toBeNull()
    expect(shareSecret(emptyEnv)).toBeNull()
  })
})

describe('createShareToken', () => {
  test('returns null with no secret rather than minting an unsigned link', () => {
    expect(createShareToken('scene_1', { env: emptyEnv })).toBeNull()
  })

  test('omits exp when no ttl is given', () => {
    const minted = createShareToken('scene_1', { env, now: NOW })
    expect(minted?.payload.exp).toBeUndefined()
  })

  test('sets exp from the ttl', () => {
    const minted = createShareToken('scene_1', { env, now: NOW, ttlSeconds: 3600 })
    expect(minted?.payload.exp).toBe(Math.floor(NOW / 1000) + 3600)
  })
})

describe('verifyShareToken', () => {
  test('round-trips a minted token', () => {
    const minted = createShareToken('scene_abc', { env, now: NOW, ttlSeconds: 3600 })
    if (!minted) throw new Error('expected a token')

    const result = verifyShareToken(minted.token, { env, now: NOW })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payload.sid).toBe('scene_abc')
    expect(result.payload.exp).toBe(minted.payload.exp)
  })

  test('rejects a token signed with a different secret', () => {
    const minted = createShareToken('scene_abc', { env, now: NOW })
    if (!minted) throw new Error('expected a token')

    const result = verifyShareToken(minted.token, { env: otherEnv, now: NOW })
    expect(result).toEqual({ ok: false, error: 'bad_signature' })
  })

  // The whole point of signing: the scene id must not be swappable by anyone
  // holding a valid link to a scene they are allowed to see.
  test('rejects a token whose payload was edited to point at another scene', () => {
    const minted = createShareToken('scene_abc', { env, now: NOW })
    if (!minted) throw new Error('expected a token')

    const [, signature] = minted.token.split('.')
    const forgedBody = Buffer.from(
      JSON.stringify({ sid: 'scene_someone_elses', iat: Math.floor(NOW / 1000) }),
    ).toString('base64url')

    const result = verifyShareToken(`${forgedBody}.${signature}`, { env, now: NOW })
    expect(result).toEqual({ ok: false, error: 'bad_signature' })
  })

  test('rejects an expired token, exactly at expiry', () => {
    const minted = createShareToken('scene_abc', { env, now: NOW, ttlSeconds: 60 })
    if (!minted) throw new Error('expected a token')

    expect(verifyShareToken(minted.token, { env, now: NOW + 59_000 }).ok).toBe(true)
    expect(verifyShareToken(minted.token, { env, now: NOW + 60_000 })).toEqual({
      ok: false,
      error: 'expired',
    })
  })

  test('a token with no exp keeps working far in the future', () => {
    const minted = createShareToken('scene_abc', { env, now: NOW })
    if (!minted) throw new Error('expected a token')
    expect(verifyShareToken(minted.token, { env, now: NOW + 10 * 365 * 86_400_000 }).ok).toBe(true)
  })

  test('reports malformed input without throwing', () => {
    for (const bad of ['', '.', 'nodot', 'abc.', '.abc']) {
      const result = verifyShareToken(bad, { env, now: NOW })
      expect(result.ok).toBe(false)
    }
  })

  test('fails closed when the secret is not configured', () => {
    const minted = createShareToken('scene_abc', { env, now: NOW })
    if (!minted) throw new Error('expected a token')
    expect(verifyShareToken(minted.token, { env: emptyEnv, now: NOW })).toEqual({
      ok: false,
      error: 'secret_missing',
    })
  })
})
