import type { FloorPlacedFootprint } from '../../registry/types'
import type { AnyNode, AnyNodeId, StairNode, StairSegmentNode } from '../../schema'
import { resolveStairConstruction } from './stair-construction'
import { computeSegmentTransforms, rotateXZ } from './stair-footprint'
import { resolveStairArcDimensions } from './stair-layout'
import { resolveStairWinder } from './stair-winder'

export function getStairFloorPlacedFootprints(
  stair: StairNode,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
): FloorPlacedFootprint[] {
  if ((stair.stairType ?? 'straight') !== 'straight') {
    return getArcStairFloorPlacedFootprints(stair)
  }

  const segments = (stair.children ?? [])
    .map((childId) => nodes[childId as AnyNodeId])
    .filter((node): node is StairSegmentNode => node?.type === 'stair-segment')

  return getStairSegmentFloorPlacedFootprints(stair, segments)
}

const MAX_ARC_FOOTPRINT_SWEEP = Math.PI / 12

function getArcStairFloorPlacedFootprints(stair: StairNode): FloorPlacedFootprint[] {
  const isSpiral = stair.stairType === 'spiral'
  const layout = resolveStairArcDimensions(stair, 0)
  const { innerRadius, outerRadius } = layout
  const sweepAngle =
    Math.sign(layout.sweepAngle || 1) *
    Math.min(Math.abs(layout.sweepAngle + layout.nosingSweep), Math.PI * 2)
  const footprints: FloorPlacedFootprint[] = []

  const ranges = [
    { start: -layout.sweepAngle / 2 - layout.nosingSweep, sweep: sweepAngle },
    ...(layout.landingSweep ? [{ start: layout.sweepAngle / 2, sweep: layout.landingSweep }] : []),
  ]
  for (const range of ranges) {
    const sliceCount = Math.max(1, Math.ceil(Math.abs(range.sweep) / MAX_ARC_FOOTPRINT_SWEEP))
    for (let index = 0; index < sliceCount; index += 1) {
      const startAngle = range.start + (range.sweep * index) / sliceCount
      const endAngle = range.start + (range.sweep * (index + 1)) / sliceCount
      const midAngle = (startAngle + endAngle) / 2
      const halfSweep = Math.abs(endAngle - startAngle) / 2
      const projectedInnerRadius = innerRadius * Math.cos(halfSweep)
      const radialSize = outerRadius - projectedInnerRadius
      const tangentialSize = 2 * outerRadius * Math.sin(halfSweep)
      const centerRadius = (outerRadius + projectedInnerRadius) / 2
      const [offsetX, offsetZ] = rotateXZ(
        Math.cos(midAngle) * centerRadius,
        Math.sin(midAngle) * centerRadius,
        stair.rotation ?? 0,
      )

      footprints.push({
        position: [stair.position[0] + offsetX, stair.position[1], stair.position[2] + offsetZ],
        dimensions: [
          Math.max(radialSize, Number.EPSILON),
          0.01,
          Math.max(tangentialSize, Number.EPSILON),
        ],
        rotation: [0, midAngle - (stair.rotation ?? 0), 0],
      })
    }
  }

  if (isSpiral && (stair.showCenterColumn ?? true)) {
    const columnRadius = Math.min(
      innerRadius * 0.72,
      Math.max(innerRadius - 0.03, innerRadius * 0.5),
    )
    footprints.push({
      position: stair.position,
      dimensions: [columnRadius * 2, 0.01, columnRadius * 2],
      rotation: [0, 0, 0],
    })
  }

  return footprints
}

export function getStairSegmentFloorPlacedFootprints(
  stair: StairNode,
  segments: readonly StairSegmentNode[],
): FloorPlacedFootprint[] {
  const transforms = computeStairSegmentFloorStackTransforms(segments)

  return segments.flatMap((segment, index) => {
    const transform = transforms[index]!
    const winder = resolveStairWinder(segment)
    if (winder) {
      // Two rectangular legs exactly cover the square ring without filling its inner gap.
      const gap = segment.winder!.innerGap,
        width = segment.width,
        sign = segment.winder!.turn === 'left' ? -1 : 1
      const pivot = sign * (gap + width / 2)
      const nose =
        ((resolveStairConstruction(segment, stair)?.nosing ?? 0) * (gap + width)) /
        (gap + segment.winder!.walkingLineOffset)
      return [
        [pivot - sign * (gap + width / 2), (gap + width - nose) / 2, width, gap + width + nose],
        [pivot - (sign * gap) / 2, gap + width / 2, gap, width],
      ]
        .filter((rect) => rect[2]! > 0)
        .map(([x, z, w, d]) => {
          const [sx, sz] = rotateXZ(x!, z!, transform.rotation)
          const [wx, wz] = rotateXZ(
            transform.position[0] + sx,
            transform.position[2] + sz,
            stair.rotation,
          )
          return {
            position: [
              stair.position[0] + wx,
              stair.position[1] + transform.position[1],
              stair.position[2] + wz,
            ] as [number, number, number],
            dimensions: [w!, Math.max(segment.height, segment.thickness, 0.01), d!] as [
              number,
              number,
              number,
            ],
            rotation: [0, stair.rotation + transform.rotation, 0] as [number, number, number],
          }
        })
    }
    const nose =
      segment.segmentType === 'landing'
        ? 0
        : (resolveStairConstruction(segment, stair)?.nosing ?? 0)
    const [centerOffsetX, centerOffsetZ] = rotateXZ(
      0,
      (segment.length - nose) / 2,
      transform.rotation,
    )
    const centerInGroupX = transform.position[0] + centerOffsetX
    const centerInGroupZ = transform.position[2] + centerOffsetZ
    const [centerOffsetWorldX, centerOffsetWorldZ] = rotateXZ(
      centerInGroupX,
      centerInGroupZ,
      stair.rotation ?? 0,
    )

    return [
      {
        position: [
          stair.position[0] + centerOffsetWorldX,
          stair.position[1] + transform.position[1],
          stair.position[2] + centerOffsetWorldZ,
        ],
        dimensions: [
          segment.width,
          Math.max(segment.height, segment.thickness, 0.01),
          segment.length + nose,
        ],
        rotation: [0, (stair.rotation ?? 0) + transform.rotation, 0],
      },
    ]
  })
}

export const computeStairSegmentFloorStackTransforms = computeSegmentTransforms
