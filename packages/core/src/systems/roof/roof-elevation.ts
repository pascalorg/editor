import {
  getWallBaseElevationForNodes,
  getWallEffectiveHeightForNodes,
} from '../../hooks/spatial-grid/spatial-grid-manager'
import { resolveLevelId } from '../../hooks/spatial-grid/spatial-grid-sync'
import type { AnyNode, LevelNode, RoofNode, WallNode } from '../../schema'
import { getLevelElevations } from '../../services/storey'

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
  if (!roof.sourceWallIds?.length || roof.support?.kind === 'roof') return roof.position[1]
  const levelId = resolveLevelId(roof, nodes)
  if (nodes[levelId]?.type !== 'level') return roof.position[1]
  const elevations = getLevelElevations(nodes)
  let highest: number | undefined
  for (const id of roof.sourceWallIds) {
    const wall = nodes[id]
    if (wall?.type !== 'wall' || nodes[resolveLevelId(wall, nodes)]?.type !== 'level') continue
    const top = resolveRoofWallTopElevation(levelId as LevelNode['id'], wall, nodes, elevations)
    highest = highest === undefined ? top : Math.max(highest, top)
  }
  // A roof never sinks below its own level's floor plane; a lower-floor wall
  // top is clamped there, as the creation paths always did.
  return highest === undefined ? roof.position[1] : Math.max(0, highest)
}
