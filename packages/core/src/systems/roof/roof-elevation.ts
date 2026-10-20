import { findLevelAncestorId, resolveLevelId } from '../../lib/node-ancestry'
import { wallSupportForNodes } from '../../lib/opening-floor-datum'
import { queryNodes } from '../../runtime/node-queries'
import type {
  AnyNode,
  AnyNodeId,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  WallNode,
} from '../../schema'
import { coveredStoreyId, servesAsRoofLevel } from '../../services/roof-level'
import {
  findLevelAboveId,
  findLevelBelowId,
  getLevelElevations,
  getWallTop,
} from '../../services/storey'
import { wallOverlapsSlabFootprint } from '../slab/slab-support'
import { getWallArcData } from '../wall/wall-curve'
import { resolveRoomRoofFootprintOnLevel } from './roof-footprint'

export function resolveRoofWallTopElevation(
  targetLevelId: LevelNode['id'],
  wall: WallNode,
  nodes: Readonly<Record<string, AnyNode>>,
  elevations = getLevelElevations(nodes),
): number {
  const sourceLevelId = resolveLevelId(wall, nodes)
  const sourceLevelY = elevations.get(sourceLevelId)?.baseY ?? 0
  const targetLevelY = elevations.get(targetLevelId)?.baseY ?? 0
  const support = wallSupportForNodes(wall, nodes)
  return sourceLevelY + getWallTop(wall, sourceLevelId, nodes, support.elevation) - targetLevelY
}

/**
 * The walls among `wallIds` a roof stands on: those under its segments' footprints, closed room or
 * not (a room missing a wall, an L-shaped room whose centre falls outside, or a redrawn enclosure
 * all still hold the roof up); a cone's, its round wall. Null for a roof with no segments yet.
 */
function wallsUnderRoof(
  roof: RoofNode,
  nodes: Readonly<Record<string, AnyNode>>,
  wallIds: readonly string[],
): string[] | null {
  const segments = roof.children
    .map((id) => nodes[id])
    .filter((node): node is RoofSegmentNode => node?.type === 'roof-segment')
  if (segments.length === 0) return null
  const cos = Math.cos(roof.rotation)
  const sin = Math.sin(roof.rotation)
  const toLevel = (x: number, z: number): [number, number] => [
    roof.position[0] + x * cos + z * sin,
    roof.position[2] - x * sin + z * cos,
  ]
  const conicalSegments = segments.filter((segment) => segment.roofType === 'conical')
  if (conicalSegments.length)
    return wallIds.filter((id) => {
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
  // The band test is curve- and thickness-aware and boundary-inclusive, so perimeter walls on the
  // footprint edge count.
  const footprints = segments.map((segment) => {
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
  return wallIds.filter((id) => {
    const wall = nodes[id]
    return (
      wall?.type === 'wall' &&
      footprints.some((polygon) => wallOverlapsSlabFootprint(wall, polygon))
    )
  })
}

/** The tallest of these walls' tops, from `targetLevelId`'s floor; undefined for none. */
function highestWallTop(
  targetLevelId: string,
  wallIds: readonly string[],
  nodes: Readonly<Record<string, AnyNode>>,
  elevations: ReturnType<typeof getLevelElevations>,
): number | undefined {
  let highest: number | undefined
  for (const id of wallIds) {
    const wall = nodes[id]
    if (wall?.type !== 'wall') continue
    const top = resolveRoofWallTopElevation(
      targetLevelId as LevelNode['id'],
      wall,
      nodes,
      elevations,
    )
    highest = highest === undefined ? top : Math.max(highest, top)
  }
  return highest
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
  // A lower wing's roof on the storey above stands on the walls below only: that storey's own
  // walls along the wing's edge would lift it to their tops.
  const level = nodes[levelId] as LevelNode
  const supportLevelIds =
    belowId && !servesAsRoofLevel(nodes, level) && coveredStoreyId(nodes, roof) === belowId
      ? [belowId]
      : [levelId, belowId]
  const candidateWallIds = supportLevelIds
    .map((id) => (id ? nodes[id] : undefined))
    .filter((node): node is LevelNode => node?.type === 'level')
    .flatMap((level) => level.children)
  const wallIds =
    wallsUnderRoof(roof, nodes, candidateWallIds) ??
    supportLevelIds
      .map((id) =>
        id
          ? resolveRoomRoofFootprintOnLevel(id as LevelNode['id'], nodes, [
              roof.position[0],
              roof.position[2],
            ])
          : null,
      )
      .find((target) => target !== null)?.wallIds ??
    []
  return highestWallTop(levelId, wallIds, nodes, elevations) ?? roof.position[1]
}

/**
 * The tallest top of `levelId`'s walls a roof stands on, from the floor of the level holding the
 * roof (m); null when it stands on none of them, or has no segments to stand with.
 */
export function roofWallTop(
  roof: RoofNode,
  nodes: Readonly<Record<string, AnyNode>>,
  levelId: string,
): number | null {
  const level = nodes[levelId]
  if (level?.type !== 'level') return null
  const wallIds = wallsUnderRoof(roof, nodes, level.children)
  if (!wallIds) return null
  return (
    highestWallTop(resolveLevelId(roof, nodes), wallIds, nodes, getLevelElevations(nodes)) ?? null
  )
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
 * The roofs an edit can move, from the nodes it changed. A roof rests on the walls of its own level
 * or the level below, so: a changed roof (or segment); for a changed wall, the roofs on its level
 * and the level above; for a changed slab, the levels whose walls it touches (its own, which it
 * carries, and the one below, whose plane-bound tops it caps) and every level above it in its
 * building (a base plate lifts them). Null, for every roof, when a level, building or site changed.
 */
export function roofsAffectedBy(
  before: Readonly<Record<string, AnyNode>>,
  after: Readonly<Record<string, AnyNode>>,
  changedIds: Iterable<string>,
): Set<string> | null {
  const roofs = new Set<string>()
  const levels = new Set<string>()
  for (const id of changedIds)
    for (const nodes of [before, after] as const) {
      const node = nodes[id]
      if (!node) continue
      if (node.type === 'level' || node.type === 'building' || node.type === 'site') return null
      if (node.type === 'roof') roofs.add(id)
      else if (node.type === 'roof-segment' && node.parentId) roofs.add(node.parentId)
      else if (node.type === 'wall' || node.type === 'slab') {
        const levelId = findLevelAncestorId(id as AnyNodeId, nodes as Record<string, AnyNode>)
        if (!levelId) return null
        const elevations = getLevelElevations(nodes as Record<string, AnyNode>)
        levels.add(levelId)
        if (node.type === 'wall') {
          const above = findLevelAboveId(levelId, elevations)
          if (above) levels.add(above)
          continue
        }
        const below = findLevelBelowId(levelId, elevations)
        if (below) levels.add(below)
        const own = elevations.get(levelId)
        for (const [otherId, other] of elevations)
          if (own && other.buildingId === own.buildingId && other.ordinal > own.ordinal)
            levels.add(otherId)
      }
    }
  if (levels.size)
    for (const roof of queryNodes<RoofNode>(after as Record<string, AnyNode>, { type: 'roof' })) {
      const levelId = findLevelAncestorId(roof.id, after as Record<string, AnyNode>)
      if (levelId && levels.has(levelId)) roofs.add(roof.id)
    }
  return roofs
}
