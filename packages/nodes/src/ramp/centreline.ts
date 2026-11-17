import type { RampNode, RampSegment } from '@pascal-app/core'

export type PlanPoint = [number, number]

export function rampSegmentEnd(start: PlanPoint, segment: RampSegment): PlanPoint {
  if (segment.type === 'line') return [...segment.end]
  const angle =
    Math.atan2(start[1] - segment.center[1], start[0] - segment.center[0]) + segment.sweep
  const radius = Math.hypot(start[0] - segment.center[0], start[1] - segment.center[1])
  return [
    segment.center[0] + Math.cos(angle) * radius,
    segment.center[1] + Math.sin(angle) * radius,
  ]
}

export function rampSegmentFrames(node: Pick<RampNode, 'start' | 'segments'>) {
  let start = node.start
  return node.segments.map((segment) => {
    const end = rampSegmentEnd(start, segment)
    const midpoint: PlanPoint =
      segment.type === 'line'
        ? [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
        : rampSegmentEnd(start, { ...segment, sweep: segment.sweep / 2 })
    const frame = { start, end, midpoint, segment }
    start = end
    return frame
  })
}

/** The circle through an endpoint pair and a picked bend. Near-straight bends become lines. */
export function rampSegmentThrough(start: PlanPoint, end: PlanPoint, bend: PlanPoint): RampSegment {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (length < 1e-6) throw new Error('Choose distinct ramp endpoints.')
  const sagitta = ((bend[0] - start[0]) * -dz + (bend[1] - start[1]) * dx) / length
  if (Math.abs(sagitta) < 0.001) return { type: 'line', end }
  // Project the bend onto the perpendicular bisector so dragging feels like a curvature grip.
  const offset = sagitta / 2 - (length * length) / (8 * sagitta)
  const center: PlanPoint = [
    (start[0] + end[0]) / 2 - (dz / length) * offset,
    (start[1] + end[1]) / 2 + (dx / length) * offset,
  ]
  const sweep = -Math.sign(sagitta) * 4 * Math.atan2(2 * Math.abs(sagitta), length)
  return { type: 'arc', center, sweep }
}

/** Preserve all other endpoints while dragging a joint, including an adjacent arc's bend. */
export function moveRampPoint(node: RampNode, index: number, point: PlanPoint): Partial<RampNode> {
  const frames = rampSegmentFrames(node)
  const segments = [...node.segments]
  if (!Number.isInteger(index) || index < 0 || index > segments.length)
    throw new Error('Choose a ramp endpoint.')
  if (index > 0) {
    const before = frames[index - 1]
    if (!before) throw new Error('The ramp segment no longer exists.')
    segments[index - 1] =
      before.segment.type === 'line'
        ? { type: 'line', end: point }
        : rampSegmentThrough(before.start, point, before.midpoint)
  }
  if (index < segments.length) {
    const after = frames[index]
    if (!after) throw new Error('The ramp segment no longer exists.')
    segments[index] =
      after.segment.type === 'line'
        ? { type: 'line', end: after.end }
        : rampSegmentThrough(point, after.end, after.midpoint)
  }
  return { ...(index === 0 ? { start: point } : {}), segments }
}
