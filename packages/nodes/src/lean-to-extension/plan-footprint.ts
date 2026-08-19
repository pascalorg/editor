import type { LeanToExtensionNode, WallNode } from '@pascal-app/core'
import { bendLocalPoint, isCurvedLeanTo } from './arc'
import { leanToWallLocalPose, resolveLeanToLayout } from './layout'

export type LeanToPlanPoint = readonly [number, number]
export type LeanToPlanFacet = readonly [
  LeanToPlanPoint,
  LeanToPlanPoint,
  LeanToPlanPoint,
  LeanToPlanPoint,
]

export function leanToPlanFootprintFacets(
  node: LeanToExtensionNode,
  wall: WallNode,
): LeanToPlanFacet[] {
  const layout = resolveLeanToLayout(node)
  const pose = leanToWallLocalPose(wall, node, 0)
  const cos = Math.cos(pose.rotationY)
  const sin = Math.sin(pose.rotationY)
  const toPlan = (localX: number, localZ: number): LeanToPlanPoint => {
    const point = bendLocalPoint(node, localX, localZ)
    return [
      pose.position[0] + point.x * cos + point.y * sin,
      pose.position[2] - point.x * sin + point.y * cos,
    ]
  }
  const left = layout.span / 2 + node.leftOverhang
  const right = layout.span / 2 + node.rightOverhang
  const high = -node.highOverhang
  const low = layout.projection + node.lowOverhang
  const count = isCurvedLeanTo(node) ? Math.max(4, Math.min(32, Math.ceil(node.span / 0.4))) : 1
  const facets: LeanToPlanFacet[] = []
  for (let index = 0; index < count; index++) {
    const startX = -left + ((right + left) * index) / count
    const endX = -left + ((right + left) * (index + 1)) / count
    facets.push([toPlan(startX, high), toPlan(endX, high), toPlan(endX, low), toPlan(startX, low)])
  }
  return facets
}
