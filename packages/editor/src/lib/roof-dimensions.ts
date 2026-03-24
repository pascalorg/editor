import type { AnyNode, RoofNode, RoofSegmentNode } from '@pascal-app/core'

type LegacyRoofDimensions = {
  length?: number
  height?: number
  leftWidth?: number
  rightWidth?: number
}

const DEFAULT_ROOF_LENGTH = 8
const DEFAULT_ROOF_HEIGHT = 2.5
const DEFAULT_ROOF_SIDE_WIDTH = 3

export function getRoofDimensions(
  roof: RoofNode,
  nodes: Record<string, AnyNode>,
): {
  length: number
  height: number
  leftWidth: number
  rightWidth: number
  totalWidth: number
  primarySegment: RoofSegmentNode | null
} {
  const legacyRoof = roof as RoofNode & LegacyRoofDimensions
  const primarySegment =
    (roof.children ?? [])
      .map((childId) => nodes[childId])
      .find((child): child is RoofSegmentNode => child?.type === 'roof-segment') ?? null

  const length =
    typeof legacyRoof.length === 'number'
      ? legacyRoof.length
      : (primarySegment?.width ?? DEFAULT_ROOF_LENGTH)
  const height =
    typeof legacyRoof.height === 'number'
      ? legacyRoof.height
      : (primarySegment?.roofHeight ?? DEFAULT_ROOF_HEIGHT)
  const leftWidth =
    typeof legacyRoof.leftWidth === 'number'
      ? legacyRoof.leftWidth
      : primarySegment
        ? primarySegment.depth / 2
        : DEFAULT_ROOF_SIDE_WIDTH
  const rightWidth =
    typeof legacyRoof.rightWidth === 'number'
      ? legacyRoof.rightWidth
      : primarySegment
        ? primarySegment.depth / 2
        : DEFAULT_ROOF_SIDE_WIDTH

  return {
    length,
    height,
    leftWidth,
    rightWidth,
    totalWidth: leftWidth + rightWidth,
    primarySegment,
  }
}
