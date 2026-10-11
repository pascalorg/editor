import { areSemanticValuesEqual } from './semantic-equal'

/** Placement and reconciliation shared by arrays and procedural generators.
 * No scene store, rendering, node kind or ownership metadata is assumed here.
 */
export type RepeatOffset = [number, number, number]
export type RepeatPlacement = { key: string; index: number; offset: RepeatOffset }

export function linearArray({
  count,
  step,
  origin = [0, 0, 0],
  firstIndex = 0,
  excluded = [],
}: {
  count: number
  step: RepeatOffset
  origin?: RepeatOffset
  firstIndex?: number
  excluded?: readonly number[]
}): RepeatPlacement[] {
  if (
    !Number.isSafeInteger(count) ||
    count < 0 ||
    count > 10000 ||
    !Number.isSafeInteger(firstIndex)
  ) {
    throw new Error('A repetition needs a whole count between 0 and 10,000.')
  }
  if (![...step, ...origin].every(Number.isFinite))
    throw new Error('Repetition positions must be finite.')
  const omitted = new Set(excluded)
  const placements: RepeatPlacement[] = []
  for (let i = 0; i < count; i++) {
    const index = firstIndex + i
    if (omitted.has(index)) continue
    placements.push({
      key: String(index),
      index,
      offset: step.map((value, axis) => origin[axis]! + value * index) as RepeatOffset,
    })
  }
  return placements
}

export type RepetitionPlan<T> = {
  values: T[]
  added: T[]
  updated: T[]
  removed: T[]
}

export function indexRepetitions<T>(
  values: readonly T[],
  keyOf: (value: T) => string,
): Map<string, T> {
  const index = new Map<string, T>()
  for (const value of values) {
    const key = keyOf(value)
    if (index.has(key)) throw new Error(`Duplicate repetition key: ${key}`)
    index.set(key, value)
  }
  return index
}

/** Match by logical key, never array position. Omitted cells keep their identity.
 * Only pass records owned by this generator; unrelated objects are not inputs.
 * Build receives the previous record so its native ID and custom fields survive.
 */
export function reconcileRepetitions<S, T>({
  desired,
  previous,
  keyOf,
  build,
  equal = areSemanticValuesEqual,
}: {
  desired: readonly S[]
  previous: ReadonlyMap<string, T>
  keyOf: (spec: S) => string
  build: (spec: S, previous: T | undefined) => T
  equal?: (a: T, b: T) => boolean
}): RepetitionPlan<T> {
  // Reject ambiguous ownership before invoking the builder.
  const wanted = indexRepetitions(desired, keyOf)
  const plan: RepetitionPlan<T> = { values: [], added: [], updated: [], removed: [] }
  for (const [key, spec] of wanted) {
    const old = previous.get(key)
    const next = build(spec, old)
    if (old !== undefined && equal(old, next)) {
      plan.values.push(old)
    } else {
      plan.values.push(next)
      if (old === undefined) plan.added.push(next)
      else plan.updated.push(next)
    }
  }
  for (const [key, old] of previous) if (!wanted.has(key)) plan.removed.push(old)
  return plan
}

/** Remap internal references for native subtrees or independent materials. */
export function remapRepeatedReferences<T>(value: T, ids: ReadonlyMap<string, string>): T {
  if (typeof value === 'string') return (ids.get(value) ?? value) as T
  if (Array.isArray(value)) return value.map((entry) => remapRepeatedReferences(entry, ids)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, remapRepeatedReferences(entry, ids)]),
    ) as T
  }
  return value
}
