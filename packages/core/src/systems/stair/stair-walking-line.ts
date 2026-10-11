import type { StairNode, StairSegmentNode } from '../../schema'
import { computeSegmentTransforms, rotateXZ } from './stair-footprint'
import { resolveStairArcDimensions } from './stair-layout'
import { resolveStairWinder } from './stair-winder'

export type StairWalkingPoint = [number, number, number]

/** Ideal ascent line in stair-local coordinates; hidden segments break the displayed path. */
export function resolveStairWalkingPaths(
  stair: StairNode,
  segments: readonly StairSegmentNode[],
  totalRise: number,
): StairWalkingPoint[][] {
  if (stair.visible === false) return []
  if (stair.stairType !== 'straight') {
    const layout = resolveStairArcDimensions(stair, totalRise)
    if (!Number.isFinite(layout.sweepAngle)) return []
    // A presentation budget coarsens exceptionally long arcs without truncating their sweep.
    const samples = Math.max(
      2,
      Math.min(10_000, Math.ceil(Math.abs(layout.sweepAngle) / (Math.PI / 60))),
    )
    const points: StairWalkingPoint[] = Array.from({ length: samples + 1 }, (_, index) => {
      const t = index / samples
      const angle = -layout.sweepAngle / 2 + t * layout.sweepAngle
      return [
        Math.cos(angle) * layout.walkingRadius,
        t * totalRise,
        Math.sin(angle) * layout.walkingRadius,
      ]
    })
    if (layout.landingSweep) {
      const landingSamples = Math.max(2, Math.ceil(Math.abs(layout.landingSweep) / (Math.PI / 60)))
      for (let index = 1; index <= landingSamples; index++) {
        const angle = layout.sweepAngle / 2 + (layout.landingSweep * index) / landingSamples
        points.push([
          Math.cos(angle) * layout.walkingRadius,
          totalRise,
          Math.sin(angle) * layout.walkingRadius,
        ])
      }
    }
    return [points]
  }
  const chain = segments.length
    ? segments
    : [
        {
          width: stair.width,
          length: 3,
          height: totalRise,
          attachmentSide: 'front' as const,
          segmentType: 'stair' as const,
          visible: true,
        },
      ]
  const transforms = computeSegmentTransforms(chain)
  const paths: StairWalkingPoint[][] = []
  let current: StairWalkingPoint[] = []
  const flush = () => {
    if (current.length > 1) paths.push(current)
    current = []
  }
  for (const [index, segment] of chain.entries()) {
    if (segment.visible === false) {
      flush()
      continue
    }
    const transform = transforms[index]!
    const point = (x: number, y: number, z: number): StairWalkingPoint => {
      const [dx, dz] = rotateXZ(x, z, transform.rotation)
      return [transform.position[0] + dx, transform.position[1] + y, transform.position[2] + dz]
    }
    const winder = 'winder' in segment ? resolveStairWinder(segment as StairSegmentNode) : null
    if (winder) {
      const points = winder.walkingLine.map(([x, y, z]) => point(x, y, z))
      const first = points[0]!
      if (current.length && Math.hypot(...first.map((v, i) => v - current.at(-1)![i]!)) > 1e-8)
        flush()
      current.push(...points)
      continue
    }
    const start = point(0, segment.segmentType === 'landing' ? segment.height : 0, 0)
    if (
      !current.length ||
      Math.hypot(...start.map((value, axis) => value - current.at(-1)![axis]!)) > 1e-8
    ) {
      flush()
      current.push(start)
    }
    if (segment.segmentType === 'landing') {
      current.push(point(0, segment.height, segment.length / 2))
      const nextSide = chain[index + 1]?.attachmentSide ?? 'front'
      current.push(
        point(
          nextSide === 'left' ? segment.width / 2 : nextSide === 'right' ? -segment.width / 2 : 0,
          segment.height,
          nextSide === 'front' ? segment.length : segment.length / 2,
        ),
      )
    } else current.push(point(0, segment.height, segment.length))
  }
  flush()
  return paths
}
