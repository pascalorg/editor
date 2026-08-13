import type { AnyNode, AnyNodeId } from '@pascal-app/core'

/**
 * Linear-array duplication — SketchUp's move-then-`*n` syntax.
 *
 * Pure logic only: parsing the typed command, recognising a plain move in a
 * scene commit, and turning that move into a list of offsets. No store, no
 * React. The store wrapper feeds it commits; the executor turns offsets into
 * clones.
 */

export type ArrayCommand =
  /** `*n` — repeat the last translation n more times. */
  | { kind: 'repeat'; count: number }
  /** `/n` — divide the last translation into n equal steps and fill them in. */
  | { kind: 'divide'; count: number }

export type Vector3 = readonly [number, number, number]

/**
 * A move worth arraying: some nodes shifted by one shared vector and nothing
 * else about the scene changed.
 */
export type UniformTranslation = {
  nodeIds: AnyNodeId[]
  translation: Vector3
}

/**
 * Upper bound on how many copies one command may create.
 *
 * A typo like `*1000` on a heavy subtree is indistinguishable from intent at
 * parse time, and the scene write is synchronous — so the cap is here, where
 * it can reject cheaply, rather than after the clone loop has already run.
 */
export const MAX_ARRAY_COUNT = 200

/** Below this, a "move" is a click that jittered rather than a translation. */
const MIN_TRANSLATION = 1e-6

/**
 * Parse the measurement-input buffer as an array command.
 *
 * Both orders are accepted (`*12` and `12*`): SketchUp takes either, and which
 * one a user reaches for depends on whether they think "times twelve" or
 * "twelve copies".
 */
export function parseArrayCommand(buffer: string): ArrayCommand | null {
  const trimmed = buffer.trim()
  if (!trimmed) return null

  const match = /^(?:([*/])\s*(\d+)|(\d+)\s*([*/]))$/.exec(trimmed)
  if (!match) return null

  const operator = match[1] ?? match[4]
  const digits = match[2] ?? match[3]
  if (!(operator && digits)) return null

  const count = Number.parseInt(digits, 10)
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_ARRAY_COUNT) return null

  return operator === '*' ? { kind: 'repeat', count } : { kind: 'divide', count }
}

/** True when the buffer looks like the start of an array command. */
export function isArrayCommandPrefix(buffer: string): boolean {
  return /^(?:[*/]\s*\d*|\d+\s*[*/]?)$/.test(buffer.trim()) && /[*/]/.test(buffer)
}

/**
 * Fields a kind's geometry can be translated through.
 *
 * Not every kind has a `position`. Walls and fences carry `start` / `end` plan
 * points, slabs and zones a `polygon`, duct and pipe runs a `path` — and a move
 * rewrites those instead. Checking only `position` made the command silently
 * refuse on walls, which is the thing most worth arraying.
 */
const TRANSLATABLE_FIELDS = ['position', 'start', 'end', 'polygon', 'holes', 'path'] as const

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** A tuple of 2 (plan `[x, z]`) or 3 (`[x, y, z]`) finite numbers. */
function readPoint(value: unknown): Vector3 | null {
  if (!Array.isArray(value)) return null
  const [a, b, c] = value
  if (value.length === 2 && isFiniteNumber(a) && isFiniteNumber(b)) return [a, 0, b]
  if (value.length === 3 && isFiniteNumber(a) && isFiniteNumber(b) && isFiniteNumber(c)) {
    return [a, b, c]
  }
  return null
}

const sameDelta = (a: Vector3, b: Vector3): boolean =>
  Math.abs(a[0] - b[0]) <= MIN_TRANSLATION &&
  Math.abs(a[1] - b[1]) <= MIN_TRANSLATION &&
  Math.abs(a[2] - b[2]) <= MIN_TRANSLATION

const subtract = (to: Vector3, from: Vector3): Vector3 => [
  to[0] - from[0],
  to[1] - from[1],
  to[2] - from[2],
]

/**
 * The shared delta between two values holding points — a single point, a list
 * of points, or a list of lists (a polygon's holes). Returns `null` when the
 * shapes differ or the points did not all shift by the same amount, which is
 * how a reshape is told apart from a move.
 */
function valueDelta(before: unknown, after: unknown): { delta: Vector3 | null } | null {
  const beforePoint = readPoint(before)
  const afterPoint = readPoint(after)
  if (beforePoint && afterPoint) return { delta: subtract(afterPoint, beforePoint) }

  if (!(Array.isArray(before) && Array.isArray(after))) return null
  if (before.length !== after.length) return null

  let delta: Vector3 | null = null
  for (let index = 0; index < before.length; index++) {
    const nested = valueDelta(before[index], after[index])
    if (!nested) return null
    if (!nested.delta) continue
    if (delta === null) delta = nested.delta
    else if (!sameDelta(delta, nested.delta)) return null
  }
  return { delta }
}

/** Everything except the translatable fields, so "did anything else change?". */
function withoutTranslatableFields(node: AnyNode): string {
  const rest: Record<string, unknown> = { ...(node as unknown as Record<string, unknown>) }
  for (const field of TRANSLATABLE_FIELDS) delete rest[field]
  return JSON.stringify(rest)
}

/**
 * The translation one node underwent, or `null` if it changed in any way that
 * is not a rigid shift of its geometry.
 */
function nodeTranslation(previous: AnyNode, next: AnyNode): Vector3 | null {
  if (withoutTranslatableFields(previous) !== withoutTranslatableFields(next)) return null

  const before = previous as unknown as Record<string, unknown>
  const after = next as unknown as Record<string, unknown>

  let delta: Vector3 | null = null
  for (const field of TRANSLATABLE_FIELDS) {
    if (!(field in before) && !(field in after)) continue

    // An *unchanged* field is not skipped: it contributes a zero delta, and
    // that is what tells a rigid move apart from an endpoint drag. A wall whose
    // `start` held still while `end` ran 3m is a reshape, and skipping the
    // unchanged `start` would have read it as a 3m move of the whole wall.
    const result = valueDelta(before[field], after[field])
    // The field changed but not by a translation.
    if (!result) return null
    // No points in there at all (an empty `holes` array) — nothing to say.
    if (!result.delta) continue
    if (delta === null) delta = result.delta
    else if (!sameDelta(delta, result.delta)) return null
  }

  return delta
}

/**
 * Recognise a plain move in a before/after pair of node maps.
 *
 * Deliberately strict — it returns `null` unless the change is *only* a shared
 * translation:
 *
 * - the node set is identical (a create or delete is not a move);
 * - every node that moved shifted by the same vector;
 * - no moved node changed anything besides `position`;
 * - no unmoved node changed at all.
 *
 * That strictness is the point. `*n` repeats "the last move", so anything the
 * user would not describe as a move — a resize, a reparent, a paint — must not
 * arm the command and silently array something unexpected.
 */
export function detectUniformTranslation(
  before: Readonly<Record<AnyNodeId, AnyNode>>,
  current: Readonly<Record<AnyNodeId, AnyNode>>,
): UniformTranslation | null {
  const beforeIds = Object.keys(before) as AnyNodeId[]
  if (beforeIds.length !== Object.keys(current).length) return null

  let translation: Vector3 | null = null
  const nodeIds: AnyNodeId[] = []

  for (const id of beforeIds) {
    const previous = before[id]
    const next = current[id]
    if (!(previous && next)) return null
    if (previous === next) continue

    const delta = nodeTranslation(previous, next)
    // Changed, but not by a rigid shift of its geometry — not a move.
    if (!delta) return null
    if (Math.hypot(...delta) < MIN_TRANSLATION) continue

    if (translation === null) translation = delta
    // Two different deltas in one commit is a reshape, not a move.
    else if (!sameDelta(translation, delta)) return null
    nodeIds.push(id)
  }

  if (!translation || nodeIds.length === 0) return null
  return { nodeIds, translation }
}

/**
 * Offsets for the new copies, relative to where the moved nodes now sit.
 *
 * - `*n` walks the same vector n more times, so the run reads as the original
 *   plus n evenly spaced copies beyond it.
 * - `/n` fills the gap the move just opened: n−1 copies stepped back from the
 *   moved position toward where it started. `/1` therefore adds nothing, which
 *   is the honest answer for "divide into one part".
 */
export function buildArrayOffsets(translation: Vector3, command: ArrayCommand): Vector3[] {
  // `+ 0` normalises the negative zero that scaling a zero axis by a negative
  // factor produces. It compares equal to 0 but serialises as `-0`, which would
  // leak into saved positions.
  const scale = (factor: number): Vector3 => [
    translation[0] * factor + 0,
    translation[1] * factor + 0,
    translation[2] * factor + 0,
  ]

  const offsets: Vector3[] = []

  if (command.kind === 'repeat') {
    for (let step = 1; step <= command.count; step++) offsets.push(scale(step))
    return offsets
  }

  for (let step = 1; step < command.count; step++) offsets.push(scale(-step / command.count))
  return offsets
}

/** Absolute position for a copy: where the node sits now, plus the offset. */
export function offsetPosition(position: Vector3, offset: Vector3): [number, number, number] {
  return [position[0] + offset[0], position[1] + offset[1], position[2] + offset[2]]
}

/** Shift every point in a value, preserving 2D vs 3D tuple shape. */
function translateValue(value: unknown, offset: Vector3): unknown {
  if (!Array.isArray(value)) return value

  const [a, b, c] = value
  if (value.length === 2 && isFiniteNumber(a) && isFiniteNumber(b)) {
    // Plan point `[x, z]` — the Y component of the offset has nowhere to go.
    return [a + offset[0], b + offset[2]]
  }
  if (value.length === 3 && isFiniteNumber(a) && isFiniteNumber(b) && isFiniteNumber(c)) {
    return [a + offset[0], b + offset[1], c + offset[2]]
  }
  return value.map((entry) => translateValue(entry, offset))
}

/**
 * Return a copy of `node` shifted by `offset`.
 *
 * Touches only the geometry fields a move would touch, so a kind carrying
 * `start`/`end` or a `polygon` arrays as readily as one carrying `position`.
 * Descendants are deliberately left alone: their coordinates are either local
 * to the root (so they follow it) or host-relative (a door's `wallT`), matching
 * what `cloneNodesInto` already assumes.
 */
export function translateNodeGeometry<N>(node: N, offset: Vector3): N {
  const source = node as unknown as Record<string, unknown>
  const next: Record<string, unknown> = { ...source }
  for (const field of TRANSLATABLE_FIELDS) {
    if (!(field in source)) continue
    next[field] = translateValue(source[field], offset)
  }
  return next as unknown as N
}
