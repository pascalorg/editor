import { getRidgeVentLinesForSegment } from '../schema/nodes/ridge-vent'
import { getRoofSegmentVisibleTopBounds, type RoofSegmentNode } from '../schema/nodes/roof-segment'

export type RidgeSnap = {
  localX: number
  localZ: number
  rotation: number
}

/** Native ridge/break-line snapping; a shed uses its high eave. */
export function resolveRidgeSnap(
  segment: RoofSegmentNode,
  cursorLocalX: number,
  cursorLocalZ: number,
): RidgeSnap | null {
  const roofType = segment.roofType ?? 'gable'
  if (roofType === 'flat' || roofType === 'conical') return null
  const lines =
    roofType === 'shed'
      ? getShedHighEaveLine(segment)
      : getRidgeVentLinesForSegment(segment).map(({ start, end }) => ({ start, end }))
  if (lines.length === 0) return null
  let best: RidgeSnap | null = null
  let bestDistanceSq = Number.POSITIVE_INFINITY
  for (const line of lines) {
    const [sx, sz] = line.start
    const [ex, ez] = line.end
    const dx = ex - sx
    const dz = ez - sz
    const lengthSq = dx * dx + dz * dz
    const t =
      lengthSq <= 1e-8
        ? 0
        : Math.max(0, Math.min(1, ((cursorLocalX - sx) * dx + (cursorLocalZ - sz) * dz) / lengthSq))
    const localX = sx + dx * t
    const localZ = sz + dz * t
    const distanceSq = (cursorLocalX - localX) ** 2 + (cursorLocalZ - localZ) ** 2
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq
      best = { localX, localZ, rotation: Math.atan2(-dz, dx) }
    }
  }
  return best
}

function getShedHighEaveLine(segment: RoofSegmentNode) {
  const { minX, maxX, minZ } = getRoofSegmentVisibleTopBounds(segment)
  return [{ start: [minX, minZ] as [number, number], end: [maxX, minZ] as [number, number] }]
}
