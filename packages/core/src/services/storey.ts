import { footprintLift } from '../lib/floor-foundation-datum'
import { levelConstructionDisplacements } from '../lib/floor-foundation-stack'
import { area, intersection } from '../lib/polygon-boolean'
import { isSiteFlatwork } from '../lib/site-flatwork'
import { queryNodes } from '../runtime/node-queries'
import type { BuildingNode, LevelNode, SlabNode, WallNode } from '../schema'
import type { AnyNode, AnyNodeId } from '../schema/types'
import {
  pointInPolygon,
  pointOnPolygonBoundary,
  wallOverlapsSlabFootprint,
} from '../systems/slab/slab-support'
import { resolveWallTop } from '../systems/wall/wall-top'
import { DEFAULT_LEVEL_HEIGHT } from './level-height'

/**
 * Gap kept between a ceiling's stored height and its clamp bound (storey
 * plane or covering-slab underside), so the ceiling surface never
 * coincides with the solid above it.
 */
export const CEILING_CLAMP_MARGIN = 0.01

/** Metres added per level ordinal in Exploded view, also used to frame agent captures. */
export const EXPLODED_GAP = 5

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
const authoredElevationMemo = new WeakMap<object, Map<string, LevelElevation>>()

export function getLevelElevations(nodes: Record<AnyNodeId, AnyNode>): Map<string, LevelElevation> {
  const hit = elevationMemo.get(nodes)
  if (hit) return hit
  const elevations = new Map(getAuthoredLevelElevations(nodes))
  if (
    queryNodes(nodes, { type: 'slab' }).some(
      (node) => node.type === 'slab' && node.plateRole === 'base',
    )
  )
    for (const [id, lift] of levelConstructionDisplacements(nodes)) {
      const entry = elevations.get(id)!
      if (lift) elevations.set(id, { ...entry, baseY: entry.baseY + lift })
    }
  elevationMemo.set(nodes, elevations)
  return elevations
}

export function getAuthoredLevelElevations(
  nodes: Readonly<Record<string, AnyNode>>,
): Map<string, LevelElevation> {
  const memoized = authoredElevationMemo.get(nodes)
  if (memoized) return memoized

  const buildings = queryNodes<BuildingNode>(nodes, { type: 'building' })

  const entries: Array<{ baseElevation: number; levelId: string } & LevelElevation> = []
  for (const level of queryNodes<LevelNode>(nodes, { type: 'level' })) {
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

  authoredElevationMemo.set(nodes, elevations)
  return elevations
}

/**
 * How far under the ground a floor has to sit to be below grade. A ground floor a few centimetres
 * under the lawn (a basement deeper than it is tall pushes the stack down) stays a ground floor.
 */
export const BELOW_GRADE_TOLERANCE = 0.3

/**
 * The world Y of `levelId`'s own plane, the one its slabs' `elevation`s are measured from: the
 * stacked base and the building's height on the site. A floor slab's top is this plus its
 * elevation. `null` for an id that is no level.
 */
export function levelPlaneWorldY(
  nodes: Record<AnyNodeId, AnyNode>,
  levelId: string,
): number | null {
  const elevation = getLevelElevations(nodes).get(levelId)
  const level = nodes[levelId as LevelNode['id']]
  if (!elevation || level?.type !== 'level') return null
  const building = elevation.buildingId ? nodes[elevation.buildingId as AnyNodeId] : undefined
  const siteY = building?.type === 'building' ? building.position[1] : 0
  return siteY + elevation.baseY
}

/**
 * `levelId`'s world floor: the stacked base, the building's height on the site and the top of
 * the highest slab it stands on. `null` for an id that is no level. A level with floors at
 * several heights (a split level) has no single floor: this is the highest, and what asks where
 * the ground stands over a floor asks per slab ({@link levelPlaneWorldY} plus the slab's
 * elevation).
 */
export function levelFloorWorldY(
  nodes: Record<AnyNodeId, AnyNode>,
  levelId: string,
): number | null {
  const plane = levelPlaneWorldY(nodes, levelId)
  const level = nodes[levelId as LevelNode['id']]
  if (plane === null || level?.type !== 'level') return null
  return plane + standingSlabTop(nodes, level)
}

/**
 * The world Y of the top of the lowest floor slab `levelId` stands on: the floor a pit under the
 * level has to go down to, the sunken room of a split level included ({@link levelFloorWorldY} is
 * the highest). The same as `levelFloorWorldY` for a level with one floor, or none. `null` for an
 * id that is no level.
 */
export function levelLowestFloorWorldY(
  nodes: Record<AnyNodeId, AnyNode>,
  levelId: string,
): number | null {
  const plane = levelPlaneWorldY(nodes, levelId)
  const level = nodes[levelId as LevelNode['id']]
  if (plane === null || level?.type !== 'level') return null
  let lowest: number | null = null
  for (const childId of level.children) {
    const child = nodes[childId as AnyNodeId]
    if (!isFloorSlab(child)) continue
    lowest = Math.min(lowest ?? child.elevation, child.elevation)
  }
  return plane + (lowest ?? 0)
}

/**
 * The world Y of the underside of `levelId`'s lowest floor plate, never above the walls' base: the
 * plane the foundation under the level tops out at, and the one the pit under the hole keeps its
 * own floor clear of. `null` for an id that is no level.
 */
export function levelPlateUndersideWorldY(
  nodes: Record<AnyNodeId, AnyNode>,
  levelId: string,
): number | null {
  const baseY = levelPlaneWorldY(nodes, levelId)
  const level = nodes[levelId as LevelNode['id']]
  if (baseY === null || level?.type !== 'level') return null
  let underside = baseY
  for (const childId of level.children) {
    const child = nodes[childId as AnyNodeId]
    if (!isFloorSlab(child)) continue
    underside = Math.min(underside, baseY + child.elevation - child.thickness)
  }
  return underside
}

/**
 * Whether `levelId` lies wholly below the flat site's grade (Y 0): its standing floor, the highest
 * of its floor slabs, is under it by more than {@link BELOW_GRADE_TOLERANCE}. The level as a
 * whole, which is what deriving a building's ground level asks. Sculpted terrain is not consulted,
 * and neither is a lower floor of a split level: ask `levelGradeStanding`, which judges each floor
 * against the datum or the terrain. `false` for an id that is no level.
 */
export function isLevelBelowGrade(nodes: Record<AnyNodeId, AnyNode>, levelId: string): boolean {
  const floorY = levelFloorWorldY(nodes, levelId)
  return floorY !== null && floorY < -BELOW_GRADE_TOLERANCE
}

/**
 * Whether a node is a floor slab of the house a level stands on: not a recessed one (a pit or a
 * basin, drawn down into the floor) and not site flatwork (a lawn, a driveway: outdoors, laid on the
 * level for its elevation only). Where a level's floors are, how high and how deep, is read off
 * these alone.
 */
function isFloorSlab(node: AnyNode | undefined): node is SlabNode {
  return node?.type === 'slab' && node.recessed !== true && !isSiteFlatwork(node)
}

/** The top of the highest floor slab a level stands on, in its own Y; 0 for a level with none. */
function standingSlabTop(nodes: Record<AnyNodeId, AnyNode>, level: LevelNode): number {
  let top: number | null = null
  for (const childId of level.children) {
    const child = nodes[childId as AnyNodeId]
    if (!isFloorSlab(child)) continue
    top = Math.max(top ?? child.elevation, child.elevation)
  }
  return top ?? 0
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
  planeHeight: number
  footprintPlanes: Array<{ slab: SlabNode; top: number }>
}

const coveringMemo = new WeakMap<
  object,
  Map<string, { sources: AnyNode[]; context: CoveringSlabContext }>
>()

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
  const sources = Object.values(nodes)
  let memo = coveringMemo.get(nodes)
  if (!memo) {
    memo = new Map()
    coveringMemo.set(nodes, memo)
  }
  const cached = memo.get(levelId)
  // Reconciliation replaces entries in its working graph before returning it.
  if (
    cached &&
    sources.length === cached.sources.length &&
    sources.every((node, i) => node === cached.sources[i])
  )
    return cached.context
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

  const floorToFloorHeight =
    resolveLevelFloorToFloorHeight(levelId, elevations) ?? getStoredLevelHeight(level)
  const footprints = Object.values(nodes).flatMap((slab) =>
    slab.type === 'slab' && slab.parentId === levelId && slab.plateRole === 'base'
      ? [{ slab, lift: footprintLift(nodes, slab) }]
      : [],
  )
  const authoredHeight =
    resolveLevelFloorToFloorHeight(levelId, getAuthoredLevelElevations(nodes)) ??
    getStoredLevelHeight(level)
  const context = {
    floorToFloorHeight,
    planeHeight: authoredHeight,
    slabs,
    footprintPlanes: footprints.map(({ slab, lift }) => ({
      slab,
      top: authoredHeight + lift,
    })),
  }

  memo.set(levelId, { sources, context })
  return context
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
 * Use {@link getWallTop} to resolve a wall's top with its elected base and
 * raw authored storey height, independently of this plane. Falls back to
 * {@link DEFAULT_LEVEL_HEIGHT} when `levelId` doesn't resolve to a level.
 */
export function getWallPlaneTop(
  wall: Pick<WallNode, 'start' | 'end'> & Partial<Pick<WallNode, 'thickness' | 'curveOffset'>>,
  levelId: string,
  nodes: Record<AnyNodeId, AnyNode>,
): number {
  return wallPlaneTop(wall, resolveCoveringSlabContext(levelId, nodes))
}

export function getWallTop(
  wall: WallNode,
  levelId: string,
  nodes: Record<AnyNodeId, AnyNode>,
  electedBase: number,
): number {
  const level = nodes[levelId as LevelNode['id']]
  const authoredStoreyHeight = level?.type === 'level' ? (level.height ?? null) : null
  return resolveWallTop(
    wall,
    getWallPlaneTop(wall, levelId, nodes),
    electedBase,
    authoredStoreyHeight,
  )
}

export function getWallCoveringSlabUnderside(
  wall: Pick<WallNode, 'start' | 'end'> & Partial<Pick<WallNode, 'thickness' | 'curveOffset'>>,
  levelId: string,
  nodes: Record<AnyNodeId, AnyNode>,
): number | null {
  const undersides = getWallCoveringSlabs(wall, levelId, nodes).map(({ underside }) => underside)
  return undersides.length ? Math.min(...undersides) : null
}

export function getWallCoveringSlabs(
  wall: Pick<WallNode, 'start' | 'end'> & Partial<Pick<WallNode, 'thickness' | 'curveOffset'>>,
  levelId: string,
  nodes: Record<AnyNodeId, AnyNode>,
): Array<{ slab: SlabNode; underside: number; top: number }> {
  const context = resolveCoveringSlabContext(levelId, nodes)
  if (!context) return []
  return context.slabs
    .filter((slab) => wallOverlapsSlabFootprint(wall, slab.polygon, slab.holes))
    .map((slab) => ({
      slab,
      underside: coveringUndersideY(context.floorToFloorHeight, slab),
      top: context.floorToFloorHeight + slab.elevation,
    }))
}

export function getWallPlaneTops(
  walls: readonly WallNode[],
  levelId: string,
  nodes: Record<AnyNodeId, AnyNode>,
): Map<string, number> {
  const context = resolveCoveringSlabContext(levelId, nodes)
  return new Map(walls.map((wall) => [wall.id, wallPlaneTop(wall, context)]))
}

function wallPlaneTop(
  wall: Pick<WallNode, 'start' | 'end'> & Partial<Pick<WallNode, 'thickness' | 'curveOffset'>>,
  context: CoveringSlabContext | null,
): number {
  if (!context) return DEFAULT_LEVEL_HEIGHT

  const footprints = context.footprintPlanes.filter(({ slab }) =>
    wallOverlapsSlabFootprint(wall, slab.polygon),
  )
  let plane = footprints.length
    ? Math.max(...footprints.map(({ top }) => top))
    : context.planeHeight
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
  wallTop?: number,
): number {
  const context = resolveCoveringSlabContext(levelId, nodes)
  if (!context) return Number.POSITIVE_INFINITY

  const footprints = context.footprintPlanes.filter(
    ({ slab }) => area(intersection(slab.polygon, [...polygon])) > 1e-6,
  )
  let bound = footprints.length
    ? Math.min(...footprints.map(({ top }) => top))
    : context.planeHeight
  if (wallTop !== undefined) bound = Math.max(bound, wallTop)
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

/**
 * Lowest height a ceiling on `levelId` may be stored at, in level-local Y.
 *
 * A ceiling on a level above grade may hang below that level's floor, down
 * to grade (world Y 0, the building's lowest floor): eave soffits and porch
 * ceilings that belong to a roof level explode with it, so they live there
 * with negative heights. The bound is `-baseY + CEILING_DRAW_OFFSET`, so the
 * drawn surface lands at grade, or `atGrade` when that is lower. On a level at grade, or one that doesn't resolve, the caller's
 * `atGrade` floor applies unchanged.
 */
/**
 * The ceiling renderers draw the surface this far under the stored height
 * (so it never z-fights the slab above); height bounds that promise a drawn
 * position must add it back.
 */
export const CEILING_DRAW_OFFSET = 0.01

export function getCeilingMinHeight(
  levelId: string,
  nodes: Record<AnyNodeId, AnyNode>,
  atGrade: number,
): number {
  const baseY = getLevelElevations(nodes).get(levelId)?.baseY ?? 0
  return baseY > 0 ? Math.min(atGrade, -baseY + CEILING_DRAW_OFFSET) : atGrade
}
