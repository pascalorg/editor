import type { AnyNode } from '../schema'
import { computeSegmentTransforms, rotateXZ } from '../systems/stair/stair-footprint'
import { resolveStairTotalRise } from '../systems/stair/stair-rise-query'
import type { Vec2 } from './plan-geometry'
import type { SceneNodes } from './types'

export type StairNode = AnyNode & { type: 'stair' }

function toWorldPlanPoint(stair: StairNode, localX: number, localZ: number): Vec2 {
  const [worldX, worldZ] = rotateXZ(localX, localZ, stair.rotation ?? 0)
  return [stair.position[0] + worldX, stair.position[2] + worldZ]
}

/** The floor a stair stands on, in its level's plan frame: a straight stair's segments, a curved or spiral stair's turning circle. */
export function stairFootprintPolygons(nodes: SceneNodes, stair: StairNode): Vec2[][] {
  if (stair.stairType === 'curved' || stair.stairType === 'spiral') {
    const radius = Math.max(0.05, stair.innerRadius ?? 0.9) + Math.max(stair.width ?? 1, 0.4)
    return [
      Array.from({ length: 24 }).map((_, index) => {
        const angle = (index / 24) * Math.PI * 2
        return toWorldPlanPoint(stair, Math.cos(angle) * radius, Math.sin(angle) * radius)
      }),
    ]
  }

  const segments = (stair.children ?? [])
    .map((childId) => nodes[childId])
    .filter((node): node is AnyNode & { type: 'stair-segment' } => node?.type === 'stair-segment')
  const usableSegments =
    segments.length > 0
      ? segments
      : [
          {
            width: stair.width ?? 1,
            length: 3,
            height: resolveStairTotalRise(stair, nodes as Record<string, AnyNode>),
            stepCount: stair.stepCount ?? 10,
            attachmentSide: 'front' as const,
          },
        ]
  const transforms = computeSegmentTransforms(usableSegments)

  return usableSegments.map((segment, index) => {
    const transform = transforms[index] ?? {
      position: [0, 0, 0] as [number, number, number],
      rotation: 0,
    }
    const halfWidth = segment.width / 2
    const corners: Vec2[] = [
      [-halfWidth, 0],
      [halfWidth, 0],
      [halfWidth, segment.length],
      [-halfWidth, segment.length],
    ]
    return corners.map(([localX, localZ]) => {
      const [rx, rz] = rotateXZ(localX, localZ, transform.rotation)
      return toWorldPlanPoint(stair, transform.position[0] + rx, transform.position[2] + rz)
    })
  })
}
