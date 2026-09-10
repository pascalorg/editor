import {
  getWallBaseElevationForNodes,
  getWallEffectiveHeightForNodes,
} from '../../hooks/spatial-grid/spatial-grid-manager'
import { resolveLevelId } from '../../hooks/spatial-grid/spatial-grid-sync'
import type { AnyNode, LevelNode, RoofNode, RoofSegmentNode, WallNode } from '../../schema'
import { findLevelBelowId, getLevelElevations } from '../../services/storey'
import { getWallArcData } from '../wall/wall-curve'
import { resolveRoomRoofFootprintOnLevel } from './roof-footprint'

export function resolveRoofWallTopElevation(
  targetLevelId: LevelNode['id'],
  wall: WallNode,
  nodes: Readonly<Record<string, AnyNode>>,
  elevations = getLevelElevations(nodes),
): number {
  const sourceLevelY = elevations.get(resolveLevelId(wall, nodes))?.baseY ?? 0
  const targetLevelY = elevations.get(targetLevelId)?.baseY ?? 0
  return (
    sourceLevelY +
    getWallBaseElevationForNodes(wall, nodes) +
    getWallEffectiveHeightForNodes(wall, nodes) -
    targetLevelY
  )
}

export function resolveRoofElevation(
  roof: RoofNode,
  nodes: Readonly<Record<string, AnyNode>>,
): number {
  if (roof.support?.kind !== 'walls') return roof.position[1]
  const levelId = resolveLevelId(roof, nodes)
  if (nodes[levelId]?.type !== 'level') return roof.position[1]
  const elevations = getLevelElevations(nodes)
  const belowId = findLevelBelowId(levelId, elevations)
  const below = belowId ? nodes[belowId] : undefined
  if (below?.type !== 'level') return roof.position[1]

  const conicalSegments = roof.children
    .map((id) => nodes[id])
    .filter(
      (node): node is RoofSegmentNode =>
        node?.type === 'roof-segment' && node.roofType === 'conical',
    )
  const wallIds = conicalSegments.length
    ? below.children.filter((id) => {
        const wall = nodes[id]
        if (wall?.type !== 'wall') return false
        const arc = getWallArcData(wall)
        if (!arc) return false
        const cos = Math.cos(roof.rotation)
        const sin = Math.sin(roof.rotation)
        return conicalSegments.some((segment) => {
          const centerX = roof.position[0] + segment.position[0] * cos + segment.position[2] * sin
          const centerZ = roof.position[2] - segment.position[0] * sin + segment.position[2] * cos
          return (
            Math.hypot(arc.center.x - centerX, arc.center.y - centerZ) <= 1e-4 &&
            Math.abs(arc.radius - segment.width / 2) <= 1e-4
          )
        })
      })
    : (resolveRoomRoofFootprintOnLevel(below.id, nodes, [roof.position[0], roof.position[2]])
        ?.wallIds ?? [])

  let highest: number | undefined
  for (const id of wallIds) {
    const wall = nodes[id]
    if (wall?.type !== 'wall') continue
    const top = resolveRoofWallTopElevation(levelId as LevelNode['id'], wall, nodes, elevations)
    highest = highest === undefined ? top : Math.max(highest, top)
  }
  return highest ?? roof.position[1]
}
