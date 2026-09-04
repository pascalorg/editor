import { makeIssue } from '../core/errors'
import {
  type IssueInputData,
  type Kind,
  type LingoIssue,
  type LingoOptions,
  type LingoResult,
  parseQuantity,
  type Quantity,
  type QuantityRange,
  type Span,
} from '../index'
import type { LingoInputOptions } from './index'

export type CandidateResult = Exclude<LingoResult, { ok: false }>

/**
 * Parse/format knobs shared by the DOM controller and the React Native
 * headless field. Deliberately excludes DOM wiring (`name`, elements, ARIA)
 * and callback shapes so both adapters can pass options without casting.
 */
export type LingoFieldFormatOptions = Pick<
  LingoInputOptions,
  | 'accept'
  | 'display'
  | 'displayUnit'
  | 'escalate'
  | 'kind'
  | 'messages'
  | 'numberFormat'
  | 'profile'
  | 'registry'
  | 'strictness'
  | 'system'
  | 'tolerance'
  | 'unit'
>

export interface Material {
  approximate: boolean
  canonical: string | null
  kind: Kind | null
  quantity: Quantity | QuantityRange | null
  value: number | null
}

export function toLingoOptions(opts: LingoFieldFormatOptions): LingoOptions {
  const out: LingoOptions = {}
  if (opts.kind !== undefined) {
    out.kind = opts.kind
  }
  if (opts.unit !== undefined) {
    out.unit = opts.unit
  }
  if (opts.system !== undefined) {
    out.system = opts.system
  }
  if (opts.numberFormat !== undefined) {
    out.numberFormat = opts.numberFormat
  }
  if (opts.profile !== undefined) {
    out.profile = opts.profile
  }
  if (opts.strictness !== undefined) {
    out.strictness = opts.strictness
  }
  if (opts.accept !== undefined) {
    out.accept = opts.accept
  }
  if (opts.tolerance !== undefined) {
    out.tolerance = opts.tolerance
  }
  if (opts.escalate !== undefined) {
    out.escalate = opts.escalate
  }
  if (opts.messages !== undefined) {
    out.messages = opts.messages
  }
  if (opts.registry !== undefined) {
    out.registry = opts.registry
  }
  return out
}

// Copy must flow through core's resolution chain (custom messages -> the
// pack registered via setDefaultMessages -> the code string) so pack
// overrides reach DOM-produced RANGE_MIN/RANGE_MAX/REQUIRED issues too.
export function localIssue<C extends 'RANGE_MIN' | 'RANGE_MAX' | 'REQUIRED'>(
  opts: LingoFieldFormatOptions,
  code: C,
  data: IssueInputData<C>,
  span: Span,
): LingoIssue<C> {
  return makeIssue(code, data, span, opts.messages)
}

export function failResult(text: string, issues: LingoIssue[]): LingoResult {
  return { ok: false, schemaVersion: 3, type: 'failure', text, issues }
}

export function resultKind(result: LingoResult): Kind | null {
  if (!result.ok) {
    return null
  }
  if (result.type === 'quantity') {
    return result.quantity.kind
  }
  if (result.type === 'range') {
    return result.range.kind
  }
  if (result.type === 'conversion') {
    return result.converted.kind
  }
  return null
}

function quantityValue(q: Quantity, unit: string | undefined): number {
  return unit ? q.to(unit).value : q.value
}

function rangeInUnit(range: QuantityRange, unit: string | undefined): QuantityRange {
  return unit ? range.to(unit) : range
}

export function formatQuantityForDisplay(q: Quantity, unit: string | undefined): string {
  return q.format({ unit: unit ?? q.unit, significant: 3 })
}

function formatRangeForDisplay(range: QuantityRange, unit: string | undefined): string {
  return rangeInUnit(range, unit).format({ significant: 3 })
}

export function defaultHiddenValue(q: Quantity | QuantityRange, unit: string | undefined): string {
  if ('base' in q) {
    return String(quantityValue(q, unit))
  }
  const range = rangeInUnit(q, unit)
  const min = range.min()
  const max = range.max()
  const minValue = min ? String(quantityValue(min, unit)) : ''
  const maxValue = max ? String(quantityValue(max, unit)) : ''
  return `${minValue}..${maxValue}`
}

export function materialize(result: LingoResult | null, opts: LingoFieldFormatOptions): Material {
  if (!result?.ok) {
    return { quantity: null, value: null, kind: null, approximate: false, canonical: null }
  }
  if (result.type === 'quantity') {
    const quantity = opts.unit ? result.quantity.to(opts.unit) : result.quantity
    return {
      quantity,
      value: quantity.value,
      kind: quantity.kind,
      approximate: quantity.approximate,
      canonical: String(quantity.value),
    }
  }
  if (result.type === 'range') {
    const range = rangeInUnit(result.range, opts.unit)
    return {
      quantity: range,
      value: null,
      kind: range.kind,
      approximate: range.approximate,
      canonical: defaultHiddenValue(range, opts.unit),
    }
  }
  if (result.type === 'conversion') {
    if ('base' in result.converted) {
      const unit = opts.unit ?? result.targetUnit
      const quantity = result.converted.to(unit)
      return {
        quantity,
        value: quantity.value,
        kind: quantity.kind,
        approximate: quantity.approximate,
        canonical: String(quantity.value),
      }
    }
    const range = rangeInUnit(result.converted, opts.unit ?? result.targetUnit)
    return {
      quantity: range,
      value: null,
      kind: range.kind,
      approximate: range.approximate,
      canonical: defaultHiddenValue(range, opts.unit ?? result.targetUnit),
    }
  }
  if (opts.unit || opts.kind) {
    return {
      quantity: null,
      value: result.value,
      kind: opts.kind ?? null,
      approximate: result.approximate ?? false,
      canonical: String(result.value),
    }
  }
  return { quantity: null, value: null, kind: null, approximate: false, canonical: null }
}

export function acceptedResult(result: LingoResult, opts: LingoFieldFormatOptions): LingoResult {
  if (!result.ok) {
    return result
  }
  if (result.type === 'number' && !opts.unit && !opts.kind) {
    return failResult(result.text, [localIssue(opts, 'REQUIRED', {}, result.span)])
  }
  return result
}

export function formatResultForCommit(
  result: LingoResult,
  opts: LingoFieldFormatOptions,
): string | null {
  if (!result.ok) {
    return null
  }
  const unit = opts.displayUnit ?? opts.unit
  if (opts.display === 'preserve') {
    return null
  }
  if (opts.display === 'echo') {
    if (result.type === 'quantity') {
      return result.quantity.format({ significant: 3 })
    }
    if (result.type === 'range') {
      return result.range.format({ significant: 3 })
    }
    if (result.type === 'conversion') {
      const q = result.converted
      return q.format({ significant: 3 })
    }
    return String(result.value)
  }
  if (result.type === 'quantity') {
    return formatQuantityForDisplay(result.quantity, unit)
  }
  if (result.type === 'range') {
    return formatRangeForDisplay(result.range, unit)
  }
  if (result.type === 'conversion') {
    const converted = result.converted
    const conversionUnit = opts.displayUnit ?? opts.unit ?? result.targetUnit
    return 'base' in converted
      ? formatQuantityForDisplay(converted, conversionUnit)
      : formatRangeForDisplay(converted, conversionUnit)
  }
  if (opts.unit && opts.kind) {
    const parsed = parseQuantity(String(result.value), toLingoOptions(opts))
    if (parsed.ok) {
      return formatQuantityForDisplay(parsed.quantity, unit)
    }
  }
  return String(result.value)
}

export function defaultHint(result: LingoResult, opts: LingoFieldFormatOptions): string {
  if (!result.ok) {
    return ''
  }
  if (result.type === 'quantity') {
    return `= ${formatQuantityForDisplay(result.quantity, opts.unit ?? result.quantity.unit)}`
  }
  if (result.type === 'range') {
    return `= ${formatRangeForDisplay(result.range, opts.unit)}`
  }
  if (result.type === 'conversion') {
    const converted = result.converted
    return `= ${
      'base' in converted
        ? formatQuantityForDisplay(converted, opts.displayUnit ?? result.targetUnit)
        : formatRangeForDisplay(converted, opts.displayUnit ?? result.targetUnit)
    }`
  }
  return opts.unit ? `= ${result.value} ${opts.unit}` : `= ${result.value}`
}

export function defaultCandidate(result: CandidateResult): string {
  const value =
    result.type === 'quantity'
      ? result.quantity.format()
      : result.type === 'range'
        ? result.range.format()
        : result.type === 'conversion'
          ? result.converted.format()
          : String(result.value)
  return `Did you mean ${value}?`
}
