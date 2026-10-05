import {
  type AnyNode,
  type AnyNodeId,
  getWallArcData,
  getWallCurveFrameAt,
  getWallCurveLength,
  planWallDivisions,
  type WallNode,
  type WallPlanPoint,
} from '@pascal-app/core'

export const WALL_SPLIT_MAX_CUTS = 32

/** Cut markers in both views: warm when the cuts can commit, red when they can't. */
export function wallSplitMarkerColor(valid: boolean) {
  return valid ? '#c86f45' : '#a63d2e'
}
// The planner refuses cuts closer than this to either end.
const END_CLEARANCE = 0.05

/** The pointer projected onto the wall, as a distance from its start; curved walls included. */
export function wallSplitDistance(wall: WallNode, point: readonly [number, number]): number {
  const length = getWallCurveLength(wall)
  const arc = getWallArcData(wall)
  if (arc) {
    const angle = Math.atan2(point[1] - arc.center.y, point[0] - arc.center.x)
    const turn = Math.PI * 2
    const delta = (((arc.direction * (angle - arc.startAngle)) % turn) + turn) % turn
    if (delta <= Math.abs(arc.delta)) return (delta / Math.abs(arc.delta)) * length
    return Math.hypot(point[0] - wall.start[0], point[1] - wall.start[1]) <=
      Math.hypot(point[0] - wall.end[0], point[1] - wall.end[1])
      ? 0
      : length
  }
  if (length === 0) return 0
  return Math.max(
    0,
    Math.min(
      length,
      ((point[0] - wall.start[0]) * (wall.end[0] - wall.start[0]) +
        (point[1] - wall.start[1]) * (wall.end[1] - wall.start[1])) /
        length,
    ),
  )
}

/** Like a loop cut: one cut follows the pointer, more cuts divide the wall evenly. */
export function wallSplitDistances(length: number, cuts: number, distance: number): number[] {
  if (cuts <= 1) return [distance]
  return Array.from({ length: cuts }, (_, index) => (length * (index + 1)) / (cuts + 1))
}

export type WallSplitSnap =
  | { kind: 'grid' }
  | { kind: 'midpoint' }
  | { kind: 'alignment'; anchor: WallPlanPoint }
  | null

export type WallSplitSnapOptions = {
  /** Grid step while the 'grid' snapping mode is active. */
  gridStep: number | null
  /** Other wall ends to align with while the 'lines' mode is active. */
  anchors: readonly WallPlanPoint[] | null
  /** How far (m) the pointer may be from an alignment target to catch it. */
  tolerance: number
}

/**
 * Snaps a single cut along its wall with the active snapping mode: grid steps
 * counted from the wall start, or — in 'lines' — the midpoint and where the
 * level's other wall ends project onto the wall.
 */
export function snapWallSplitDistance(
  wall: WallNode,
  raw: number,
  options: WallSplitSnapOptions,
): { distance: number; snap: WallSplitSnap } {
  const length = getWallCurveLength(wall)
  const inside = (distance: number) =>
    distance >= END_CLEARANCE && distance <= length - END_CLEARANCE
  if (options.gridStep) {
    const snapped = Math.round(raw / options.gridStep) * options.gridStep
    return inside(snapped)
      ? { distance: snapped, snap: { kind: 'grid' } }
      : { distance: raw, snap: null }
  }
  if (!options.anchors) return { distance: raw, snap: null }
  let best: { distance: number; snap: WallSplitSnap; gap: number } = {
    distance: raw,
    snap: null,
    gap: options.tolerance,
  }
  const consider = (distance: number, snap: WallSplitSnap) => {
    const gap = Math.abs(distance - raw)
    if (gap < best.gap && inside(distance)) best = { distance, snap, gap }
  }
  consider(length / 2, { kind: 'midpoint' })
  for (const anchor of options.anchors) {
    consider(wallSplitDistance(wall, anchor), { kind: 'alignment', anchor })
  }
  return { distance: best.distance, snap: best.snap }
}

/** Ends of the level's other walls, for 'lines' alignment. */
export function wallSplitAnchors(
  nodes: Record<AnyNodeId, AnyNode>,
  wall: WallNode,
): WallPlanPoint[] {
  const own = (point: WallPlanPoint) =>
    [wall.start, wall.end].some((end) => end[0] === point[0] && end[1] === point[1])
  return Object.values(nodes).flatMap((node) =>
    node.type === 'wall' && node.id !== wall.id && node.parentId === wall.parentId
      ? [node.start, node.end].filter((point) => !own(point))
      : [],
  )
}

export function wallSplitPreview(
  nodes: Record<AnyNodeId, AnyNode>,
  wall: WallNode,
  distances: readonly number[],
) {
  const length = getWallCurveLength(wall)
  const frames = distances.map((distance) =>
    getWallCurveFrameAt(wall, length > 0 ? distance / length : 0),
  )
  let message = ''
  if (
    [wall, ...Object.values(nodes).filter((n) => n.parentId === wall.id)].some(
      (n) => n.metadata.arrayModifier || n.metadata.linkedArray,
    )
  ) {
    message = 'Make the linked array real before splitting this wall.'
  } else {
    try {
      planWallDivisions(nodes, wall.id, distances)
    } catch (error) {
      message = error instanceof Error ? error.message : 'This wall cannot be split here.'
    }
  }
  return { distances: [...distances], length, frames, valid: !message, message }
}

export type WallSplitPreview = ReturnType<typeof wallSplitPreview>

/** What to label: both sides of a single cut, or one length repeated across even cuts. */
export function wallSplitSegmentLabels(wall: WallNode, preview: WallSplitPreview) {
  const bounds = [0, ...preview.distances, preview.length]
  const segments = bounds.slice(1).map((end, index) => [bounds[index]!, end] as const)
  const count = preview.distances.length === 1 ? 1 : segments.length
  return (count === 1 ? segments : segments.slice(0, 1)).map(([from, to]) => {
    const { point, tangent } = getWallCurveFrameAt(
      wall,
      preview.length > 0 ? (from + to) / 2 / preview.length : 0,
    )
    return {
      length: to - from,
      count,
      midpoint: [point.x, point.y] as WallPlanPoint,
      direction: [tangent.x, tangent.y] as WallPlanPoint,
    }
  })
}
