import type { BuildingNode, LevelNode, SlabNode, WallNode } from '../schema'
import type { AnyNode, AnyNodeId } from '../schema/types'
import {
  pointInPolygon,
  pointOnPolygonBoundary,
  wallOverlapsSlabFootprint,
} from '../systems/slab/slab-support'
import { DEFAULT_LEVEL_HEIGHT } from './level-height'

/**
 * Gap kept between a ceiling's stored height and its clamp bound (storey
 * plane or covering-slab underside), so the ceiling surface never
 * coincides with the solid above it.
 */
export const CEILING_CLAMP_MARGIN = 0.01

/**
 * Stored storey height in meters (floor-to-floor). Falls back to
 * {@link DEFAULT_LEVEL_HEIGHT} for unmigrated legacy levels whose `height`
 * field is absent.
 */
export function getStoredLevelHeight(level: Pick<LevelNode, 'height'>): number {
  return level.height ?? DEFAULT_LEVEL_HEIGHT
}

export type LevelElevation = {
  /** World Y of the level's floor: cumulative heights and level offsets through this level. */
  baseY: number
  /** Stored storey height of this level (fallback applied). */
  height: number
  buildingId: string | null
  ordinal: number
}

/**
 * Resolves the owning building: explicit `parentId` pointing at a building
 * wins; legacy levels that only appear in a building's `children` array
 * resolve through that membership.
 */
function resolveLevelBuildingId(
  levelId: LevelNode['id'],
  parentId: string | null,
  buildings: readonly BuildingNode[],
): string | null {
  const directParent = parentId ? buildings.find((building) => building.id === parentId) : undefined
  if (directParent) return directParent.id

  return buildings.find((building) => building.children.includes(levelId))?.id ?? null
}

/**
 * Per-building stacked elevations from stored storey heights and additive
 * base-elevation offsets: levels are sorted by ordinal ascending within each
 * building, and each offset shifts its level plus every higher level in the
 * same stack. Levels with no resolvable building share one legacy stack.
 *
 * Pure — operates on the serialized nodes record only.
 */
// Identity-keyed memo. `nodes` is an immutable store slice, so a hit means the
// scene has not changed since the last call. Hot callers ask once per wall per
// frame (WallCutout), which rebuilt an identical Map 1000+ times a frame. Weakly
// keyed so a closed project's node graph is not pinned by the memo.
const elevationMemo = new WeakMap<object, Map<string, LevelElevation>>()

export function getLevelElevations(nodes: Record<AnyNodeId, AnyNode>): Map<string, LevelElevation> {
  const memoized = elevationMemo.get(nodes)
  if (memoized) return memoized

  const buildings = Object.values(nodes).filter(
    (node): node is BuildingNode => node?.type === 'building',
  )

  const entries: Array<{ baseElevation: number; levelId: string } & LevelElevation> = []
  for (const node of Object.values(nodes)) {
    if (node?.type !== 'level') continue
    const level = node as LevelNode
    entries.push({
      levelId: level.id,
      baseElevation: level.baseElevation ?? 0,
      baseY: 0,
      height: getStoredLevelHeight(level),
      buildingId: resolveLevelBuildingId(level.id, level.parentId, buildings),
      ordinal: level.level,
    })
  }

  const elevations = new Map<string, LevelElevation>()
  const cumulativeYByBuilding = new Map<string | null, number>()
  for (const entry of entries.sort((a, b) => a.ordinal - b.ordinal)) {
    const baseY = (cumulativeYByBuilding.get(entry.buildingId) ?? 0) + entry.baseElevation
    elevations.set(entry.levelId, {
      baseY,
      height: entry.height,
      buildingId: entry.buildingId,
      ordinal: entry.ordinal,
    })
    cumulativeYByBuilding.set(entry.buildingId, baseY + entry.height)
  }

  elevationMemo.set(nodes, elevations)
  return elevations
}

function resolveLevelFloorToFloorHeight(
  levelId: string,
  elevations: Map<string, LevelElevation>,
): number | null {
  const current = elevations.get(levelId)
  if (!current) return null

  const aboveId = findLevelAboveId(levelId, elevations)
  if (!aboveId) return current.height
  const above = elevations.get(aboveId)
  return above ? above.baseY - current.baseY : current.height
}

export function getLevelFloorToFloorHeight(
  levelId: string,
  nodes: Record<AnyNodeId, AnyNode>,
): number {
  return resolveLevelFloorToFloorHeight(levelId, getLevelElevations(nodes)) ?? DEFAULT_LEVEL_HEIGHT
}

/**
 * The id of the level directly above `levelId` in its own stack (same
 * resolved building, or the shared legacy stack for building-less levels):
 * the level with the lowest ordinal strictly greater than the queried
 * level's. `null` when the level is topmost or unresolvable.
 */
export function findLevelAboveId(
  levelId: string,
  elevations: Map<string, LevelElevation>,
): string | null {
  const entry = elevations.get(levelId)
  if (!entry) return null

  let aboveId: string | null = null
  let aboveOrdinal = Number.POSITIVE_INFINITY
  for (const [candidateId, candidate] of elevations) {
    if (candidateId === levelId) continue
    if (candidate.buildingId !== entry.buildingId) continue
    if (candidate.ordinal > entry.ordinal && candidate.ordinal < aboveOrdinal) {
      aboveOrdinal = candidate.ordinal
      aboveId = candidateId
    }
  }
  return aboveId
}

/**
 * The level directly above `levelId` — see {@link findLevelAboveId}.
 * `null` when topmost or unresolvable. Pure.
 */
export function getLevelAbove(
  levelId: string,
  nodes: Record<AnyNodeId, AnyNode>,
): LevelNode | null {
  const aboveId = findLevelAboveId(levelId, getLevelElevations(nodes))
  if (!aboveId) return null
  const above = nodes[aboveId as LevelNode['id']]
  return above?.type === 'level' ? (above as LevelNode) : null
}

/**
 * The id of the level directly below `levelId` in its own stack — mirror of
 * {@link findLevelAboveId}: the level with the highest ordinal strictly less
 * than the queried level's. `null` when the level is lowest or unresolvable.
 */
export function findLevelBelowId(
  levelId: string,
  elevations: Map<string, LevelElevation>,
): string | null {
  const entry = elevations.get(levelId)
  if (!entry) return null

  let belowId: string | null = null
  let belowOrdinal = Number.NEGATIVE_INFINITY
  for (const [candidateId, candidate] of elevations) {
    if (candidateId === levelId) continue
    if (candidate.buildingId !== entry.buildingId) continue
    if (candidate.ordinal < entry.ordinal && candidate.ordinal > belowOrdinal) {
      belowOrdinal = candidate.ordinal
      belowId = candidateId
    }
  }
  return belowId
}

/**
 * The level directly below `levelId` — see {@link findLevelBelowId}.
 * `null` when lowest or unresolvable. Pure.
 */
export function getLevelBelow(
  levelId: string,
  nodes: Record<AnyNodeId, AnyNode>,
): LevelNode | null {
  const belowId = findLevelBelowId(levelId, getLevelElevations(nodes))
  if (!belowId) return null
  const below = nodes[belowId as LevelNode['id']]
  return below?.type === 'level' ? (below as LevelNode) : null
}

type CoveringSlabContext = {
  /** Offset-aware distance from the queried floor to the floor above. */
  floorToFloorHeight: number
  /** Non-recessed slab children of the level above. */
  slabs: SlabNode[]
}

/**
 * Storey height of the queried level plus the level-above's covering
 * (non-recessed) slabs. `null` when `levelId` doesn't resolve to a level.
 * A missing level above yields an empty slab list, not `null` — the
 * storey height is still meaningful for the clamp bound.
 */
function resolveCoveringSlabContext(
  levelId: string,
  nodes: Record<AnyNodeId, AnyNode>,
): CoveringSlabContext | null {
  const level = nodes[levelId as LevelNode['id']]
  if (level?.type !== 'level') return null

  const elevations = getLevelElevations(nodes)
  const aboveId = findLevelAboveId(levelId, elevations)
  const aboveNode = aboveId ? nodes[aboveId as LevelNode['id']] : null
  const above = aboveNode?.type === 'level' ? (aboveNode as LevelNode) : null
  const slabs: SlabNode[] = []
  for (const childId of above?.children ?? []) {
    const child = nodes[childId as keyof typeof nodes]
    if (child?.type !== 'slab') continue
    const slab = child as SlabNode
    // Recessed slabs (pools) are open shells, not covering solids.
    if (slab.recessed === true) continue
    if (slab.polygon.length < 3) continue
    slabs.push(slab)
  }

  return {
    floorToFloorHeight:
      resolveLevelFloorToFloorHeight(levelId, elevations) ??
      getStoredLevelHeight(level as LevelNode),
    slabs,
  }
}

/**
 * Underside of `slab`'s solid in the QUERIED level's local Y. The solid
 * occupies `[elevation - thickness, elevation]` in ITS level's local Y,
 * which sits `floorToFloorHeight` above the queried level's floor.
 */
function coveringUndersideY(floorToFloorHeight: number, slab: SlabNode): number {
  return floorToFloorHeight + ((slab.elevation ?? 0.05) - (slab.thickness ?? 0.05))
}

/**
 * Whether `slab`'s stored footprint (polygon minus holes) covers `[x, z]`.
 * Ray-cast pointInPolygon flips arbitrarily for points exactly ON the
 * boundary (min-side edges read inside, max-side edges outside), so
 * boundary contact counts as covered explicitly — the same convention as
 * the slab-support interval classification. A point on a hole's rim keeps
 * coverage (mirrors the support election's hole handling).
 *
 * Raw stored polygon + holes on purpose (mirrors getCeilingAt): the
 * clamp bound doesn't need the rendered footprint's junction trims,
 * and staying off the render path keeps this query cheap and pure.
 */
function slabCoversPoint(slab: SlabNode, x: number, z: number): boolean {
  if (!pointInPolygon(x, z, slab.polygon) && !pointOnPolygonBoundary(x, z, slab.polygon)) {
    return false
  }
  for (const hole of slab.holes ?? []) {
    if (hole.length < 3) continue
    if (pointInPolygon(x, z, hole) && !pointOnPolygonBoundary(x, z, hole)) return false
  }
  return true
}

/**
 * Lowest underside among `slabs` covering `[x, z]`, in the queried
 * level's local Y, or `null` when none covers the point.
 */
function lowestCoveringUndersideAt(
  context: CoveringSlabContext,
  x: number,
  z: number,
): number | null {
  let lowest: number | null = null
  for (const slab of context.slabs) {
    if (!slabCoversPoint(slab, x, z)) continue
    const underside = coveringUndersideY(context.floorToFloorHeight, slab)
    if (lowest === null || underside < lowest) lowest = underside
  }
  return lowest
}

/**
 * Underside of the LOWEST slab from the level above that covers
 * level-local point `[x, z]`, expressed in the queried level's local Y:
 * `floorToFloorHeight + (slab.elevation - slab.thickness)`. `recessed` slabs
 * (pools) never cover. `null` when no covering slab (or no level above).
 *
 * Coordinate spaces: levels stack in Y only (`LevelNode` carries no XZ
 * transform and the viewer's LevelSystem writes only `position.y`), so a
 * level-local `[x, z]` is valid in every level of the stack unchanged.
 */
export function getCoveringSlabUndersideAt(
  levelId: string,
  nodes: Record<AnyNodeId, AnyNode>,
  x: number,
  z: number,
): number | null {
  const context = resolveCoveringSlabContext(levelId, nodes)
  if (!context) return null
  return lowestCoveringUndersideAt(context, x, z)
}

/**
 * Top plane for a plane-bound wall on `levelId`, in level-local Y:
 * `min(stored storey height, lowest covering-slab underside over the wall's
 * span)` — a thick or flush slab on the level above SHORTENS the walls below
 * instead of colliding with them (Revit-style automatic attach).
 *
 * Coverage: the wall's thickness band (centerline + face lines, arc-aware)
 * is clipped against each covering slab's stored polygon minus holes via
 * {@link wallOverlapsSlabFootprint} — the same overlap machinery as the
 * support election. Point sampling is deliberately avoided: auto-slab
 * polygons derive from wall CENTERLINES, so perimeter walls sit exactly ON
 * the polygon boundary, where ray-cast point-in-polygon flips with the
 * edge's orientation (one wall clamped, its neighbor didn't). Boundary
 * contact counts as covered on every side of the slab.
 *
 * This is THE plane for a plane-bound wall (`height` absent). Explicit-height
 * walls ignore the value (`resolveWallTop` returns their stored height), so
 * passing it wherever a raw storey height feeds `resolveWallTop` /
 * `resolveWallEffectiveHeight` is always safe. Falls back to
 * {@link DEFAULT_LEVEL_HEIGHT} when `levelId` doesn't resolve to a level.
 */
export function getWallPlaneTop(
  wall: Pick<WallNode, 'start' | 'end'> & Partial<Pick<WallNode, 'thickness' | 'curveOffset'>>,
  levelId: string,
  nodes: Record<AnyNodeId, AnyNode>,
): number {
  const context = resolveCoveringSlabContext(levelId, nodes)
  if (!context) return DEFAULT_LEVEL_HEIGHT

  let plane = context.floorToFloorHeight
  for (const slab of context.slabs) {
    const underside = coveringUndersideY(context.floorToFloorHeight, slab)
    if (underside >= plane) continue
    if (!wallOverlapsSlabFootprint(wall, slab.polygon, slab.holes)) continue
    plane = underside
  }
  return plane
}

/**
 * Upper bound for a ceiling's stored height over `polygon` on `levelId`:
 * `min(storey plane, lowest covering-slab underside) - CEILING_CLAMP_MARGIN`.
 * The covering underside is sampled at every polygon vertex plus the
 * centroid — cheap, and a slab overlapping a convex-ish ceiling almost
 * always covers one of those points; exact polygon-vs-polygon overlap is
 * not worth its cost for a clamp bound. Ceiling outlines share footprint
 * edges with the slabs above them the same way walls do, so vertices
 * sitting exactly on a slab's boundary count as covered on every side
 * (see `slabCoversPoint`) instead of flipping with the edge orientation.
 *
 * Returns `Infinity` when `levelId` doesn't resolve, so callers clamp
 * against nothing rather than a garbage plane.
 */
export function getCeilingClampBound(
  levelId: string,
  nodes: Record<AnyNodeId, AnyNode>,
  polygon: ReadonlyArray<[number, number]>,
): number {
  const context = resolveCoveringSlabContext(levelId, nodes)
  if (!context) return Number.POSITIVE_INFINITY

  let bound = context.floorToFloorHeight
  if (polygon.length > 0) {
    let cx = 0
    let cz = 0
    for (const [x, z] of polygon) {
      cx += x
      cz += z
    }
    const samples: Array<[number, number]> = [
      ...polygon,
      [cx / polygon.length, cz / polygon.length],
    ]
    for (const [x, z] of samples) {
      const underside = lowestCoveringUndersideAt(context, x, z)
      if (underside !== null && underside < bound) bound = underside
    }
  }

  return bound - CEILING_CLAMP_MARGIN
}
