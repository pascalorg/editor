import type { PasswordPolicyResult } from './api-contract'

/**
 * The five policy rules, as one pure function shared by both sides.
 *
 * The client renders it live under the field; the server re-runs it on submit.
 * Keeping a single implementation here — rather than a copy in each — is what
 * stops the meter from saying "Strong" on a password the API then rejects.
 * This module must stay free of Node imports so the client can pull it in.
 *
 * `identity` is the username or local part; rule 5 rejects a password that
 * contains it, or the word "netlog".
 */
export function checkPasswordPolicy(password: string, identity = ''): PasswordPolicyResult {
  const parts = identityParts(identity)
  const lower = password.toLowerCase()

  const minLength = password.length >= 10
  const mixedCase = /[a-z]/.test(password) && /[A-Z]/.test(password)
  const digit = /\d/.test(password)
  const symbol = /[^A-Za-z0-9]/.test(password)
  const noIdentity =
    password.length > 0 && !lower.includes('netlog') && !parts.some((part) => lower.includes(part))

  const passed = [minLength, mixedCase, digit, symbol, noIdentity].filter(Boolean).length

  return {
    minLength,
    mixedCase,
    digit,
    symbol,
    noIdentity,
    ok: passed === 5,
    // Same mapping as the prototype: ceil(passed * 4 / 5) - 1, clamped to 0..3.
    strength: Math.max(0, Math.min(3, Math.ceil((passed * 4) / 5) - 1)) as 0 | 1 | 2 | 3,
  }
}

/**
 * Every meaningful piece of the identity, lowercased.
 *
 * This used to be `identity.split('@')[0].split('.')[0]` — the first segment
 * only. That is exactly wrong for this product's username format: "r.ovur"
 * reduced to "r", which is under the three-character floor, so rule 5 was
 * skipped altogether and "R.ovur-2026!" scored full marks. Both segments count
 * now, plus the joined form, so neither "ovur" nor "rovur" gets through.
 *
 * The three-character floor stays: a user named "ab" must not be barred from
 * every password containing those two letters.
 */
function identityParts(identity: string): string[] {
  const local = (identity.split('@')[0] ?? '').toLowerCase()
  const segments = local.split(/[^a-z0-9]+/i).filter((part) => part.length >= 3)
  const joined = local.replace(/[^a-z0-9]+/gi, '')

  return joined.length >= 3 ? [...new Set([...segments, joined])] : segments
}
