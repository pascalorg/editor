import { hash, verify } from '@node-rs/argon2'

/**
 * argon2id at the OWASP second-recommended setting (19 MiB, t=2, p=1). Kept in
 * one place so a future cost bump is a single edit and old hashes still verify —
 * the parameters travel inside the encoded hash string.
 */
// 2 is Algorithm.Argon2id. Spelled numerically because the exported enum is an
// ambient const enum, which isolatedModules cannot read at runtime.
const ARGON2ID = 2

const OPTS = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const

export async function hashPassword(plain: string): Promise<Buffer> {
  return Buffer.from(await hash(plain, OPTS), 'utf8')
}

/**
 * Verifies a password against a stored hash. Returns false rather than throwing
 * on a malformed hash so a corrupt row reads as "wrong password", not a 500.
 */
export async function verifyPassword(stored: Buffer | null, plain: string): Promise<boolean> {
  if (!stored || stored.length === 0) return false
  try {
    return await verify(stored.toString('utf8'), plain, OPTS)
  } catch {
    return false
  }
}

/**
 * Burns roughly one hash's worth of time on a miss. Without it, an unknown
 * username answers measurably faster than a known one with a wrong password,
 * which is exactly the disclosure the generic error message exists to prevent.
 */
export async function fakeVerify(): Promise<void> {
  await hash('dt-timing-equaliser', OPTS)
}

/**
 * Re-exported, not redefined: the rules live in a Node-free module so the
 * strength meter and this server-side check can never drift apart.
 */
export { checkPasswordPolicy } from '../password-policy'

/**
 * Temporary password handed to an invited user. Deliberately satisfies the
 * policy so the first sign-in is never blocked by its own bootstrap credential.
 */
export function generateTempPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnpqrstuvwxyz'
  const digits = '23456789'
  const symbols = '!@#$%&*?'
  const all = upper + lower + digits + symbols

  const pick = (set: string) => set[randomInt(set.length)]
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)]
  while (chars.length < 14) chars.push(pick(all))

  // Fisher–Yates so the guaranteed classes are not always in positions 0–3.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

function randomInt(maxExclusive: number): number {
  // Rejection sampling — plain `% max` skews toward the low end of the range.
  const limit = Math.floor(0xffffffff / maxExclusive) * maxExclusive
  const buf = new Uint32Array(1)
  let value: number
  do {
    crypto.getRandomValues(buf)
    value = buf[0] ?? 0
  } while (value >= limit)
  return value % maxExclusive
}
