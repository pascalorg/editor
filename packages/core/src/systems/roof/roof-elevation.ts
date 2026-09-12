import {
  getWallBaseElevationForNodes,
  getWallEffectiveHeightForNodes,
} from '../../hooks/spatial-grid/spatial-grid-manager'
import { resolveLevelId } from '../../hooks/spatial-grid/spatial-grid-sync'
import type { AnyNode, LevelNode, RoofNode, RoofSegmentNode, WallNode } from '../../schema'
import { findLevelBelowId, getLevelElevations } from '../../services/storey'
import { wallOverlapsSlabFootprint } from '../slab/slab-support'
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
  // A roof usually sits on the storey above its walls, but the top floor (or a
  // roof armed from the walls' own level) keeps roof and walls on one level.
  const belowId = findLevelBelowId(levelId, elevations)
  const candidateWallIds = [levelId, belowId]
    .map((id) => (id ? nodes[id] : undefined))
    .filter((node): node is LevelNode => node?.type === 'level')
    .flatMap((level) => level.children)

  const conicalSegments = roof.children
    .map((id) => nodes[id])
    .filter(
      (node): node is RoofSegmentNode =>
        node?.type === 'roof-segment' && node.roofType === 'conical',
    )
  const cos = Math.cos(roof.rotation)
  const sin = Math.sin(roof.rotation)
  const toLevel = (x: number, z: number): [number, number] => [
    roof.position[0] + x * cos + z * sin,
    roof.position[2] - x * sin + z * cos,
  ]
  // Walls under the footprint, closed room or not: a room missing a wall, an
  // L-shaped room whose centre falls outside, or a redrawn enclosure all still
  // hold the roof up. The band test is curve- and thickness-aware and
  // boundary-inclusive, so perimeter walls on the footprint edge count.
  const footprints = roof.children
    .map((id) => nodes[id])
    .filter((node): node is RoofSegmentNode => node?.type === 'roof-segment')
    .map((segment) => {
      const c = Math.cos(segment.rotation)
      const s = Math.sin(segment.rotation)
      const halfW = segment.width / 2
      const halfD = segment.depth / 2
      const corners: Array<[number, number]> = [
        [-halfW, -halfD],
        [halfW, -halfD],
        [halfW, halfD],
        [-halfW, halfD],
      ]
      return corners.map(([x, z]) =>
        toLevel(segment.position[0] + x * c + z * s, segment.position[2] - x * s + z * c),
      )
    })
  const wallIds = conicalSegments.length
    ? candidateWallIds.filter((id) => {
        const wall = nodes[id]
        if (wall?.type !== 'wall') return false
        const arc = getWallArcData(wall)
        if (!arc) return false
        return conicalSegments.some((segment) => {
          const [centerX, centerZ] = toLevel(segment.position[0], segment.position[2])
          return (
            Math.hypot(arc.center.x - centerX, arc.center.y - centerZ) <= 1e-4 &&
            Math.abs(arc.radius - segment.width / 2) <= 1e-4
          )
        })
      })
    : footprints.length
      ? candidateWallIds.filter((id) => {
          const wall = nodes[id]
          return (
            wall?.type === 'wall' &&
            footprints.some((polygon) => wallOverlapsSlabFootprint(wall, polygon))
          )
        })
      : ([levelId, belowId]
          .map((id) =>
            id
              ? resolveRoomRoofFootprintOnLevel(id as LevelNode['id'], nodes, [
                  roof.position[0],
                  roof.position[2],
                ])
              : null,
          )
          .find((target) => target !== null)?.wallIds ?? [])

  let highest: number | undefined
  for (const id of wallIds) {
    const wall = nodes[id]
    if (wall?.type !== 'wall') continue
    const top = resolveRoofWallTopElevation(levelId as LevelNode['id'], wall, nodes, elevations)
    highest = highest === undefined ? top : Math.max(highest, top)
  }
  return highest ?? roof.position[1]
}
