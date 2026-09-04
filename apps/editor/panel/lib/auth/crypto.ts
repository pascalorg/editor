import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

/**
 * AES-256-GCM at-rest encryption for the two secrets the schema marks as
 * "encrypted in the app layer": two_factor.totp_secret and webhooks.secret.
 * Layout: [12-byte IV][16-byte auth tag][ciphertext].
 */
const IV_BYTES = 12
const TAG_BYTES = 16

function key(): Buffer {
  const raw = process.env.SECRET_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'SECRET_ENCRYPTION_KEY is not set. Generate one with:\n' +
        "  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    )
  }
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) throw new Error('SECRET_ENCRYPTION_KEY must decode to exactly 32 bytes.')
  return buf
}

export function encryptSecret(plain: string): Buffer {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext])
}

export function decryptSecret(packed: Buffer): string {
  if (packed.length <= IV_BYTES + TAG_BYTES) throw new Error('encrypted payload is truncated')
  const iv = packed.subarray(0, IV_BYTES)
  const tag = packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const ciphertext = packed.subarray(IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', key(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

/** SHA-256, the hash the schema stores for invite tokens and recovery codes. */
export function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

/** Constant-time compare that tolerates length mismatch without throwing. */
export function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** URL-safe single-use token for invitations and password-reset links. */
export function newToken(): string {
  return randomBytes(32).toString('base64url')
}
