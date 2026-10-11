import {
  getWallBaseElevationForNodes,
  getWallEffectiveHeightForNodes,
} from '../../hooks/spatial-grid/spatial-grid-manager'
import { resolveLevelId } from '../../hooks/spatial-grid/spatial-grid-sync'
import { findLevelAncestorId } from '../../lib/node-ancestry'
import { queryNodes } from '../../runtime/node-queries'
import type {
  AnyNode,
  AnyNodeId,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  WallNode,
} from '../../schema'
import { findLevelAboveId, findLevelBelowId, getLevelElevations } from '../../services/storey'
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

const ROOF_ELEVATION_EPSILON = 1e-4

/** Kinds whose change can move a wall-supported roof. */
export function isRoofElevationInput(node: AnyNode | undefined): boolean {
  return (
    node?.type === 'roof' ||
    node?.type === 'wall' ||
    node?.type === 'slab' ||
    node?.type === 'level' ||
    node?.type === 'building' ||
    node?.type === 'site'
  )
}

/** Wall-supported roofs whose stored Y no longer sits on their walls, and where it should. */
export function planRoofElevationUpdates(
  nodes: Readonly<Record<string, AnyNode>>,
  only?: ReadonlySet<string> | null,
): Array<{ id: AnyNodeId; data: Partial<AnyNode> }> {
  const updates: Array<{ id: AnyNodeId; data: Partial<AnyNode> }> = []
  for (const node of queryNodes<RoofNode>(nodes, { type: 'roof' })) {
    if (node.support?.kind !== 'walls' || (only && !only.has(node.id))) continue
    const elevation = resolveRoofElevation(node, nodes)
    if (Math.abs(node.position[1] - elevation) <= ROOF_ELEVATION_EPSILON) continue
    updates.push({
      id: node.id,
      data: { position: [node.position[0], elevation, node.position[2]] },
    })
  }
  return updates
}

/**
 * The roofs an edit can move, from the nodes it changed: a roof itself, and the roofs on the level
 * of a changed wall or slab and on the level above it (a roof rests on its own level's walls or
 * the level's below). Null, for every roof, when a level, building or site changed.
 */
export function roofsAffectedBy(
  before: Readonly<Record<string, AnyNode>>,
  after: Readonly<Record<string, AnyNode>>,
  changedIds: Iterable<string>,
): Set<string> | null {
  const roofs = new Set<string>()
  const levels = new Set<string>()
  for (const id of changedIds)
    for (const nodes of [before, after]) {
      const node = nodes[id]
      if (!node) continue
      if (node.type === 'level' || node.type === 'building' || node.type === 'site') return null
      if (node.type === 'roof') roofs.add(id)
      else if (node.type === 'wall' || node.type === 'slab') {
        const levelId = findLevelAncestorId(id as AnyNodeId, nodes as Record<string, AnyNode>)
        if (!levelId) return null
        levels.add(levelId)
        const above = findLevelAboveId(
          levelId,
          getLevelElevations(nodes as Record<string, AnyNode>),
        )
        if (above) levels.add(above)
      }
    }
  if (levels.size)
    for (const roof of queryNodes<RoofNode>(after as Record<string, AnyNode>, { type: 'roof' })) {
      const levelId = findLevelAncestorId(roof.id, after as Record<string, AnyNode>)
      if (levelId && levels.has(levelId)) roofs.add(roof.id)
    }
  return roofs
}
