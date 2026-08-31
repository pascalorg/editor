import {
  type AnyNode,
  type AnyNodeId,
  getLevelBelow,
  getLevelElevations,
  getWallArcData,
  getWallBaseElevationForNodes,
  getWallEffectiveHeightForNodes,
  type LevelNode,
  RoofNode,
  RoofSegmentNode,
  resolveLevelId,
  type SceneApi,
  type WallNode,
} from '@pascal-app/core'

const DEFAULT_CONICAL_ROOF_PITCH = 40

export function createConicalRoofSectorAboveWall(
  wall: WallNode,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  sceneApi: SceneApi,
  targetLevelId: LevelNode['id'],
): RoofSegmentNode['id'] | null {
  const arc = getWallArcData(wall)
  if (!(arc && nodes[targetLevelId]?.type === 'level')) return null
  const completeNodes = nodes as Record<string, AnyNode>
  const sourceLevelId = resolveLevelId(wall, completeNodes)
  const levelBelowId = getLevelBelow(targetLevelId, completeNodes)?.id
  if (sourceLevelId !== targetLevelId && sourceLevelId !== levelBelowId) return null

  const existingRoof = Object.values(nodes).find(
    (node): node is RoofNode =>
      node.type === 'roof' &&
      node.parentId === targetLevelId &&
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

  const elevations = getLevelElevations(completeNodes)
  const sourceLevelY = elevations.get(resolveLevelId(wall, completeNodes))?.baseY ?? 0
  const targetLevelY = elevations.get(targetLevelId)?.baseY ?? 0

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
  const roof = RoofNode.parse({
    name: `Roof ${roofCount + 1}`,
    metadata: { conicalSourceWallId: wall.id },
    position: [
      arc.center.x,
      Math.max(
        0,
        sourceLevelY +
          getWallBaseElevationForNodes(wall, completeNodes) +
          getWallEffectiveHeightForNodes(wall, completeNodes) -
          targetLevelY,
      ),
      arc.center.y,
    ],
    children: [segment.id],
  })

  const ops = [
    { node: roof, parentId: targetLevelId as AnyNodeId },
    { node: segment, parentId: roof.id as AnyNodeId },
  ]
  if (sceneApi.createMany) sceneApi.createMany(ops)
  else for (const op of ops) sceneApi.upsert(op.node, op.parentId)
  return segment.id
}
