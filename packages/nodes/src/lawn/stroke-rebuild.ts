/**
 * A hand stroke publishes the lawn it proposes on every pointer sample, and each one used to
 * rebuild the whole lawn: tens of milliseconds a sample on a full lot. While a stroke is in
 * progress the lawn now rebuilds at most every `LAWN_STROKE_REBUILD_MS`, and never spends more
 * than `LAWN_STROKE_REBUILD_SHARE` of the time rebuilding; release, cancel and every other
 * change rebuild at once, as before.
 */
export const LAWN_STROKE_REBUILD_MS = 120
export const LAWN_STROKE_REBUILD_SHARE = 0.2

type Stroke = { key?: string; at: number; cost: number }
const strokes = new Map<string, Stroke>()
let builds = 0

const spacing = (stroke: Stroke) =>
  Math.max(LAWN_STROKE_REBUILD_MS, stroke.cost / LAWN_STROKE_REBUILD_SHARE)

export function beginLawnStroke(id: string): void {
  strokes.set(id, { at: 0, cost: 0 })
}

export function endLawnStroke(id: string): void {
  strokes.delete(id)
}

/** What the lawn's last full build cost; a slower lawn spaces its stroke rebuilds further apart. */
export function noteLawnBuild(id: string, ms: number): void {
  const stroke = strokes.get(id)
  if (stroke) stroke.cost = ms
}

/** How long after a sample the lawn is certain to accept a rebuild again. */
export function lawnStrokeCatchUpMs(id: string): number {
  const stroke = strokes.get(id)
  return stroke ? spacing(stroke) : 0
}

/**
 * The lawn's `geometryKey`: the viewer keeps the current build while the key is unchanged. A lawn
 * also depends on its Site (ground, buildings, paving, beds), which a key cannot see, so every
 * call gets a new key and rebuilds, except the samples of one stroke that fall inside its spacing.
 */
export function lawnGeometryKey(node: { id: string }, now = performance.now()): string {
  const stroke = strokes.get(node.id)
  if (stroke?.key !== undefined && now - stroke.at < spacing(stroke)) return stroke.key
  const key = `lawn-build-${++builds}`
  if (stroke) {
    stroke.key = key
    stroke.at = now
  }
  return key
}
