/** Float-safe rounding helpers. Parsing never rounds; formatting does. */

/**
 * Round to `dp` decimal places (negative dp rounds to tens/hundreds…), half
 * away from zero, epsilon-guarded.
 * @example
 * ```ts
 * import { roundDp } from '@pascal-app/lingo/core'
 * roundDp(1.005, 2)  // 1.01 (float-safe; naive .toFixed(2) gives 1.00)
 * roundDp(1234, -2)  // 1200
 * ```
 */
export function roundDp(value: number, dp: number): number {
  if (!Number.isFinite(value) || value === 0) {
    return value
  }
  const scale = 10 ** dp
  const scaled = Math.abs(value) * scale
  // Nudge values sitting a hair under a half-step (float artifacts like
  // 1.00499999999997) over the edge before rounding.
  const rounded = Math.round(scaled * (1 + Number.EPSILON * 8))
  return (Math.sign(value) * rounded) / scale
}

/**
 * Round to `sig` significant digits (default DX-friendly 4).
 * @example
 * ```ts
 * import { roundSig } from '@pascal-app/lingo/core'
 * roundSig(1234.5678, 3) // 1230
 * roundSig(0.012345)     // 0.01235 (default 4 significant digits)
 * ```
 */
export function roundSig(value: number, sig = 4): number {
  if (!Number.isFinite(value) || value === 0) {
    return value
  }
  const digits = Math.ceil(Math.log10(Math.abs(value)))
  return roundDp(value, sig - digits)
}

/**
 * Relative approximate equality (default 1e-9), absolute near zero.
 * @example
 * ```ts
 * import { approxEqual } from '@pascal-app/lingo/core'
 * approxEqual(0.1 + 0.2, 0.3) // true (exact === would be false)
 * ```
 */
export function approxEqual(a: number, b: number, rel = 1e-9): boolean {
  if (a === b) {
    return true
  }
  const diff = Math.abs(a - b)
  const scale = Math.max(Math.abs(a), Math.abs(b))
  return scale < 1e-300 ? diff < 1e-300 : diff / scale <= rel
}
