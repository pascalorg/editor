import { describe, expect, it } from 'bun:test'
import { hashPassword, verifyPassword } from './password'

describe('hashPassword / verifyPassword', () => {
  it('produces a self-describing salted hash', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash.startsWith('scrypt$16384$8$1$')).toBe(true)
    expect(hash.split('$')).toHaveLength(6)
  })

  it('salts: the same password hashes differently each time', async () => {
    const a = await hashPassword('same-password')
    const b = await hashPassword('same-password')
    expect(a).not.toBe(b)
  })

  it('accepts the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('s3cret-password')
    expect(await verifyPassword('s3cret-password', hash)).toBe(true)
    expect(await verifyPassword('wrong-password', hash)).toBe(false)
  })

  it('returns false for malformed stored hashes instead of throwing', async () => {
    for (const bad of ['', 'notscrypt', 'scrypt$1$2', 'scrypt$x$8$1$aaaa$bbbb', 'a$b$c$d$e$f']) {
      expect(await verifyPassword('whatever', bad)).toBe(false)
    }
  })
})
