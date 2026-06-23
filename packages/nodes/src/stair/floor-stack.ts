import type {
  AnyNode,
  AnyNodeId,
  FloorPlacedFootprint,
  StairNode,
  StairSegmentNode,
} from '@pascal-app/core'

type SegmentTransform = {
  position: [number, number, number]
  rotation: number
}

export function getStairFloorPlacedFootprints(
  stair: StairNode,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
): FloorPlacedFootprint[] {
  const segments = (stair.children ?? [])
    .map((childId) => nodes[childId as AnyNodeId])
    .filter((node): node is StairSegmentNode => node?.type === 'stair-segment')

  return getStairSegmentFloorPlacedFootprints(stair, segments)
}

export function getStairSegmentFloorPlacedFootprints(
  stair: StairNode,
  segments: readonly StairSegmentNode[],
): FloorPlacedFootprint[] {
  const transforms = computeStairSegmentFloorStackTransforms(segments)

  return segments.map((segment, index) => {
    const transform = transforms[index]!
    const [centerOffsetX, centerOffsetZ] = rotateXZ(0, segment.length / 2, transform.rotation)
    const centerInGroupX = transform.position[0] + centerOffsetX
    const centerInGroupZ = transform.position[2] + centerOffsetZ
    const [centerOffsetWorldX, centerOffsetWorldZ] = rotateXZ(
      centerInGroupX,
      centerInGroupZ,
      stair.rotation,
    )

    return {
      position: [
        stair.position[0] + centerOffsetWorldX,
        stair.position[1] + transform.position[1],
        stair.position[2] + centerOffsetWorldZ,
      ],
      dimensions: [
        segment.width,
        Math.max(segment.height, segment.thickness, 0.01),
        segment.length,
      ],
      rotation: [0, stair.rotation + transform.rotation, 0],
    }
  })
}

export function computeStairSegmentFloorStackTransforms(
  segments: readonly StairSegmentNode[],
): SegmentTransform[] {
  const transforms: SegmentTransform[] = []
  let currentX = 0
  let currentY = 0
  let currentZ = 0
  let currentRot = 0

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!

    if (index > 0) {
      const previous = segments[index - 1]!
      let attachX = 0
      let attachZ = 0
      let rotationDelta = 0

      switch (segment.attachmentSide) {
        case 'front':
          attachX = 0
          attachZ = previous.length
          rotationDelta = 0
          break
        case 'left':
          attachX = previous.width / 2
          attachZ = previous.length / 2
          rotationDelta = Math.PI / 2
          break
        case 'right':
          attachX = -previous.width / 2
          attachZ = previous.length / 2
          rotationDelta = -Math.PI / 2
          break
      }

      const [rotatedX, rotatedZ] = rotateXZ(attachX, attachZ, currentRot)
      currentX += rotatedX
      currentY += previous.height
      currentZ += rotatedZ
      currentRot += rotationDelta
    }

    transforms.push({
      position: [currentX, currentY, currentZ],
      rotation: currentRot,
    })
  }

  return transforms
}

function rotateXZ(x: number, z: number, angle: number): [number, number] {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [x * cos + z * sin, -x * sin + z * cos]
}
