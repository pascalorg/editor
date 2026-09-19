import { getClampedWallCurveOffset, getWallCurveLength, type WallNode } from '@pascal-app/core'

export function buildWallLengthPatch(node: WallNode, nextLength: number): Partial<WallNode> {
  const length = getWallCurveLength(node)
  if (!length || !Number.isFinite(nextLength) || nextLength <= 0) return {}
  const ratio = nextLength / length
  return {
    end: [
      node.start[0] + (node.end[0] - node.start[0]) * ratio,
      node.start[1] + (node.end[1] - node.start[1]) * ratio,
    ],
    ...(node.curveOffset ? { curveOffset: getClampedWallCurveOffset(node) * ratio } : {}),
  }
}
