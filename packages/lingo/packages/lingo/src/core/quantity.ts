import { pickBestUnit, type ToBestOptions } from '../format/best'
import {
  type FormatOptions,
  formatQuantity,
  formatRange,
  type RangeFormatOptions,
} from '../format/format'
import {
  convertDeltaValue,
  convertValue,
  fromBase,
  RATE_BASED_CONVERSION_ERROR,
  toBase,
} from './convert'
import type { Registry } from './registry'
import { approxEqual, roundDp } from './round'
import type { Kind, UnitDef } from './types'
import type { BuiltinKind, UnitRefByKind } from './unit-refs'

/** Registry attachment kept out of enumerable state (clean console/JSON). */
const REG = new WeakMap<Quantity | QuantityRange, Registry>()

type UnitRefForKind<K extends Kind, Unit extends string> = string extends Unit
  ? Unit
  : [K] extends [BuiltinKind]
    ? Unit extends UnitRefByKind<K>
      ? Unit
      : UnitRefByKind<K>
    : Unit

function assertFinite(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`lingo: ${field} must be a finite number`)
  }
}

function assertSchemaVersion(schemaVersion: number): void {
  if (schemaVersion !== 3) {
    throw new Error(`lingo: unsupported schemaVersion ${String(schemaVersion)}`)
  }
}

function assertBaseUnit(reg: Registry, kind: Kind, baseUnit: string, unitId?: string): void {
  const kindDef = reg.kind(kind)
  if (!kindDef) {
    throw new Error(`lingo: unknown kind "${kind}"`)
  }
  const expected = kindDef.rateBased && unitId ? reg.unitByRef(kind, unitId)?.id : kindDef.baseUnit
  if (!expected || baseUnit !== expected) {
    throw new Error(`lingo: baseUnit "${String(baseUnit)}" is not the base unit of kind "${kind}"`)
  }
}

function assertRateBasedTarget(
  reg: Registry,
  kind: Kind,
  fromUnitId: string,
  toUnitId: string,
): void {
  if (fromUnitId !== toUnitId && reg.kind(kind)?.rateBased) {
    throw new Error(RATE_BASED_CONVERSION_ERROR)
  }
}

function requireRangeUnit(reg: Registry, kind: Kind, unitId: string): UnitDef {
  const unit = reg.unitByRef(kind, unitId)
  if (!unit) {
    throw new Error(`lingo: unknown unit "${unitId}" for kind "${kind}"`)
  }
  return unit
}

function minorScale(unit: UnitDef): number {
  return 10 ** (unit.minorUnit ?? 2)
}

function rangeValueJSON(
  reg: Registry,
  kind: Kind,
  base: number,
  unitId: string,
): { value: number; unit: string; base: number } {
  const unit = requireRangeUnit(reg, kind, unitId)
  return { value: fromBase(unit, base), unit: unit.id, base }
}

function rangeDeltaJSON(
  reg: Registry,
  kind: Kind,
  base: number,
  unitId: string,
  baseUnitId: string,
): { value: number; unit: string; base: number } {
  const unit = requireRangeUnit(reg, kind, unitId)
  return { value: convertDeltaValue(reg, kind, base, baseUnitId, unit.id), unit: unit.id, base }
}

function rateBasedRangeUnit(
  reg: Registry,
  kind: Kind,
  units: readonly (string | null | undefined)[],
): string | null {
  if (!reg.kind(kind)?.rateBased) {
    return null
  }
  let only: string | null = null
  for (const unitId of units) {
    if (!unitId) {
      continue
    }
    const unit = requireRangeUnit(reg, kind, unitId)
    if (only && only !== unit.id) {
      throw new Error('lingo: currency ranges need one currency; convert with rates first')
    }
    only = unit.id
  }
  return only
}

function rangeBaseUnit(reg: Registry, range: QuantityRange): UnitDef {
  const unitId = rateBasedRangeUnit(reg, range.kind, [
    range.minUnit,
    range.maxUnit,
    range.plusMinus?.unit,
  ])
  return unitId ? requireRangeUnit(reg, range.kind, unitId) : reg.baseUnit(range.kind)
}

function assertRangeJSONBaseUnit(reg: Registry, json: QuantityRangeJSON): void {
  const unitId = rateBasedRangeUnit(reg, json.kind, [
    json.min?.unit,
    json.max?.unit,
    json.plusMinus?.center.unit,
    json.plusMinus?.delta.unit,
  ])
  if (!unitId) {
    assertBaseUnit(reg, json.kind, json.baseUnit)
    return
  }
  if (unitId !== json.baseUnit) {
    throw new Error(`lingo: baseUnit "${json.baseUnit}" must match every currency range unit`)
  }
}

/**
 * The `Registry` a `Quantity`/`QuantityRange` was created against — needed
 * by anyone implementing kind-aware logic over a value without threading a
 * registry parameter through by hand (formatting/conversion internals use
 * this; most application code never needs it since values from the same
 * `createLingo()` instance/registry compose freely).
 * @example
 * ```ts
 * import { quantity, defaultRegistry } from '@pascal-app/lingo'
 * import { registryOf } from '@pascal-app/lingo/core'
 * registryOf(quantity(5, 'kg')) === defaultRegistry // true
 * ```
 */
export function registryOf(x: Quantity | QuantityRange): Registry {
  return REG.get(x)!
}

/** One leg of a compound/mixed expression ("5 ft 11 in" → `[{unit:'ft',value:5},{unit:'in',value:11}]`). */
export interface QuantityPart {
  unit: string
  value: number
}

/**
 * `Quantity.toJSON()`'s shape — round-trips through `JSON.stringify` and
 * back via `Quantity.fromJSON`/the main entry's `fromJSON`.
 * @example
 * ```ts
 * import { quantity, fromJSON } from '@pascal-app/lingo'
 * const json = JSON.parse(JSON.stringify(quantity(5, 'kg')))
 * fromJSON(json).value // 5
 * ```
 */
export interface QuantityJSON {
  /** `true` when the value is a fuzzy/approximate reading ("about 5 kg"). */
  approximate?: boolean
  /**
   * The canonical amount in `baseUnit` — the kind's SI-anchored base unit. This
   * pair (`base` + `baseUnit`) is the source of truth: `fromJSON()` trusts it
   * and recomputes `value`, so a stale `value` never corrupts a round-trip.
   * e.g. `72 in` serializes with `base: 1.8288, baseUnit: 'm'`.
   */
  base: number
  /** The unit `base` is expressed in — the kind's canonical base unit (`kg`, `m`, `s`, …). */
  baseUnit: string
  /** Measurement kind, e.g. `'length'`, `'mass'`, `'currency'`. */
  kind: Kind
  /** Faithful compound breakdown ("5 ft 11 in") when the input was compound. */
  parts?: QuantityPart[]
  /** Wire-schema version; bump signals a shape change. See `fromJSON()`. */
  schemaVersion: 3
  type: 'quantity'
  /** The unit the value was expressed or requested in (`'in'`, `'kg'`, `'USD'`). */
  unit: string
  /** The human-facing amount in `unit` (the `72` in `72 in`). Derived from `base`. */
  value: number
}

/**
 * A single measured value, canonically stored as `base` (the kind's SI-anchored
 * base unit) plus the `unit` it was expressed/requested in. Returned by
 * `parse*()`, `quantity()`, and `Quantity.to()`/`fromJSON()` — not normally
 * constructed directly.
 * @example
 * ```ts
 * import { parseQuantity } from '@pascal-app/lingo'
 * const r = parseQuantity(`5'11"`)
 * r.ok && r.quantity.to('m').value // 1.8034
 * ```
 */
export class Quantity<K extends Kind = Kind> {
  readonly kind: K
  readonly base: number
  readonly unit: string
  readonly approximate: boolean
  /** Faithful compound expression ("5 ft 11 in") for re-formatting. */
  readonly parts?: readonly QuantityPart[]

  constructor(
    reg: Registry,
    kind: K,
    base: number,
    unitId: string,
    extras?: { approximate?: boolean; parts?: readonly QuantityPart[] },
  ) {
    const unit = reg.unitByRef(kind, unitId)
    if (!unit) {
      throw new Error(`lingo: unknown unit "${unitId}" for kind "${kind}"`)
    }
    assertFinite(base, 'base')
    this.kind = kind
    this.base = base
    this.unit = unit.id // canonicalized: .to('L').unit === 'l'
    this.approximate = extras?.approximate ?? false
    if (extras?.parts) {
      this.parts = extras.parts
    }
    REG.set(this, reg)
  }

  /**
   * Numeric value expressed in `this.unit`.
   * @example
   * ```ts
   * import { quantity } from '@pascal-app/lingo'
   * quantity(72, 'in').value // 72
   * ```
   */
  get value(): number {
    return fromBase(this.unitInfo(), this.base)
  }

  /** The full `UnitDef` for `this.unit` (symbol, factor, aliases, …). */
  unitInfo(): UnitDef {
    return registryOf(this).unit(this.kind, this.unit)!
  }

  /**
   * Convert to another unit of the same kind (absolute semantics) — the
   * conversion path for an already-typed `Quantity`, as opposed to the
   * `unit` parse option (which only fills in a unit for bare numbers).
   * @example
   * ```ts
   * import { quantity } from '@pascal-app/lingo'
   * quantity(72, 'in').to('cm').value // 182.88
   * ```
   */
  to<const Unit extends string>(unitId: Unit & UnitRefForKind<K, Unit>): Quantity<K> {
    const reg = registryOf(this)
    const unit = reg.unitByRef(this.kind, unitId)
    if (!unit) {
      throw new Error(`lingo: unknown unit "${unitId}" for kind "${this.kind}"`)
    }
    if (unit.id === this.unit) {
      return this
    }
    assertRateBasedTarget(reg, this.kind, this.unit, unit.id)
    // Constructor validates the target; convert via base directly.
    return new Quantity(reg, this.kind, this.base, unit.id, {
      approximate: this.approximate,
    })
  }

  /**
   * Convert as a *difference* (factors only, offsets ignored): a 5 °C
   * temperature increase is a 9 °F increase.
   * @example
   * ```ts
   * import { quantity } from '@pascal-app/lingo'
   * quantity(5, 'C').convertDelta('F') // 9 (a rise, not an absolute temperature)
   * ```
   */
  convertDelta(unitId: string): number {
    return convertDeltaValue(registryOf(this), this.kind, this.value, this.unit, unitId)
  }

  /**
   * Numeric value expressed in any unit of the kind, without changing
   * `this.unit` (unlike `to()`, which returns a re-expressed `Quantity`).
   * @example
   * ```ts
   * import { quantity } from '@pascal-app/lingo'
   * quantity(72, 'in').valueIn('cm') // 182.88
   * ```
   */
  valueIn(unitId: string): number {
    return convertValue(registryOf(this), this.kind, this.value, this.unit, unitId)
  }

  /**
   * Durations only: base seconds → milliseconds (JS interop, e.g.
   * `setTimeout`).
   * @example
   * ```ts
   * import { parseDuration } from '@pascal-app/lingo/date'
   * const r = parseDuration('90 min')
   * r.ok && r.duration.toMilliseconds() // 5400000
   * ```
   */
  toMilliseconds(): number {
    if (this.kind !== 'duration') {
      throw new Error(`lingo: toMilliseconds() is for durations, not ${this.kind}`)
    }
    return this.base * 1000
  }

  /**
   * Currency only: convert to integer minor units for Stripe-style APIs.
   * @example
   * ```ts
   * import { quantity } from '@pascal-app/lingo'
   * quantity(5, 'USD').toMinor() // 500
   * quantity(1000, 'JPY').toMinor() // 1000
   * ```
   */
  toMinor(): number {
    if (this.kind !== 'currency') {
      throw new Error(`lingo: toMinor() is for currencies, not ${this.kind}`)
    }
    return roundDp(this.value * minorScale(this.unitInfo()), 0)
  }

  /**
   * Human formatting (plan 007) — the inverse of parsing; everything this
   * emits re-parses to the same value.
   * @example
   * ```ts
   * import { quantity } from '@pascal-app/lingo'
   * quantity(1.8034, 'm').format({ compound: ['ft', 'in'] }) // "5′11″"
   * quantity(2, 'ft').format({ style: 'long' })               // "2 feet"
   * ```
   */
  format(opts?: FormatOptions): string {
    return formatQuantity(registryOf(this), this, opts)
  }

  /**
   * Re-express in the best-fitting display unit (1500 m → 1.5 km). Only
   * units that declare `best` in their `UnitDef` participate; returns `this`
   * unchanged when nothing beats the current unit (e.g. temperature never
   * auto-switches).
   * @example
   * ```ts
   * import { quantity } from '@pascal-app/lingo'
   * quantity(1500, 'm').toBest().format() // "1.5 km"
   * ```
   */
  toBest(opts?: ToBestOptions): Quantity<K> {
    const best = pickBestUnit(registryOf(this), this.kind, this.base, this.unitInfo(), opts)
    return best ? this.to(best.id) : this
  }

  /**
   * Same kind and (relatively) equal base value.
   * @example
   * ```ts
   * import { quantity } from '@pascal-app/lingo'
   * quantity(1, 'm').equals(quantity(100, 'cm')) // true
   * ```
   */
  equals(other: Quantity, rel = 1e-9): boolean {
    return this.kind === other.kind && approxEqual(this.base, other.base, rel)
  }

  /**
   * Serialize to a plain, JSON-safe object. Rehydrate with `fromJSON` (main
   * entry) or `Quantity.fromJSON` (needs a registry — for `lingo/core`
   * users).
   * @example
   * ```ts
   * import { quantity, fromJSON } from '@pascal-app/lingo'
   * const json = quantity(5, 'kg').toJSON()
   * // { schemaVersion: 3, type: 'quantity', kind: 'mass', value: 5, unit: 'kg', base: 5, baseUnit: 'kg' }
   * fromJSON(json).value // 5
   * ```
   */
  toJSON(): QuantityJSON {
    const reg = registryOf(this)
    const json: QuantityJSON = {
      schemaVersion: 3,
      type: 'quantity',
      kind: this.kind,
      value: this.value,
      unit: this.unit,
      base: this.base,
      baseUnit: reg.kind(this.kind)?.rateBased ? this.unit : reg.baseUnit(this.kind).id,
    }
    if (this.approximate) {
      json.approximate = true
    }
    if (this.parts) {
      json.parts = [...this.parts]
    }
    return json
  }

  /**
   * Rehydrate a `Quantity` from `toJSON()` output. Prefer the main entry's
   * `fromJSON()` unless you're on `lingo/core` and managing your own registry.
   * @example
   * ```ts
   * import { Quantity, defaultRegistry } from '@pascal-app/lingo'
   * Quantity.fromJSON(defaultRegistry, {
   *   schemaVersion: 3, type: 'quantity', kind: 'mass',
   *   value: 5, unit: 'kg', base: 5, baseUnit: 'kg',
   * }).value // 5
   * ```
   */
  static fromJSON(reg: Registry, json: QuantityJSON): Quantity {
    assertSchemaVersion(json.schemaVersion)
    assertBaseUnit(reg, json.kind, json.baseUnit, json.unit)
    assertFinite(json.base, 'base')
    assertFinite(json.value, 'value')
    return new Quantity(reg, json.kind, json.base, json.unit, {
      approximate: json.approximate,
      parts: json.parts,
    })
  }
}

/** Internal constructor bound shape (base value + unit); not part of the public API. */
export interface RangeBound {
  base: number
  unit: string
}

/**
 * `QuantityRange.toJSON()`'s shape — round-trips through `JSON.stringify`
 * and back via `QuantityRange.fromJSON`/the main entry's `fromJSON`.
 * @example
 * ```ts
 * import { lingo, fromJSON } from '@pascal-app/lingo'
 * const r = lingo('5-10 kg')
 * const json = JSON.parse(JSON.stringify(r.ok && r.type === 'range' ? r.range : null))
 * fromJSON(json).min()?.value // 5
 * ```
 */
export interface QuantityRangeJSON {
  approximate?: boolean
  baseUnit: string
  fuzzy?: { term: string; profile: string }
  kind: Kind
  max?: { value: number; unit: string; base: number; exclusive?: boolean }
  min?: { value: number; unit: string; base: number; exclusive?: boolean }
  plusMinus?: {
    center: { value: number; unit: string; base: number }
    delta: { value: number; unit: string; base: number }
  }
  schemaVersion: 3
  type: 'range'
}

/**
 * A bounded (min/max), plus-or-minus, or fuzzy range of values. Returned by
 * `parseRange()`/`lingo()` for inputs like "5–10 kg", "10 ± 0.5 mm", or "a
 * few minutes" — not normally constructed directly.
 * @example
 * ```ts
 * import { parseRange } from '@pascal-app/lingo'
 * const r = parseRange('between 5 and 10 kg')
 * r.ok && [r.range.min()?.value, r.range.max()?.value] // [5, 10]
 * ```
 */
export class QuantityRange<K extends Kind = Kind> {
  readonly kind: K
  readonly minBase: number | null
  readonly maxBase: number | null
  readonly minUnit: string | null
  readonly maxUnit: string | null
  readonly exclusiveMin: boolean
  readonly exclusiveMax: boolean
  /** Present when parsed from "10 ± 0.5 mm" (delta in base-factor units). */
  readonly plusMinus?: { centerBase: number; deltaBase: number; unit: string }
  readonly approximate: boolean
  /** Present when produced from fuzzy vocabulary ("hot"). */
  readonly fuzzy?: { term: string; profile: string }

  constructor(
    reg: Registry,
    kind: K,
    bounds: {
      min?: RangeBound
      max?: RangeBound
      exclusiveMin?: boolean
      exclusiveMax?: boolean
      plusMinus?: { centerBase: number; deltaBase: number; unit: string }
      approximate?: boolean
      fuzzy?: { term: string; profile: string }
    },
  ) {
    assertFinite(bounds.min?.base ?? 0, 'min.base')
    assertFinite(bounds.max?.base ?? 0, 'max.base')
    assertFinite(bounds.plusMinus?.centerBase ?? 0, 'plusMinus.centerBase')
    assertFinite(bounds.plusMinus?.deltaBase ?? 0, 'plusMinus.deltaBase')
    rateBasedRangeUnit(reg, kind, [bounds.min?.unit, bounds.max?.unit, bounds.plusMinus?.unit])
    this.kind = kind
    this.minBase = bounds.min?.base ?? null
    this.minUnit = bounds.min?.unit ?? null
    this.maxBase = bounds.max?.base ?? null
    this.maxUnit = bounds.max?.unit ?? null
    this.exclusiveMin = bounds.exclusiveMin ?? false
    this.exclusiveMax = bounds.exclusiveMax ?? false
    if (bounds.plusMinus) {
      this.plusMinus = bounds.plusMinus
    }
    this.approximate = bounds.approximate ?? false
    if (bounds.fuzzy) {
      this.fuzzy = bounds.fuzzy
    }
    REG.set(this, reg)
  }

  /**
   * The lower bound, or `null` for an open-ended range ("at least 5 kg").
   * @example
   * ```ts
   * import { parseRange } from '@pascal-app/lingo'
   * const r = parseRange('5-10 kg')
   * r.ok && r.range.min()?.value // 5
   * ```
   */
  min(): Quantity<K> | null {
    return this.minBase === null
      ? null
      : new Quantity(registryOf(this), this.kind, this.minBase, this.minUnit!)
  }

  /** The upper bound, or `null` for an open-ended range ("at most 10 kg"). */
  max(): Quantity<K> | null {
    return this.maxBase === null
      ? null
      : new Quantity(registryOf(this), this.kind, this.maxBase, this.maxUnit!)
  }

  /**
   * Midpoint of the range (or the `±` center, when present).
   * @example
   * ```ts
   * import { parseRange } from '@pascal-app/lingo'
   * const r = parseRange('5-10 kg')
   * r.ok && r.range.center()?.value // 7.5
   * ```
   */
  center(): Quantity<K> | null {
    if (this.plusMinus) {
      return new Quantity(
        registryOf(this),
        this.kind,
        this.plusMinus.centerBase,
        this.plusMinus.unit,
      )
    }
    if (this.minBase !== null && this.maxBase !== null) {
      return new Quantity(
        registryOf(this),
        this.kind,
        (this.minBase + this.maxBase) / 2,
        this.minUnit ?? this.maxUnit!,
      )
    }
    return null
  }

  /**
   * Range width expressed in `unitId` — always delta semantics (°C-safe).
   * @example
   * ```ts
   * import { parseRange } from '@pascal-app/lingo'
   * const r = parseRange('5-10 kg')
   * r.ok && r.range.widthIn('kg') // 5
   * ```
   */
  widthIn(unitId: string): number | null {
    if (this.minBase === null || this.maxBase === null) {
      return null
    }
    const reg = registryOf(this)
    const kindBase = reg.baseUnit(this.kind)
    return convertDeltaValue(reg, this.kind, this.maxBase - this.minBase, kindBase.id, unitId)
  }

  /**
   * Is a value (as a `Quantity`, or a raw number + unit) within the range?
   * Bounds are inclusive unless the range was parsed as exclusive
   * ("under 10 minutes").
   * @example
   * ```ts
   * import { parseRange } from '@pascal-app/lingo'
   * const r = parseRange('5-10 kg')
   * r.ok && r.range.contains(7, 'kg')  // true
   * r.ok && r.range.contains(12, 'kg') // false
   * ```
   */
  contains(q: Quantity | number, unitId?: string): boolean {
    let base: number
    if (typeof q === 'number') {
      if (unitId) {
        // Liberal resolution (aliases work), same as to()/the Quantity constructor.
        const unit = registryOf(this).unitByRef(this.kind, unitId)
        if (!unit) {
          throw new Error(`lingo: unknown unit "${unitId}" for kind "${this.kind}"`)
        }
        base = toBase(unit, q)
      } else {
        base = q
      }
    } else {
      if (q.kind !== this.kind) {
        throw new Error(`lingo: cannot test ${q.kind} inside ${this.kind} range`)
      }
      base = q.base
    }
    if (this.minBase !== null && (this.exclusiveMin ? base <= this.minBase : base < this.minBase)) {
      return false
    }
    if (this.maxBase !== null && (this.exclusiveMax ? base >= this.maxBase : base > this.maxBase)) {
      return false
    }
    return true
  }

  /**
   * Re-express both bounds in another unit of the kind.
   * @example
   * ```ts
   * import { parseRange } from '@pascal-app/lingo'
   * const r = parseRange('5-10 kg')
   * r.ok && r.range.to('lb').min()?.value // 11.023113109243878
   * ```
   */
  to<const Unit extends string>(unitId: Unit & UnitRefForKind<K, Unit>): QuantityRange<K> {
    const reg = registryOf(this)
    const unit = reg.unitByRef(this.kind, unitId)
    if (!unit) {
      throw new Error(`lingo: unknown unit "${unitId}" for kind "${this.kind}"`)
    }
    if (this.minUnit) {
      assertRateBasedTarget(reg, this.kind, this.minUnit, unit.id)
    }
    if (this.maxUnit) {
      assertRateBasedTarget(reg, this.kind, this.maxUnit, unit.id)
    }
    if (this.plusMinus) {
      assertRateBasedTarget(reg, this.kind, this.plusMinus.unit, unit.id)
    }
    return new QuantityRange(reg, this.kind, {
      min: this.minBase === null ? undefined : { base: this.minBase, unit: unit.id },
      max: this.maxBase === null ? undefined : { base: this.maxBase, unit: unit.id },
      exclusiveMin: this.exclusiveMin,
      exclusiveMax: this.exclusiveMax,
      plusMinus: this.plusMinus ? { ...this.plusMinus, unit: unit.id } : undefined,
      approximate: this.approximate,
      fuzzy: this.fuzzy,
    })
  }

  /**
   * Human formatting — the inverse of range parsing.
   * @example
   * ```ts
   * import { parseRange } from '@pascal-app/lingo'
   * const r = parseRange('5-10 kg')
   * r.ok && r.range.format() // "5–10 kg"
   * ```
   */
  format(opts?: RangeFormatOptions): string {
    return formatRange(registryOf(this), this, opts)
  }

  /**
   * Serialize to a plain, JSON-safe object. Rehydrate with `fromJSON` (main
   * entry) or `QuantityRange.fromJSON` (needs a registry).
   * @example
   * ```ts
   * import { parseRange, fromJSON } from '@pascal-app/lingo'
   * const r = parseRange('5-10 kg')
   * const json = r.ok && r.range.toJSON()
   * // { schemaVersion: 3, type: 'range', kind: 'mass', baseUnit: 'kg', min: {…}, max: {…} }
   * json && fromJSON(json).min()?.value // 5
   * ```
   */
  toJSON(): QuantityRangeJSON {
    const reg = registryOf(this)
    const baseUnit = rangeBaseUnit(reg, this)
    const json: QuantityRangeJSON = {
      schemaVersion: 3,
      type: 'range',
      kind: this.kind,
      baseUnit: baseUnit.id,
    }
    if (this.minBase !== null) {
      json.min = rangeValueJSON(reg, this.kind, this.minBase, this.minUnit!)
      if (this.exclusiveMin) {
        json.min.exclusive = true
      }
    }
    if (this.maxBase !== null) {
      json.max = rangeValueJSON(reg, this.kind, this.maxBase, this.maxUnit!)
      if (this.exclusiveMax) {
        json.max.exclusive = true
      }
    }
    if (this.plusMinus) {
      json.plusMinus = {
        center: rangeValueJSON(reg, this.kind, this.plusMinus.centerBase, this.plusMinus.unit),
        delta: rangeDeltaJSON(
          reg,
          this.kind,
          this.plusMinus.deltaBase,
          this.plusMinus.unit,
          baseUnit.id,
        ),
      }
    }
    if (this.approximate) {
      json.approximate = true
    }
    if (this.fuzzy) {
      json.fuzzy = this.fuzzy
    }
    return json
  }

  /**
   * Rehydrate a `QuantityRange` from `toJSON()` output. Prefer the main
   * entry's `fromJSON()` unless you're on `lingo/core` and managing your own
   * registry.
   * @example
   * ```ts
   * import { QuantityRange, defaultRegistry } from '@pascal-app/lingo'
   * QuantityRange.fromJSON(defaultRegistry, {
   *   schemaVersion: 3, type: 'range', kind: 'mass', baseUnit: 'kg',
   *   min: { value: 5, unit: 'kg', base: 5 },
   *   max: { value: 10, unit: 'kg', base: 10 },
   * }).min()?.value // 5
   * ```
   */
  static fromJSON(reg: Registry, json: QuantityRangeJSON): QuantityRange {
    assertSchemaVersion(json.schemaVersion)
    assertRangeJSONBaseUnit(reg, json)
    if (json.min) {
      assertFinite(json.min.base, 'min.base')
      assertFinite(json.min.value, 'min.value')
    }
    if (json.max) {
      assertFinite(json.max.base, 'max.base')
      assertFinite(json.max.value, 'max.value')
    }
    if (json.min && json.max && json.min.base > json.max.base) {
      throw new Error('lingo: range min exceeds max')
    }
    if (json.plusMinus) {
      assertFinite(json.plusMinus.center.base, 'plusMinus.center.base')
      assertFinite(json.plusMinus.center.value, 'plusMinus.center.value')
      assertFinite(json.plusMinus.delta.base, 'plusMinus.delta.base')
      assertFinite(json.plusMinus.delta.value, 'plusMinus.delta.value')
    }
    return new QuantityRange(reg, json.kind, {
      min: json.min ? { base: json.min.base, unit: json.min.unit } : undefined,
      max: json.max ? { base: json.max.base, unit: json.max.unit } : undefined,
      exclusiveMin: json.min?.exclusive,
      exclusiveMax: json.max?.exclusive,
      plusMinus: json.plusMinus
        ? {
            centerBase: json.plusMinus.center.base,
            deltaBase: json.plusMinus.delta.base,
            unit: json.plusMinus.center.unit,
          }
        : undefined,
      approximate: json.approximate,
      fuzzy: json.fuzzy,
    })
  }
}
