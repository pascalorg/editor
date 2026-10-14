import {
  type AnyNode,
  type AnyNodeId,
  getActiveRoofHeight,
  getLevelBelow,
  getWallArcData,
  type LevelNode,
  RoofNode,
  RoofSegmentNode,
  resolveLevelId,
  resolveRoofWallTopElevation,
  type SceneApi,
  type WallNode,
} from '@pascal-app/core'
import { roofLevelTarget, writeRoofNodes } from './roof-level-target'

const DEFAULT_CONICAL_ROOF_PITCH = 40

/**
 * A cone over a curved wall, picked from the wall's own level or the one above it (`armedLevelId`).
 * It goes where every roof goes (`roofLevelTarget`): on the level directly above the wall's storey.
 */
export function createConicalRoofSectorAboveWall(
  wall: WallNode,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  sceneApi: SceneApi,
  armedLevelId: LevelNode['id'],
): RoofSegmentNode['id'] | null {
  const arc = getWallArcData(wall)
  if (!(arc && nodes[armedLevelId]?.type === 'level')) return null
  const completeNodes = nodes as Record<string, AnyNode>
  const sourceLevelId = resolveLevelId(wall, completeNodes) as LevelNode['id']
  const levelBelowId = getLevelBelow(armedLevelId, completeNodes)?.id
  if (sourceLevelId !== armedLevelId && sourceLevelId !== levelBelowId) return null

  const existingRoof = Object.values(nodes).find(
    (node): node is RoofNode =>
      node.type === 'roof' &&
      typeof node.metadata === 'object' &&
      node.metadata !== null &&
      !Array.isArray(node.metadata) &&
      (node.metadata as Record<string, unknown>).conicalSourceWallId === wall.id,
  )
  if (existingRoof) {
    const existingSegment = existingRoof.children
      .map((childId) => nodes[childId])
      .find((node): node is RoofSegmentNode => node?.type === 'roof-segment')
    if (existingSegment) return existingSegment.id
  }

  const roofCount = Object.values(nodes).filter((node) => node?.type === 'roof').length
  const segment = RoofSegmentNode.parse({
    roofType: 'conical',
    width: arc.radius * 2,
    depth: arc.radius * 2,
    wallHeight: 0,
    pitch: DEFAULT_CONICAL_ROOF_PITCH,
    conicalStartAngle: arc.startAngle,
    conicalSweepAngle: arc.delta,
    conicalFullCircle: true,
  })
  const target = roofLevelTarget(nodes, sourceLevelId, getActiveRoofHeight(segment))
  const roof = RoofNode.parse({
    name: `Roof ${roofCount + 1}`,
    metadata: { conicalSourceWallId: wall.id },
    support: { kind: 'walls' },
    position: [
      arc.center.x,
      resolveRoofWallTopElevation(target.levelId, wall, target.nodes),
      arc.center.y,
    ],
    children: [segment.id],
  })

  writeRoofNodes(sceneApi, target, [
    { node: roof, parentId: target.levelId as AnyNodeId },
    { node: segment, parentId: roof.id as AnyNodeId },
  ])
  return segment.id
}
