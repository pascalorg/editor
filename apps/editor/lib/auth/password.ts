import { randomBytes, type ScryptOptions, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>

const KEYLEN = 64
// N=16384, r=8, p=1 is a well-established interactive-login cost (~bcrypt-10).
const N = 16384
const R = 8
const P = 1
const MAXMEM = 64 * 1024 * 1024

/**
 * Returns a self-describing hash: `scrypt$N$r$p$<salt_b64url>$<hash_b64url>`.
 * Encoding the parameters lets us raise the cost later without breaking old
 * hashes.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

/**
 * Constant-time verification. Returns false for any malformed encoded string
 * rather than throwing, so a corrupt row can never crash a login.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ]
  const n = Number.parseInt(nRaw, 10)
  const r = Number.parseInt(rRaw, 10)
  const p = Number.parseInt(pRaw, 10)
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false

  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(saltRaw, 'base64url')
    expected = Buffer.from(hashRaw, 'base64url')
  } catch {
    return false
  }
  if (salt.length === 0 || expected.length === 0) return false

  let derived: Buffer
  try {
    derived = await scrypt(password, salt, expected.length, { N: n, r, p, maxmem: MAXMEM })
  } catch {
    return false
  }
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}
