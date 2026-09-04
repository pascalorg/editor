import { makeIssue } from './core/errors'
import type { IssueCode, IssueInputData, LingoIssue, Messages } from './core/types'
import type {
  ConversionResult,
  FailResult,
  LingoResult,
  NumberResult,
  QuantityResult,
  RangeResult,
} from './parse/grammar'

/**
 * The first `severity: 'error'` issue on a result, or `null` — a shortcut
 * for `result.issues.find(i => i.severity === 'error')` that also accepts
 * `null`/`undefined` (handy on `firstError(lingo(...))`).
 * @example
 * ```ts
 * import { lingo, firstError } from '@pascal-app/lingo'
 * // forgiving mode fixes the typo (ok:true), so turn typo-fixing off to error:
 * firstError(lingo('5 meterz', { kind: 'length', tolerance: { typos: 'off' } }))?.code // 'UNKNOWN_UNIT'
 * ```
 */
export function firstError(result: LingoResult | null | undefined): LingoIssue | null {
  return result?.issues.find((issue) => issue.severity === 'error') ?? null
}

/**
 * Narrow a `LingoResult` to `QuantityResult` — `ok: true` and `type: 'quantity'`.
 * @example
 * ```ts
 * import { lingo, isQuantity } from '@pascal-app/lingo'
 * const r = lingo('5 kg')
 * if (isQuantity(r)) r.quantity.value // 5
 * ```
 */
export function isQuantity(result: LingoResult): result is QuantityResult {
  return result.ok && result.type === 'quantity'
}

/**
 * Narrow a `LingoResult` to `RangeResult` — `ok: true` and `type: 'range'`.
 * @example
 * ```ts
 * import { lingo, isRange } from '@pascal-app/lingo'
 * const r = lingo('5-10 kg')
 * if (isRange(r)) r.range.min()?.value // 5
 * ```
 */
export function isRange(result: LingoResult): result is RangeResult {
  return result.ok && result.type === 'range'
}

/**
 * Narrow a `LingoResult` to `ConversionResult` — `ok: true` and `type: 'conversion'`.
 * @example
 * ```ts
 * import { lingo, isConversion } from '@pascal-app/lingo'
 * const r = lingo('72 in to cm')
 * if (isConversion(r)) r.targetUnit // 'cm'
 * ```
 */
export function isConversion(result: LingoResult): result is ConversionResult {
  return result.ok && result.type === 'conversion'
}

/**
 * Narrow a `LingoResult` to `NumberResult` — `ok: true` and `type: 'number'`.
 * @example
 * ```ts
 * import { lingo, isNumber } from '@pascal-app/lingo'
 * const r = lingo('72')
 * if (isNumber(r)) r.value // 72
 * ```
 */
export function isNumber(result: LingoResult): result is NumberResult {
  return result.ok && result.type === 'number'
}

/**
 * The would-have-been result attached to a failure under `strictness:
 * 'confirm'`/`'strict'` (or `NOW_REQUIRED` in `lingo/date`) — `null` on
 * success or when there's no candidate.
 * @example
 * ```ts
 * import { lingo, candidateOf } from '@pascal-app/lingo'
 * const r = lingo('5 meterz', { kind: 'length', strictness: 'confirm' })
 * const c = candidateOf(r)
 * c?.type === 'quantity' && c.quantity.format() // "5 m"
 * ```
 */
export function candidateOf(result: LingoResult): Exclude<LingoResult, FailResult> | null {
  return result.ok ? null : (result.candidate ?? null)
}

/**
 * Render an issue's message against a different `messages` pack than the one
 * it was created with — for late localization or per-render copy overrides.
 * @example
 * ```ts
 * import { lingo, formatIssue } from '@pascal-app/lingo'
 * const r = lingo('5 meterz', { kind: 'length' })
 * formatIssue(r.issues[0], { TYPO_CORRECTED: 'Fixed "{unit}" → {corrected}.' })
 * // 'Fixed "meterz" → m.'
 * ```
 */
export function formatIssue<C extends IssueCode>(
  issue: LingoIssue<C>,
  messages?: Messages,
): string {
  if (!messages) {
    return issue.message
  }
  return makeIssue(
    issue.code,
    { ...(issue.data ?? {}), suggestions: issue.suggestions } as IssueInputData<C>,
    issue.span,
    messages,
  ).message
}
