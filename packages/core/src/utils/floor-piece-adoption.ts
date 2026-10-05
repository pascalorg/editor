import {
  area,
  containsPoint,
  difference,
  distanceToBoundary,
  intersection,
  type MultiPolygon,
  type Polygon,
  type Ring,
  union,
} from '../lib/polygon-boolean'
import { getRenderableSlabPolygon, prepareSlabPolygonContext } from '../lib/slab-polygon'
import type { AnyNode, SlabNode, WallNode, ZoneNode } from '../schema'
import { calculateLevelMiters, getWallPlanFootprint } from '../systems/wall/wall-footprint'

/**
 * Hand-drawn floor pieces: legacy manual slabs someone drew to be the house
 * floor before rooms generated one. A level's pieces are adopted, all or
 * nothing, when they are the level's only floor inside its rooms: one top and
 * one construction, grounded, no platform or step at another height, nothing
 * reaching more than PIECE_TRIM_DEPTH past the rooms and walls. The load
 * migration then treats them like legacy wall-generated slabs, so one plate
 * replaces the patchwork and each room keeps the finish its piece showed.
 * Drawing noise is the only visible change: strips at most PIECE_TRIM_DEPTH
 * past a facade go, cracks at most PIECE_GAP_WIDTH wide close, and wider
 * uncovered room floor stays open as a hole in the plate.
 */
export const PIECE_TRIM_DEPTH = 0.1
export const PIECE_GAP_WIDTH = 0.05

export type FloorPieceAdoption = {
  /** Adopted piece id → its level id. */
  pieces: Map<string, string>
  /** Per adopted level: uncovered room floor wider than a crack (plate holes). */
  levels: Map<string, { voids: Ring[] }>
}

export function floorPieceFinish(slab: SlabNode) {
  return slab.slots?.surface ?? slab.material ?? slab.materialPreset
}

function tryArea(compute: () => MultiPolygon) {
  try {
    return area(compute())
  } catch {
    return Number.NaN
  }
}

/** Mean width of a part: 2·area / perimeter (the width of a long strip). */
export function partWidth(part: Polygon) {
  let perimeter = 0
  for (const ring of [part.outer, ...part.holes])
    for (const [i, [x, z]] of ring.entries()) {
      const [nx, nz] = ring[(i + 1) % ring.length]!
      perimeter += Math.hypot(nx - x, nz - z)
    }
  return perimeter > 0 ? (2 * area([part])) / perimeter : 0
}

function depthOutside(part: Polygon, from: MultiPolygon) {
  let depth = 0
  for (const point of part.outer)
    if (!containsPoint(from, point)) depth = Math.max(depth, distanceToBoundary(from, point))
  return depth
}

function planLevel(children: AnyNode[]): { pieces: SlabNode[]; voids: Ring[] } | undefined {
  const slabs = children.filter((node): node is SlabNode => node.type === 'slab')
  const walls = children.filter((node): node is WallNode => node.type === 'wall')
  const rooms = children.filter(
    (node): node is ZoneNode =>
      node.type === 'zone' &&
      node.spaceRole === 'room' &&
      node.enclosureStatus !== 'open' &&
      node.hasFloor !== false &&
      node.floor?.support !== 'open' &&
      node.polygon.length >= 3,
  )
  if (!rooms.length || !walls.length) return
  const floorish = slabs.filter(
    (slab) =>
      slab.visible !== false &&
      slab.support !== 'open' &&
      !slab.recessed &&
      !slab.plateRole &&
      slab.polygon.length >= 3 &&
      slab.elevation - slab.thickness <= 0.01,
  )
  const miters = calculateLevelMiters(walls)
  const wallArea = union(
    walls.map((wall) => ({
      outer: getWallPlanFootprint(wall, miters).map(({ x, y }): [number, number] => [x, y]),
      holes: [],
    })),
  )
  const roomArea = union(rooms.map((room) => ({ outer: room.polygon, holes: room.holes ?? [] })))
  const context = prepareSlabPolygonContext({ walls, siblingSlabs: slabs })
  const rendered = new Map(
    floorish.map((slab) => [
      slab.id,
      { outer: getRenderableSlabPolygon(slab, context), holes: slab.holes ?? [] } as Polygon,
    ]),
  )
  const weights = new Map<number, number>()
  const cover = new Map<string, number>()
  for (const slab of floorish) {
    const inRooms = area(intersection(rendered.get(slab.id)!, roomArea))
    cover.set(slab.id, inRooms)
    if (inRooms <= 1e-3) continue
    const top = Math.round(slab.elevation * 1e6) / 1e6
    weights.set(top, (weights.get(top) ?? 0) + inRooms)
  }
  const [datum] = [...weights].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] ?? []
  if (datum === undefined) return
  const floor = floorish.filter((slab) => (cover.get(slab.id) ?? 0) > 1e-3)
  // A second floor height inside the rooms (a platform, a step, a raised floor
  // reaching down to the floor) is custom construction.
  const stepped = slabs.some(
    (slab) =>
      slab.visible !== false &&
      slab.support !== 'open' &&
      !slab.recessed &&
      slab.polygon.length >= 3 &&
      Math.abs(slab.elevation - datum) > 1e-3 &&
      slab.elevation - slab.thickness <= datum + 1e-3 &&
      area(
        intersection(
          rendered.get(slab.id) ?? { outer: slab.polygon, holes: slab.holes ?? [] },
          roomArea,
        ),
      ) > 1e-3,
  )
  if (stepped) return
  // One construction: the generated plate has one thickness and foundation.
  const [first] = floor
  if (
    !first ||
    floor.some(
      (slab) =>
        Math.abs(slab.thickness - first.thickness) > 1e-3 ||
        !!slab.fillToTerrain !== !!first.fillToTerrain,
    )
  )
    return
  const decks = new Set(
    children.flatMap((node) => {
      const deck = (node as { deckSlabId?: string }).deckSlabId
      return deck ? [deck] : []
    }),
  )
  const autos = floor.filter((slab) => slab.autoFromWalls || slab.boundary === 'auto')
  const autoArea = union(autos.map((slab) => rendered.get(slab.id)!))
  const inside = union([roomArea, wallArea])
  const pieces: SlabNode[] = []
  for (const slab of floor) {
    if (slab.autoFromWalls || slab.boundary === 'auto') continue
    if (slab.metadata?.plateMigration !== undefined || decks.has(slab.id)) return
    const surface = rendered.get(slab.id)!
    // A finish laid on a wall-generated slab: the finish migration owns it.
    if (autos.length && tryArea(() => difference(surface, autoArea)) <= 1e-4) continue
    const outside = difference(surface, inside)
    // The whole floor or nothing: a level keeping one hand-drawn floor keeps them all.
    if (
      outside.some(
        (part) =>
          partWidth(part) > PIECE_TRIM_DEPTH ||
          depthOutside(part, inside) > PIECE_TRIM_DEPTH + 1e-9,
      )
    )
      return
    pieces.push(slab)
  }
  if (!pieces.length) return
  const covered = union([...autos, ...pieces].map((slab) => rendered.get(slab.id)!))
  const floored = union(
    rooms
      .filter(
        (room) =>
          area(intersection({ outer: room.polygon, holes: room.holes ?? [] }, covered)) > 1e-3,
      )
      .map((room) => ({ outer: room.polygon, holes: room.holes ?? [] })),
  )
  const uncovered = difference(difference(floored, covered), wallArea).filter(
    (part) => area([part]) > 1e-4,
  )
  return {
    pieces,
    voids: uncovered
      .filter((part) => partWidth(part) > PIECE_GAP_WIDTH + 1e-9)
      .map((part) => part.outer),
  }
}

/**
 * Plans which legacy manual slabs the floor-plate migration adopts. Runs only
 * on scenes that have no floor plates yet (the same guard as the legacy floor
 * migration), so a migrated scene never re-plans.
 */
export function planFloorPieceAdoption(
  nodes: Readonly<Record<string, AnyNode>>,
  skipLevels: ReadonlySet<string> = new Set(),
): FloorPieceAdoption {
  const adoption: FloorPieceAdoption = { pieces: new Map(), levels: new Map() }
  const all = Object.values(nodes)
  if (all.some((node) => node.type === 'slab' && node.plateRole)) return adoption
  const byParent = new Map<string, AnyNode[]>()
  for (const node of all) {
    if (!node.parentId) continue
    const list = byParent.get(node.parentId) ?? []
    list.push(node)
    byParent.set(node.parentId, list)
  }
  for (const level of all) {
    // Levels the floor migration already settled (a saved, migrated scene) never re-plan.
    if (
      level.type !== 'level' ||
      skipLevels.has(level.id) ||
      level.metadata?.floorOwnershipMigrated === true
    )
      continue
    const children = byParent.get(level.id) ?? []
    let planned: ReturnType<typeof planLevel>
    try {
      planned = planLevel(children)
    } catch {
      continue
    }
    if (!planned) continue
    adoption.levels.set(level.id, { voids: planned.voids })
    for (const piece of planned.pieces) adoption.pieces.set(piece.id, level.id)
  }
  return adoption
}
