// Catalog: read-only queries over lingo's built-in unit/kind/currency data.
// Beyond parse/convert/format, this is the "structured-data" surface — list
// kinds, enumerate units with full metadata, resolve any ref, find related
// units, and pull currency + ISO country data.
//
// The catalog reads a private frozen snapshot of the BUILT-IN data only. It
// deliberately does not see kinds or units added at runtime via
// `registerKind()`/`registerUnits()` on the main entry's `defaultRegistry` —
// that keeps catalog answers deterministic and side-effect-free. To enumerate
// a custom registry, keep your own `KindDef` data and query it directly.
import { createRegistry } from '../core/registry'
import type { Kind, UnitDef, UnitSystem } from '../core/types'
import { allKinds } from '../units/index'
import { currencyCountries } from './currency-countries'

const registry = createRegistry(allKinds)
const kindByBaseUnit = new Map<Kind, string>(allKinds.map((k) => [k.kind, k.baseUnit]))

/**
 * Full, self-describing metadata for one built-in unit — everything the
 * registry knows, resolved (plural and aliases are never left implicit).
 */
export interface UnitInfo {
  /** All accepted parse spellings (id, symbol, name, plural, and aliases), de-duplicated. */
  aliases: string[]
  /** Canonical id, unique within the kind and parseable anywhere: `'ft'`, `'USD'`. */
  id: string
  /** ECMA-402 unit id for `Intl` formatting, when one exists. */
  intl?: string
  /** `true` when this is the kind's canonical base unit (`base` values are in it). */
  isBase: boolean
  /** Measurement kind this unit belongs to, e.g. `'length'`. */
  kind: Kind
  /** Currency minor-unit decimal places (e.g. `2` for USD cents); currency only. */
  minorUnit?: number
  /** Singular long name: `'foot'`. */
  name: string
  /** Plural long name (resolved — `${name}s` when the unit declares none). */
  plural: string
  /** Preferred display symbol: `'ft'`, `'°C'`, `'$'`. */
  symbol: string
  /** Unit-system grouping: `'metric' | 'imperial' | 'us' | 'shared'`. */
  system: UnitSystem
  /** Multiply a value in this unit by `toBase` to get the canonical base-unit value. */
  toBase: number
}

/** A built-in currency, enriched with ISO minor-unit and country data. */
export interface CurrencyInfo {
  /** All accepted parse spellings (code, symbol, name, aliases). */
  aliases: string[]
  /** ISO 4217 code: `'USD'`, `'EUR'`. */
  code: string
  /** ISO 3166-1 alpha-2 codes of countries that use it officially (may be empty). */
  countries: string[]
  /** Minor-unit decimal places (`2` → cents; `0` → none; `3` → mills). */
  minorUnit: number
  /** Singular name: `'dollar'`. */
  name: string
  /** Plural name: `'dollars'`. */
  plural: string
  /** Currency symbol: `'$'`, `'€'`. */
  symbol: string
}

function unitInfo(kind: Kind, unit: UnitDef): UnitInfo {
  const plural = unit.plural ?? `${unit.name}s`
  const aliases = [...new Set([unit.id, unit.symbol, unit.name, plural, ...(unit.aliases ?? [])])]
  const info: UnitInfo = {
    kind,
    id: unit.id,
    symbol: unit.symbol,
    name: unit.name,
    plural,
    system: unit.system,
    aliases,
    isBase: kindByBaseUnit.get(kind) === unit.id,
    toBase: unit.factor,
  }
  if (unit.intl !== undefined) {
    info.intl = unit.intl
  }
  if (unit.minorUnit !== undefined) {
    info.minorUnit = unit.minorUnit
  }
  return info
}

/**
 * Every built-in measurement kind, in registration order.
 * @example
 * ```ts
 * import { listKinds } from '@pascal-app/lingo/catalog'
 * listKinds().includes('currency') // true
 * ```
 */
export function listKinds(): Kind[] {
  return allKinds.map((k) => k.kind)
}

/**
 * All units in a kind, with full metadata. Empty for an unknown kind.
 * @example
 * ```ts
 * import { listUnits } from '@pascal-app/lingo/catalog'
 * listUnits('mass').map((u) => u.id) // ['μg','mg','g','kg',…]
 * ```
 */
export function listUnits(kind: Kind): UnitInfo[] {
  return registry.unitsOf(kind).map((u) => unitInfo(kind, u))
}

/**
 * The base unit and unit list for a kind, or `undefined` if the kind is unknown.
 * @example
 * ```ts
 * import { kindInfo } from '@pascal-app/lingo/catalog'
 * kindInfo('length')?.baseUnit // 'm'
 * ```
 */
export function kindInfo(
  kind: Kind,
): { kind: Kind; baseUnit: string; units: UnitInfo[] } | undefined {
  const base = kindByBaseUnit.get(kind)
  if (base === undefined) {
    return
  }
  return { kind, baseUnit: base, units: listUnits(kind) }
}

/**
 * Resolve any ref (id, symbol, name, plural, or alias) to its unit. Pass `kind`
 * to disambiguate cross-kind refs (`'oz'`, `'C'`); otherwise the runtime's
 * default priority wins. Case-insensitive except for hazard units (`'mm'` vs `'Mm'`).
 * @example
 * ```ts
 * import { getUnit } from '@pascal-app/lingo/catalog'
 * getUnit('kilos')?.id // 'kg'
 * getUnit('C', 'charge')?.name // 'coulomb'
 * ```
 */
export function getUnit(ref: string, kind?: Kind): UnitInfo | undefined {
  if (kind !== undefined) {
    const unit = registry.unitByRef(kind, ref)
    return unit ? unitInfo(kind, unit) : undefined
  }
  const hit = registry.findUnitByRef(ref)
  return hit ? unitInfo(hit.kind, hit.unit) : undefined
}

/**
 * The measurement kind a ref resolves to, or `undefined` if unknown.
 * @example
 * ```ts
 * import { kindOf } from '@pascal-app/lingo/catalog'
 * kindOf('mph') // 'speed'
 * ```
 */
export function kindOf(ref: string): Kind | undefined {
  return registry.findUnitByRef(ref)?.kind
}

/**
 * Sibling units in the same kind as `ref` (excluding `ref`'s own unit).
 * @example
 * ```ts
 * import { relatedUnits } from '@pascal-app/lingo/catalog'
 * relatedUnits('ft').some((u) => u.id === 'm') // true
 * ```
 */
export function relatedUnits(ref: string): UnitInfo[] {
  const hit = registry.findUnitByRef(ref)
  if (!hit) {
    return []
  }
  return registry
    .unitsOf(hit.kind)
    .filter((u) => u.id !== hit.unit.id)
    .map((u) => unitInfo(hit.kind, u))
}

function currencyInfo(unit: UnitDef): CurrencyInfo {
  const plural = unit.plural ?? `${unit.name}s`
  return {
    code: unit.id,
    symbol: unit.symbol,
    name: unit.name,
    plural,
    minorUnit: unit.minorUnit ?? 2,
    countries: [...(currencyCountries[unit.id] ?? [])],
    aliases: [...new Set([unit.id, unit.symbol, unit.name, plural, ...(unit.aliases ?? [])])],
  }
}

/**
 * Every built-in currency with ISO minor-unit and country data. Empty if the
 * currency kind is not registered.
 * @example
 * ```ts
 * import { listCurrencies } from '@pascal-app/lingo/catalog'
 * listCurrencies().find((c) => c.code === 'JPY')?.minorUnit // 0
 * ```
 */
export function listCurrencies(): CurrencyInfo[] {
  return registry.unitsOf('currency').map(currencyInfo)
}

/**
 * Look up one currency by ISO code, symbol, or alias.
 * @example
 * ```ts
 * import { getCurrency } from '@pascal-app/lingo/catalog'
 * getCurrency('USD')?.countries.includes('US') // true
 * getCurrency('£')?.code // 'GBP'
 * ```
 */
export function getCurrency(ref: string): CurrencyInfo | undefined {
  const unit = registry.unitByRef('currency', ref)
  return unit ? currencyInfo(unit) : undefined
}

/**
 * The currency officially used by an ISO 3166-1 alpha-2 country code.
 * @example
 * ```ts
 * import { currencyForCountry } from '@pascal-app/lingo/catalog'
 * currencyForCountry('FR')?.code // 'EUR'
 * currencyForCountry('jp')?.code // 'JPY'
 * ```
 */
export function currencyForCountry(country: string): CurrencyInfo | undefined {
  const wanted = country.toUpperCase()
  for (const [code, countries] of Object.entries(currencyCountries)) {
    if (countries.includes(wanted)) {
      return getCurrency(code)
    }
  }
  return
}
