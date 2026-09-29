import { floorConstructionLift } from '../lib/floor-construction-lift'
import { isFloorAnchoredOpening } from '../lib/floor-opening-footprints'
import {
  getOpeningFloorDatum,
  getOpeningFloorTarget,
  wallSupportForNodes,
} from '../lib/opening-floor-datum'
import { levelBaseElevationAt } from '../lib/terrain-support-query'
import type { AnyNode, SlabNode, WallNode } from '../schema'
import { findLevelBelowId, getAuthoredLevelElevations, getWallPlaneTops } from '../services/storey'
import { computeWallSlabSupport, type WallSlabSupport } from '../systems/slab/slab-support'
import { resolveWallTop } from '../systems/wall/wall-top'

const legacySupports = new Map<string, Map<string, WallSlabSupport>>()

export function legacyWallElevations(
  walls: WallNode[],
  slabs: SlabNode[],
  nodes: Readonly<Record<string, AnyNode>>,
  levelId: string,
) {
  const orderedWalls = [...walls].sort((a, b) => a.id.localeCompare(b.id))
  const orderedSlabs = [...slabs].sort((a, b) => a.id.localeCompare(b.id))
  const signature = JSON.stringify([
    orderedWalls.map((wall) => [
      wall.id,
      wall.start,
      wall.end,
      wall.thickness,
      wall.justification,
      wall.curveOffset,
      wall.supportOffset,
      wall.supportSlabId,
      levelBaseElevationAt(nodes, levelId, ...wall.start),
    ]),
    orderedSlabs.map((slab) => [
      slab.id,
      slab.polygon,
      slab.holes,
      slab.elevation,
      slab.thickness,
      slab.autoFromWalls,
      slab.recessed,
    ]),
  ])
  const cached = legacySupports.get(signature)
  if (cached) return cached
  const legacySlabs = orderedSlabs.map((slab) => ({
    ...slab,
    boundary: undefined,
    plateRole: undefined,
    support: undefined,
  }))
  const supports = new Map(
    orderedWalls.map((wall) => [
      wall.id as string,
      computeWallSlabSupport(
        wall,
        legacySlabs,
        orderedWalls,
        wall.supportSlabId,
        undefined,
        levelBaseElevationAt(nodes, levelId, ...wall.start),
      ),
    ]),
  )
  legacySupports.set(signature, supports)
  if (legacySupports.size > 32) legacySupports.delete(legacySupports.keys().next().value!)
  return supports
}

/** Preserve production datums once, before a level first acquires derived plates. */
export function preserveLegacyWallDatums(
  before: Readonly<Record<string, AnyNode>>,
  after: Record<string, AnyNode>,
): Record<string, AnyNode> {
  const values = Object.values(before)
  const migrated = Object.values(after).some(
    (node) =>
      node.type === 'level' &&
      node.metadata?.floorOwnershipMigrated === true &&
      (before[node.id] as typeof node | undefined)?.metadata?.floorOwnershipMigrated !== true,
  )
  const newBaseLevels = new Set(
    Object.values(after).flatMap((node) =>
      node.type === 'slab' && node.plateRole === 'base' && node.parentId && !before[node.id]
        ? [node.parentId]
        : [],
    ),
  )
  const legacyRoomPlate =
    !migrated &&
    Object.values(after).some(
      (node) =>
        node.type === 'zone' &&
        node.autoFromWalls &&
        !before[node.id] &&
        node.parentId &&
        newBaseLevels.has(node.parentId),
    )
  const pendingLegacyRoomPlate =
    !migrated &&
    [...newBaseLevels].some(
      (id) => before[id]?.type === 'level' && before[id].metadata?.legacyRoomMigrationPending,
    )
  if (
    !migrated &&
    !legacyRoomPlate &&
    !pendingLegacyRoomPlate &&
    !values.some((node) => node.type === 'slab' && node.autoFromWalls && !node.plateRole)
  )
    return after
  const existing = new Set(
    values.flatMap((node) => (node.type === 'slab' && node.plateRole ? [node.parentId] : [])),
  )
  const legacyLevels = [
    ...new Set(
      values.flatMap((node) =>
        node.type === 'wall' && node.parentId && !existing.has(node.parentId)
          ? [node.parentId]
          : [],
      ),
    ),
  ]
  for (const slab of values) {
    if (
      slab.type === 'slab' &&
      slab.autoFromWalls &&
      !slab.plateRole &&
      slab.parentId &&
      !legacyLevels.includes(slab.parentId)
    )
      legacyLevels.push(slab.parentId)
  }

  const elevations = getAuthoredLevelElevations(before)
  for (const levelId of [...legacyLevels]) {
    const below = findLevelBelowId(levelId, elevations)
    if (below && !existing.has(below) && !legacyLevels.includes(below)) legacyLevels.push(below)
  }

  let nodes = after
  const write = (node: AnyNode) => {
    if (nodes === after) nodes = { ...after }
    nodes[node.id] = node
  }
  for (const levelId of legacyLevels) {
    const walls = values.filter((n): n is WallNode => n.type === 'wall' && n.parentId === levelId)
    const slabs = values
      .filter((n): n is SlabNode => n.type === 'slab' && n.parentId === levelId)
      .map((slab) => ({ ...slab, boundary: undefined, support: undefined }))
    const oldSupports = legacyWallElevations(walls, slabs, before, levelId)
    const oldPlanes = getWallPlaneTops(
      walls.filter((wall) => wall.height === undefined),
      levelId,
      before,
    )
    const currentWalls = walls
      .map((wall) => after[wall.id])
      .filter((wall): wall is WallNode => wall?.type === 'wall' && wall.height === undefined)
    const newPlanes = getWallPlaneTops(currentWalls, levelId, after)
    for (const wall of walls) {
      let current = after[wall.id]
      if (current?.type !== 'wall') continue
      const old = oldSupports.get(wall.id)!
      let next = wallSupportForNodes(current, after)
      if (Math.abs(next.elevation - old.elevation) > 1e-3) {
        const oldSupport = old.electedSlabId ? after[old.electedSlabId] : undefined
        const keepSlab =
          oldSupport?.type === 'slab' &&
          Math.abs(oldSupport.elevation - old.elevation) <= 1e-3 &&
          Math.abs(
            wallSupportForNodes(
              {
                ...current,
                supportSlabId: oldSupport.id,
                supportOffset: old.elevation - oldSupport.elevation,
              },
              after,
            ).elevation - old.elevation,
          ) <= 1e-3
        const ground = levelBaseElevationAt(after, levelId, ...current.start)
        current = {
          ...current,
          supportSlabId: keepSlab ? oldSupport.id : 'ground',
          supportOffset: keepSlab
            ? old.elevation - oldSupport.elevation
            : old.elevation - ground - floorConstructionLift(after, current),
        }
        write(current)
        next = wallSupportForNodes(current, nodes)
      }
      // Datums read the wall as it now stands (a kept legacy support included).
      const datumWall = current
      const oldTop =
        wall.height === undefined
          ? oldPlanes.get(wall.id)!
          : (wall.supportSlabId === 'ground' ? old.elevation : Math.max(0, old.elevation)) +
            wall.height
      const newTop = resolveWallTop(current, newPlanes.get(current.id) ?? 0, next.elevation)
      const patch: Partial<WallNode> = {}
      if (Math.abs(oldTop - newTop) > 1e-6) patch.height = oldTop - next.elevation
      const delta = old.elevation - next.elevation
      if (current.faceRegions?.length && Math.abs(delta) > 1e-6)
        patch.faceRegions = current.faceRegions.map((region) => {
          // Existing regions may already have moved in M4; converted bands have not.
          const source = wall.faceRegions?.find((old) => old.id === region.id) ?? region
          const { v0: _v0, v1: _v1, ...rest } = region
          return {
            ...rest,
            ...(source.v0 === undefined ? {} : { v0: Math.round((source.v0 + delta) * 1e6) / 1e6 }),
            ...(source.v1 === undefined ? {} : { v1: Math.round((source.v1 + delta) * 1e6) / 1e6 }),
          }
        })
      if (Object.keys(patch).length) write({ ...current, ...patch })
      for (const id of wall.children ?? []) {
        const opening = before[id],
          current = after[id]
        if (
          (opening?.type !== 'door' && opening?.type !== 'window') ||
          (current?.type !== 'door' && current?.type !== 'window') ||
          !opening.position ||
          !current.position
        )
          continue
        const legacyOpening = {
          ...current,
          ...opening,
          position: opening.position ?? current.position,
          height: opening.height ?? current.height,
        }
        const floorAnchored = isFloorAnchoredOpening(legacyOpening)
        const datum = getOpeningFloorDatum(datumWall, legacyOpening, nodes)
        let y = legacyOpening.position[1] + old.elevation - datum
        let anchor: 'floor' | 'wall' = floorAnchored ? 'floor' : 'wall'
        const movedOpening = {
          ...legacyOpening,
          verticalAnchor: 'floor' as const,
          position: [legacyOpening.position[0], y, legacyOpening.position[2]] as [
            number,
            number,
            number,
          ],
        }
        if (
          floorAnchored &&
          (Math.abs(getOpeningFloorTarget(datumWall, legacyOpening, nodes) - datum) > 1e-6 ||
            Math.abs(getOpeningFloorDatum(datumWall, movedOpening, nodes) - datum) > 1e-6)
        ) {
          anchor = 'wall'
          y = legacyOpening.position[1] + old.elevation - next.elevation
        }
        if (Math.abs(y - current.position[1]) > 1e-6 || (anchor === 'wall' && floorAnchored))
          write({
            ...current,
            verticalAnchor: anchor,
            position: [current.position[0], Math.round(y * 1e6) / 1e6, current.position[2]],
          })
      }
    }
  }
  return nodes
}
