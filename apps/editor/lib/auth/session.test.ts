import { describe, expect, it } from 'bun:test'
import { hashToken, isSecureScheme, newToken } from './session'

describe('hashToken / newToken', () => {
  it('hashes deterministically to 64 hex chars', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'))
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/)
    expect(hashToken('abc')).not.toBe(hashToken('abd'))
  })

  it('mints distinct opaque tokens', () => {
    expect(newToken()).not.toBe(newToken())
    expect(newToken().length).toBeGreaterThan(30)
  })
})

describe('isSecureScheme', () => {
  it('is secure when the proxy reports https', () => {
    expect(isSecureScheme('https', 'development')).toBe(true)
    expect(isSecureScheme('https,http', 'development')).toBe(true)
  })

  it('is secure in production regardless of scheme', () => {
    expect(isSecureScheme(null, 'production')).toBe(true)
    expect(isSecureScheme('http', 'production')).toBe(true)
  })

  it('is not secure on plain http in development, so localhost login works', () => {
    expect(isSecureScheme('http', 'development')).toBe(false)
    expect(isSecureScheme(null, 'development')).toBe(false)
  })
})
