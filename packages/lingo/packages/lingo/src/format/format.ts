import { fromBase, RATE_BASED_CONVERSION_ERROR } from '../core/convert'
import type { Registry } from '../core/registry'
import { roundDp, roundSig } from '../core/round'
import type { Kind, UnitDef } from '../core/types'

/**
 * Formatting (plan 007). The inverse of parsing: every default path emitted
 * here is covered by the parse grammar, and round-trip tests enforce it.
 * `localizedUnits: true` restores Intl localized unit words as a display-only
 * exception outside that guarantee.
 */

/**
 * Options for `Quantity.format()`/`formatQuantity()`.
 * @example
 * ```ts
 * import { quantity } from '@pascal-app/lingo'
 * quantity(1.8034, 'm').format({ compound: ['ft', 'in'] }) // "5′11″"
 * quantity(0.5, 'kg').format({ locale: 'de-DE' })           // "0,5 kg"
 * ```
 */
export interface FormatOptions {
  /**
   * Compound output (5′11″). `true` walks the unit's subunit chain one step;
   * an array pins the exact chain (['h','min','s']). Defaults to true when
   * the quantity was parsed from a compound expression.
   */
  compound?: boolean | string[]
  /** How the exponent renders: 'e' (3e5) | 'times' (3×10^5) | 'superscript' (3×10⁵). Default 'e'. */
  exponentStyle?: 'e' | 'times' | 'superscript'
  /** Thousands grouping — off by default (grouped output is parse-hostile in comma-decimal locales). */
  grouping?: boolean
  /** BCP-47 locale for number rendering. */
  locale?: string
  /**
   * Opt in to `Intl` localized unit words in long/narrow style ("1 mètre").
   * Display-only: localized unit words are NOT covered by the two-way guarantee
   * (the English-first parser can't re-read them). Default false → parseable
   * English unit names even under a non-English `locale` (the number still
   * localizes).
   */
  localizedUnits?: boolean
  /** Number notation. 'engineering' pins exponents to multiples of 3. Default 'standard'. */
  notation?: 'standard' | 'scientific' | 'engineering'
  /** Max (and, when set, exact) fraction digits. */
  precision?: number
  /** Max significant digits when `precision` is absent. Default 4. */
  significant?: number
  /** 'symbol' (5 kg) | 'long' (5 kilograms) | 'narrow' (5kg). */
  style?: 'symbol' | 'long' | 'narrow'
  /** Target unit id; defaults to the quantity's own unit. */
  unit?: string
}

/**
 * Options for `QuantityRange.format()`/`formatRange()`.
 * @example
 * ```ts
 * import { parseRange } from '@pascal-app/lingo'
 * const r = parseRange('5-10 kg')
 * r.ok && r.range.format({ rangeStyle: 'long' }) // "5 to 10 kg"
 * ```
 */
export interface RangeFormatOptions extends FormatOptions {
  /** 'symbol': "5–10 kg", "≥ 5 kg" · 'long': "5 to 10 kg", "at least 5 kg". */
  rangeStyle?: 'symbol' | 'long'
}

/** Structural shape shared with core/quantity.ts (avoids an import cycle). */
export interface QuantityLike {
  approximate?: boolean
  base: number
  kind: Kind
  parts?: readonly { unit: string; value: number }[]
  unit: string
}

export interface RangeLike {
  exclusiveMax: boolean
  exclusiveMin: boolean
  kind: Kind
  maxBase: number | null
  maxUnit: string | null
  minBase: number | null
  minUnit: string | null
  plusMinus?: { centerBase: number; deltaBase: number; unit: string }
}

// --- Intl.NumberFormat cache (keyed on serialized locale + options) ---
const NFCache = new Map<string, Intl.NumberFormat>()

function cachedNF(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = [
    locale,
    options.style,
    options.currency,
    options.currencyDisplay,
    options.unit,
    options.unitDisplay,
    options.useGrouping,
    options.maximumFractionDigits,
    options.minimumFractionDigits,
  ].join()
  let nf = NFCache.get(key)
  if (nf) {
    return nf
  }
  if (NFCache.size > 15) {
    // Evict oldest (first inserted)
    NFCache.delete(NFCache.keys().next().value!)
  }
  nf = new Intl.NumberFormat(locale, options)
  NFCache.set(key, nf)
  return nf
}

/** Units whose symbol hugs the number: 5°C, 11″, 15%. */
function tightSymbol(symbol: string): boolean {
  return (
    symbol.startsWith('°') || symbol === '′' || symbol === '″' || symbol === '%' || symbol === '‰'
  )
}

function tightUnit(unit: UnitDef, style: FormatOptions['style']): boolean {
  return (
    style !== 'long' &&
    (style === 'narrow' || tightSymbol(unit.symbol)) &&
    !' K M ft2 ft3 kΩ '.includes(` ${unit.id} `)
  )
}

function renderNumber(value: number, opts: FormatOptions): string {
  const notation = opts.notation ?? 'standard'
  const rounded =
    opts.precision === undefined
      ? roundSig(value, opts.significant ?? 4)
      : roundDp(value, opts.precision)
  if (notation !== 'standard' && Number.isFinite(value) && value !== 0) {
    const step = notation === 'scientific' ? 1 : 3
    let exponent =
      notation === 'scientific'
        ? Math.floor(Math.log10(Math.abs(value)))
        : Math.floor(Math.floor(Math.log10(Math.abs(value))) / 3) * 3
    let coefficient = value / 10 ** exponent
    coefficient =
      opts.precision === undefined
        ? roundSig(coefficient, opts.significant ?? 4)
        : roundDp(coefficient, opts.precision)
    if (Math.abs(coefficient) >= 10 ** step) {
      exponent += step
      coefficient =
        opts.precision === undefined
          ? roundSig(coefficient / 10 ** step, opts.significant ?? 4)
          : roundDp(coefficient / 10 ** step, opts.precision)
    }
    const coefficientText =
      opts.precision === undefined ? String(coefficient) : coefficient.toFixed(opts.precision)
    if (opts.exponentStyle === 'times') {
      return `${coefficientText}×10^${exponent}`
    }
    if (opts.exponentStyle === 'superscript') {
      const superscript = `${exponent < 0 ? '⁻' : ''}${String(Math.abs(exponent)).replace(/\d/g, (digit) => SUPERSCRIPT_DIGITS[Number(digit)]!)}`
      return `${coefficientText}×10${superscript}`
    }
    return `${coefficientText}e${exponent}`
  }
  if (opts.locale) {
    return cachedNF(opts.locale, {
      useGrouping: opts.grouping ?? false,
      maximumFractionDigits: opts.precision ?? 20,
      minimumFractionDigits: opts.precision,
    }).format(rounded)
  }
  return opts.precision === undefined ? String(rounded) : rounded.toFixed(opts.precision)
}

const SUPERSCRIPT_DIGITS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'] as const

function unitText(unit: UnitDef, value: number, opts: FormatOptions): string {
  const style = opts.style ?? 'symbol'
  if (style === 'long') {
    const plural = unit.plural ?? `${unit.name}s`
    return Math.abs(value) === 1 ? unit.name : plural
  }
  return unit.symbol
}

/** Whole-string Intl path for non-English long/narrow styles. */
function intlWhole(unit: UnitDef, value: number, opts: FormatOptions): string | null {
  if (opts.localizedUnits !== true) {
    return null
  }
  const style = opts.style ?? 'symbol'
  if (!opts.locale || style === 'symbol' || !unit.intl) {
    return null
  }
  if (opts.locale.toLowerCase().startsWith('en')) {
    return null
  }
  return cachedNF(opts.locale, {
    style: 'unit',
    unit: unit.intl,
    unitDisplay: style === 'long' ? 'long' : 'narrow',
    useGrouping: opts.grouping ?? false,
    maximumFractionDigits: opts.precision ?? 20,
    minimumFractionDigits: opts.precision,
  })
    .format(value)
    .replace(/\u00a0/g, ' ')
}

function formatCurrency(unit: UnitDef, value: number, opts: FormatOptions): string {
  const locale = opts.locale ?? 'en-US'
  const symbolDisplay = opts.locale === undefined || locale.toLowerCase() === 'en-us'
  const currencyDisplay: Intl.NumberFormatOptions['currencyDisplay'] = symbolDisplay
    ? 'symbol'
    : 'code'
  const formatOptions: Intl.NumberFormatOptions = {
    style: 'currency',
    currency: unit.id,
    currencyDisplay,
    useGrouping: opts.grouping ?? false,
    maximumFractionDigits: opts.precision ?? 20,
  }
  if (opts.precision !== undefined) {
    formatOptions.minimumFractionDigits = opts.precision
  }
  return cachedNF(locale, formatOptions)
    .format(value)
    .replace(/[\u00a0\u202f]/g, ' ')
}

/**
 * Format a quantity-shaped value (base + unit) against a registry. Powers
 * `Quantity.format()`; use that method instead unless you're formatting a
 * plain object without a live `Quantity` (e.g. `lingo/core` internals).
 * @example
 * ```ts
 * import { defaultRegistry } from '@pascal-app/lingo'
 * import { formatQuantity } from '@pascal-app/lingo/core'
 * formatQuantity(defaultRegistry, { kind: 'length', base: 1500, unit: 'm' }) // "1500 m"
 * ```
 */
export function formatQuantity(reg: Registry, q: QuantityLike, opts: FormatOptions = {}): string {
  const unitId = opts.unit ?? q.unit
  const unit = requireUnit(reg, q.kind, unitId)
  if (reg.kind(q.kind)?.rateBased) {
    if (unit.id !== q.unit) {
      throw new Error(RATE_BASED_CONVERSION_ERROR)
    }
    return formatCurrency(unit, fromBase(unit, q.base), opts)
  }
  const compound = opts.compound ?? (q.parts !== undefined && opts.unit === undefined)
  if (compound) {
    // Parts that follow the subunit chain (5 ft 11 in) render via the carry
    // formatter; mixed additive parts (20 in + 10 cm) render verbatim.
    if (compound === true && q.parts && q.parts.length > 1) {
      if (partsConform(reg, q.kind, q.parts)) {
        const chain = q.parts.map((part) => requireUnit(reg, q.kind, part.unit))
        return formatCompound(reg, q, chain, opts)
      }
      return formatMixedParts(reg, q, opts)
    }
    const chain = resolveChain(reg, q.kind, unit, compound)
    if (chain.length > 1) {
      return formatCompound(reg, q, chain, opts)
    }
  }
  const value = fromBase(unit, q.base)
  const whole = intlWhole(unit, value, opts)
  if (whole !== null) {
    return whole
  }
  const num = renderNumber(value, opts)
  const label = unitText(unit, roundForPlural(value, opts), opts)
  const style = opts.style ?? 'symbol'
  return tightUnit(unit, style) ? `${num}${label}` : `${num} ${label}`
}

function roundForPlural(value: number, opts: FormatOptions): number {
  return opts.precision === undefined
    ? roundSig(value, opts.significant ?? 4)
    : roundDp(value, opts.precision)
}

function requireUnit(reg: Registry, kind: Kind, unitId: string): UnitDef {
  const unit = reg.unitByRef(kind, unitId)
  if (!unit) {
    throw new Error(`lingo: unknown unit "${unitId}" for kind "${kind}"`)
  }
  return unit
}

function resolveChain(
  reg: Registry,
  kind: Kind,
  head: UnitDef,
  compound: true | string[],
): UnitDef[] {
  if (Array.isArray(compound)) {
    const chain = compound.map((id) => requireUnit(reg, kind, id))
    for (let i = 1; i < chain.length; i++) {
      if (chain[i]!.factor >= chain[i - 1]!.factor) {
        throw new Error('lingo: compound chain must go big → small')
      }
    }
    return chain
  }
  const sub = head.subunit ? reg.unit(kind, head.subunit.unit) : undefined
  return sub ? [head, sub] : [head]
}

/**
 * Format across an explicit unit chain (big → small) with carry — the engine
 * behind `format({ compound: true | [...] })`. Decomposes big → small, rounds
 * ONLY the smallest part, then carries overflow upward (1.9999 m → 6′7″,
 * never 5′12″; 5.999 lb → 6 lb, never 5 lb 16 oz); zero tail parts collapse
 * ("6 lb 0 oz" → "6 lb"). Most callers should pass `compound` to
 * `Quantity.format()`/`formatQuantity()` instead of calling this directly.
 * @example
 * ```ts
 * import { defaultRegistry } from '@pascal-app/lingo'
 * import { formatCompound } from '@pascal-app/lingo/core'
 * const ft = defaultRegistry.unit('length', 'ft')!
 * const inch = defaultRegistry.unit('length', 'in')!
 * formatCompound(defaultRegistry, { kind: 'length', base: 1.8034, unit: 'ft' }, [ft, inch]) // "5′11″"
 * ```
 */
export function formatCompound(
  reg: Registry,
  q: QuantityLike,
  chain: UnitDef[],
  opts: FormatOptions = {},
): string {
  const style = opts.style ?? 'symbol'
  const negative = q.base < 0
  let rest = Math.abs(q.base)
  const values: number[] = []
  for (let i = 0; i < chain.length; i++) {
    const unit = chain[i]!
    const value = fromBase(unit, rest)
    if (i === chain.length - 1) {
      values.push(roundDp(value, opts.precision ?? 0))
    } else {
      const whole = Math.floor(value)
      values.push(whole)
      rest = rest - whole * unit.factor
      if (rest < 0) {
        rest = 0
      }
    }
  }
  // Carry: rounded smallest may have reached the size of the unit above.
  for (let i = chain.length - 1; i > 0; i--) {
    const per = chain[i - 1]!.factor / chain[i]!.factor
    if (values[i]! >= per - 1e-9) {
      values[i] = 0
      values[i - 1] = values[i - 1]! + 1
    }
  }
  // Collapse zero tails; keep zero heads only if everything is zero.
  let lastNonZero = 0
  for (let i = 0; i < values.length; i++) {
    if (values[i] !== 0) {
      lastNonZero = i
    }
  }
  const shown = values.slice(0, lastNonZero + 1)

  const primes = style !== 'long' && chain[0]!.id === 'ft' && chain[1]?.id === 'in'
  const pieces: string[] = []
  for (let i = 0; i < shown.length; i++) {
    const unit = chain[i]!
    const value = shown[i]!
    if (value === 0 && i > 0 && i < shown.length - 1) {
      continue // zero middles skipped
    }
    if (primes) {
      pieces.push(`${value}${i === 0 ? '′' : '″'}`)
    } else {
      const label = unitText(unit, value, opts)
      pieces.push(tightUnit(unit, style) ? `${value}${label}` : `${value} ${label}`)
    }
  }
  const body = primes ? pieces.join('') : pieces.join(' ')
  return negative ? `-${body}` : body
}

/** Do the parts walk the subunit chain (ft→in, h→min→s)? */
function partsConform(
  reg: Registry,
  kind: Kind,
  parts: readonly { unit: string; value: number }[],
): boolean {
  for (let i = 1; i < parts.length; i++) {
    const prev = reg.unit(kind, parts[i - 1]!.unit)
    if (!prev?.subunit || prev.subunit.unit !== parts[i]!.unit) {
      return false
    }
    if (parts[i]!.value < 0) {
      return false
    }
  }
  return parts.every((part) => part.value >= 0)
}

/**
 * Faithful rendering of additive mixed-unit parts: "20 in + 10 cm",
 * long style "20 inches and 10 centimeters", negatives via the word "minus"
 * (a "-" would re-parse as a range). Everything emitted re-parses to the
 * same base value.
 */
function formatMixedParts(reg: Registry, q: QuantityLike, opts: FormatOptions): string {
  const style = opts.style ?? 'symbol'
  const numOpts = { ...opts, significant: opts.significant ?? 6 }
  let out = ''
  for (let i = 0; i < q.parts!.length; i++) {
    const part = q.parts![i]!
    const unit = requireUnit(reg, q.kind, part.unit)
    const value = Math.abs(part.value)
    const num = renderNumber(i === 0 ? part.value : value, numOpts)
    const label = unitText(unit, value, opts)
    const piece = tightUnit(unit, style) ? `${num}${label}` : `${num} ${label}`
    if (i === 0) {
      out = piece
    } else if (part.value < 0) {
      out += ` minus ${piece}`
    } else {
      out += style === 'long' ? ` and ${piece}` : ` + ${piece}`
    }
  }
  return out
}

/**
 * Format a range-shaped value (bounds/plus-minus + unit) against a registry.
 * Powers `QuantityRange.format()`; use that method instead unless you're
 * formatting a plain object without a live `QuantityRange`.
 * @example
 * ```ts
 * import { defaultRegistry } from '@pascal-app/lingo'
 * import { formatRange } from '@pascal-app/lingo/core'
 * formatRange(defaultRegistry, {
 *   kind: 'mass', minBase: 5, maxBase: 10, minUnit: 'kg', maxUnit: 'kg',
 *   exclusiveMin: false, exclusiveMax: false,
 * }) // "5–10 kg"
 * ```
 */
export function formatRange(reg: Registry, r: RangeLike, opts: RangeFormatOptions = {}): string {
  const rangeStyle = opts.rangeStyle ?? 'symbol'
  const kind = r.kind
  const sub = (base: number, unitId: string): string =>
    formatQuantity(reg, { kind, base, unit: unitId }, { ...opts, compound: opts.compound ?? false })
  const bare = (base: number, unitId: string): string =>
    renderNumber(fromBase(requireUnit(reg, kind, unitId), base), opts)

  if (r.plusMinus) {
    const { centerBase, deltaBase, unit } = r.plusMinus
    const u = requireUnit(reg, kind, unit)
    const delta = deltaBase / u.factor // delta semantics: factor only
    const num = renderNumber(delta, opts)
    const tail = tightSymbol(u.symbol) ? `${num}${u.symbol}` : `${num} ${u.symbol}`
    return `${bare(centerBase, unit)} ± ${tail}`
  }
  const hasMin = r.minBase !== null
  const hasMax = r.maxBase !== null
  if (hasMin && hasMax) {
    if (r.minUnit === r.maxUnit) {
      const left = bare(r.minBase!, r.minUnit!)
      const right = sub(r.maxBase!, r.maxUnit!)
      return rangeStyle === 'long' ? `${left} to ${right}` : `${left}–${right}`
    }
    const left = sub(r.minBase!, r.minUnit!)
    const right = sub(r.maxBase!, r.maxUnit!)
    return rangeStyle === 'long' ? `${left} to ${right}` : `${left} – ${right}`
  }
  if (hasMin) {
    const body = sub(r.minBase!, r.minUnit!)
    if (rangeStyle === 'long') {
      return r.exclusiveMin ? `over ${body}` : `at least ${body}`
    }
    return r.exclusiveMin ? `> ${body}` : `≥ ${body}`
  }
  if (hasMax) {
    const body = sub(r.maxBase!, r.maxUnit!)
    if (rangeStyle === 'long') {
      return r.exclusiveMax ? `under ${body}` : `at most ${body}`
    }
    return r.exclusiveMax ? `< ${body}` : `≤ ${body}`
  }
  return ''
}
