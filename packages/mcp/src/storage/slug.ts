const MAX_SLUG_LENGTH = 64
const GENERATED_SLUG_LENGTH = 12
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/**
 * Normalizes a raw string into a slug:
 * - lowercase
 * - spaces → hyphen
 * - strip non [a-z0-9-]
 * - collapse consecutive hyphens
 * - trim hyphens from ends
 * - enforce ≤ 64 chars
 *
 * Throws if the result is empty.
 */
export function sanitizeSlug(raw: string): string {
  const sanitized = raw
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '')

  if (sanitized.length === 0) {
    throw new Error('Slug cannot be empty after sanitization')
  }

  return sanitized
}

/**
 * Checks if a string is already a valid slug (no sanitization performed).
 */
export function isValidSlug(s: string): boolean {
  if (typeof s !== 'string') return false
  if (s.length === 0 || s.length > MAX_SLUG_LENGTH) return false
  return SLUG_PATTERN.test(s)
}

/**
 * Generates a fresh 12-char lowercase alphanumeric slug using crypto randomness.
 */
export function generateSlug(): string {
  const raw = globalThis.crypto?.randomUUID?.().replace(/-/g, '') ?? fallbackRandom()
  const base = raw.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (base.length >= GENERATED_SLUG_LENGTH) {
    return base.slice(0, GENERATED_SLUG_LENGTH)
  }
  // Pad with additional random chars if for any reason the base is short.
  let out = base
  while (out.length < GENERATED_SLUG_LENGTH) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return out.slice(0, GENERATED_SLUG_LENGTH)
}

function fallbackRandom(): string {
  let out = ''
  for (let i = 0; i < GENERATED_SLUG_LENGTH * 2; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return out
}
