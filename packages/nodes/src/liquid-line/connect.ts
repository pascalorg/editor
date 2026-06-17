import type { LiquidLineNode } from './schema'

type Point = [number, number, number]
type LiquidLineId = LiquidLineNode['id']

/** Coincidence tolerance (meters) for folding endpoints into one run. The
 * draw tool snaps onto an existing run's endpoint exactly, so this only
 * needs to absorb float drift, not user aim. */
const COINCIDENT_EPS_M = 1e-3

function samePoint(a: Point, b: Point): boolean {
  return (
    Math.abs(a[0] - b[0]) < COINCIDENT_EPS_M &&
    Math.abs(a[1] - b[1]) < COINCIDENT_EPS_M &&
    Math.abs(a[2] - b[2]) < COINCIDENT_EPS_M
  )
}

/** Which terminal of `line` coincides with `p`, if either. */
function matchEnd(line: LiquidLineNode, p: Point): 'start' | 'end' | null {
  const path = line.path as Point[]
  if (samePoint(path[0]!, p)) return 'start'
  if (samePoint(path[path.length - 1]!, p)) return 'end'
  return null
}

/** First liquid line whose start or end coincides with `p`. */
function findConnection(
  existing: LiquidLineNode[],
  p: Point,
): { line: LiquidLineNode; side: 'start' | 'end' } | null {
  for (const line of existing) {
    if (line.path.length < 2) continue
    const side = matchEnd(line, p)
    if (side) return { line, side }
  }
  return null
}

/** Path re-ordered so the connecting terminal is its LAST point. */
function endLast(path: Point[], side: 'start' | 'end'): Point[] {
  return side === 'end' ? path : [...path].reverse()
}

/** Path re-ordered so the connecting terminal is its FIRST point. */
function startFirst(path: Point[], side: 'start' | 'end'): Point[] {
  return side === 'start' ? path : [...path].reverse()
}

/**
 * Outcome of committing a new `start`→`end` segment against the existing
 * liquid-line runs on the same level:
 *   - `create`  — no shared endpoint; place a fresh standalone run.
 *   - `extend`  — one end lands on run `id`; grow that run's path so the old
 *     terminal becomes an interior point (the geometry miters it).
 *   - `bridge`  — both ends land on two *different* runs; weld them plus the
 *     new segment into one path on `id` and delete the absorbed `deleteId`.
 */
export type LiquidLineConnectPlan =
  | { kind: 'create'; path: Point[] }
  | { kind: 'extend'; id: LiquidLineId; path: Point[] }
  | { kind: 'bridge'; id: LiquidLineId; path: Point[]; deleteId: LiquidLineId }

/**
 * Decide how a freshly drawn `start`→`end` segment folds into existing
 * liquid-line runs that share an endpoint coordinate. Pure: returns a plan,
 * the caller mutates the scene. Coords are level-local, so `existing` must be
 * pre-filtered to the segment's level.
 */
export function planLiquidLineConnect(
  existing: LiquidLineNode[],
  start: Point,
  end: Point,
): LiquidLineConnectPlan {
  const atStart = findConnection(existing, start)
  const atEnd = findConnection(existing, end)

  // Both ends meet distinct runs → weld the three into one path.
  if (atStart && atEnd && atStart.line.id !== atEnd.line.id) {
    const left = endLast(atStart.line.path as Point[], atStart.side) // ...→ start
    const right = startFirst(atEnd.line.path as Point[], atEnd.side) // end →...
    return {
      kind: 'bridge',
      id: atStart.line.id,
      path: [...left, ...right],
      deleteId: atEnd.line.id,
    }
  }
  if (atStart) {
    const base = endLast(atStart.line.path as Point[], atStart.side) // ...→ start
    return { kind: 'extend', id: atStart.line.id, path: [...base, end] }
  }
  if (atEnd) {
    const base = startFirst(atEnd.line.path as Point[], atEnd.side) // end →...
    return { kind: 'extend', id: atEnd.line.id, path: [start, ...base] }
  }
  return { kind: 'create', path: [start, end] }
}
