import { fromBase } from '../core/convert'
import type { Registry } from '../core/registry'
import type { Kind, UnitDef, UnitSystem } from '../core/types'

/**
 * Options for `Quantity.toBest()`/`pickBestUnit()`.
 * @example
 * ```ts
 * import { quantity } from '@pascal-app/lingo'
 * quantity(1500, 'm').toBest().format()                  // "1.5 km"
 * quantity(1500, 'm').toBest({ exclude: ['km'] }).format() // "1500 m"
 * ```
 */
export interface ToBestOptions {
  /** Smallest display value considered comfortable (convert-units lesson). */
  cutOff?: number
  /** Unit ids to skip. */
  exclude?: string[]
  /** Target system; defaults to the current unit's system ('shared' → metric). */
  system?: UnitSystem
}

/**
 * Pick the best display unit for a base value: the largest eligible unit
 * whose |value| ≥ cutOff, staying inside one measurement system. Only units
 * that declare `best` participate (no decameters, no fathoms). Returns null
 * when nothing beats the current unit (e.g. temperature — never auto-switch).
 * Powers `Quantity.toBest()`; most callers should use that instead.
 * @example
 * ```ts
 * import { defaultRegistry } from '@pascal-app/lingo'
 * import { pickBestUnit } from '@pascal-app/lingo/core'
 * const m = defaultRegistry.unit('length', 'm')!
 * pickBestUnit(defaultRegistry, 'length', 1500, m)?.id // 'km'
 * ```
 */
export function pickBestUnit(
  reg: Registry,
  kind: Kind,
  base: number,
  current: UnitDef,
  opts?: ToBestOptions,
): UnitDef | null {
  const system: UnitSystem =
    opts?.system ?? (current.system === 'shared' ? 'metric' : current.system)
  const cutOff = opts?.cutOff ?? 1
  const excluded = new Set(opts?.exclude ?? [])

  const candidates = reg
    .unitsOf(kind)
    .filter(
      (u) =>
        u.best !== undefined &&
        !excluded.has(u.id) &&
        (u.system === system || u.system === 'shared'),
    )
    .sort((a, b) => a.factor - b.factor || a.best! - b.best!)
  if (candidates.length === 0 || base === 0) {
    return null
  }

  let pick: UnitDef | null = null
  for (const u of candidates) {
    if (Math.abs(fromBase(u, base)) >= cutOff) {
      pick = u
    }
  }
  // Everything too big for the value → smallest candidate keeps digits sane.
  return pick ?? candidates[0]!
}
