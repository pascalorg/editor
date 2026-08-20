import type { Registry } from './registry'
import type { Kind, UnitDef } from './types'

export const RATE_BASED_CONVERSION_ERROR =
  'lingo: cross-currency conversion needs rates — use convertCurrency(…)'

/**
 * value expressed in `unit` → value in the kind's base unit.
 * @example
 * ```ts
 * import { toBase } from '@pascal-app/lingo/core'
 * const inch = { id: 'in', symbol: 'in', name: 'inch', factor: 0.0254, system: 'us' } as const
 * toBase(inch, 72) // 1.8288 (meters)
 * ```
 */
export function toBase(unit: UnitDef, value: number): number {
  return value * unit.factor + (unit.offset ?? 0)
}

/**
 * value in the kind's base unit → value expressed in `unit`.
 * @example
 * ```ts
 * import { fromBase } from '@pascal-app/lingo/core'
 * const inch = { id: 'in', symbol: 'in', name: 'inch', factor: 0.0254, system: 'us' } as const
 * fromBase(inch, 1.8288) // 72
 * ```
 */
export function fromBase(unit: UnitDef, base: number): number {
  return (base - (unit.offset ?? 0)) / unit.factor
}

function requireUnit(reg: Registry, kind: Kind, unitId: string): UnitDef {
  const unit = reg.unitByRef(kind, unitId)
  if (!unit) {
    throw new Error(`lingo: unknown unit "${unitId}" for kind "${kind}"`)
  }
  return unit
}

function assertAffineConversion(reg: Registry, kind: Kind, from: UnitDef, to: UnitDef): void {
  if (from.id !== to.id && reg.kind(kind)?.rateBased) {
    throw new Error(RATE_BASED_CONVERSION_ERROR)
  }
}

/**
 * Absolute conversion between two units of the same kind.
 * @example
 * ```ts
 * import { convertValue } from '@pascal-app/lingo/core'
 * import { defaultRegistry } from '@pascal-app/lingo'
 * convertValue(defaultRegistry, 'length', 72, 'in', 'cm') // 182.88
 * ```
 */
export function convertValue(
  reg: Registry,
  kind: Kind,
  value: number,
  fromUnitId: string,
  toUnitId: string,
): number {
  const from = requireUnit(reg, kind, fromUnitId)
  const to = requireUnit(reg, kind, toUnitId)
  if (from === to) {
    return value
  }
  assertAffineConversion(reg, kind, from, to)
  return fromBase(to, toBase(from, value))
}

/**
 * Difference (delta) conversion: factors only, offsets ignored. A 5 °C
 * temperature *increase* is a 9 °F increase — never routed through offsets.
 * @example
 * ```ts
 * import { convertDeltaValue } from '@pascal-app/lingo/core'
 * import { defaultRegistry } from '@pascal-app/lingo'
 * convertDeltaValue(defaultRegistry, 'temperature', 5, 'C', 'F') // 9 (a rise, not an absolute temp)
 * ```
 */
export function convertDeltaValue(
  reg: Registry,
  kind: Kind,
  value: number,
  fromUnitId: string,
  toUnitId: string,
): number {
  const from = requireUnit(reg, kind, fromUnitId)
  const to = requireUnit(reg, kind, toUnitId)
  if (from === to) {
    return value
  }
  assertAffineConversion(reg, kind, from, to)
  return (value * from.factor) / to.factor
}
