import type { AnyNode, AnyNodeId, BuildingNode, FloorBuildUp, LevelNode } from '../schema'
import { servesAsRoofLevel } from '../services/roof-level'
import { getLevelElevations } from '../services/storey'
import { DEFAULT_RAISED_FLOOR_BUILD_UP, floorBuildUpThickness } from './build-up'
import { groundLevelOf } from './ground-level'

const INCH = 0.0254

/** The sill a raised floor's joists bear on, over the stem wall's top, inches. */
export const FOUNDATION_SILL_IN = 1.5

/** A raised floor's framing depth, inches: its layers and the sill, to a ten-thousandth. */
function floorFramingIn(buildUp: FloorBuildUp): number {
  return Math.round((floorBuildUpThickness(buildUp) / INCH + FOUNDATION_SILL_IN) * 1e4) / 1e4
}

/** What the floor of the ground storey is: a concrete slab on the ground, or framing over a crawl space. */
export type BuildingFoundationType = 'slab' | 'raised'
/** What carries the perimeter down to the soil: a continuous footing, or a grade beam on piles. */
export type BuildingFoundationSupport = 'footing' | 'piles'

/**
 * The building's foundation as `metadata.foundation` stores it, every number in inches. `type` and
 * `ffAboveGradeIn` are the record the generators (Architect's `add_foundation`, plugin-generate)
 * have always written and Bones, the sections and the sheets read; the rest is the designed
 * foundation's, written by the editor's Foundation panel. The engine draws this foundation, sized
 * as stored, unless `enabled` is `false`: a building with no record stands on the default, a slab
 * on grade; switched off, it stands on the generic one. Anything left out takes the code default
 * ({@link resolveBuildingFoundation}).
 */
export type BuildingFoundationRecord = {
  /** `false` switches the designed foundation off; absent, it is on. */
  enabled?: boolean
  type?: BuildingFoundationType
  support?: BuildingFoundationSupport
  /** Finish floor over the highest grade under the exterior walls. */
  ffAboveGradeIn?: number
  source?: string
  slabThicknessIn?: number
  /** The slab's turned-down edge: its bottom under the grade outside, its width there. */
  edgeDepthIn?: number
  edgeWidthIn?: number
  /**
   * The 45° taper from the top of the edge's plumb inside face to the slab's underside: how far it
   * runs in (as far as it rises), 6 to 12 in. Absent, the rule sets it ({@link slabEdgeTaper}).
   */
  edgeTaperIn?: number
  stemThicknessIn?: number
  /** The least the foundation's top (the slab's, or the stem wall's) stands over the grade beside it. */
  topAboveGradeIn?: number
  /**
   * Floor top down to the stem wall's top: the floor's layers and the sill. Read off `floorBuildUp`;
   * a record that sets only this (an older one, a generator's) keeps it.
   */
  floorFramingDepthIn?: number
  /** A raised floor's layers over its sill, top down, metres, as a floor plate's (no ceiling). */
  floorBuildUp?: FloorBuildUp
  footingWidthIn?: number
  footingThicknessIn?: number
  /** The footing's bottom under the grade beside it. */
  footingDepthIn?: number
  /** Footings step down a slope; off, they stay level at the depth the lowest grade asks. */
  stepped?: boolean
  stepHeightIn?: number
  minStepRunIn?: number
  /**
   * A raised floor's stem wall, over the grade beside it, before its side steps: past it the footing
   * steps down the slope and the stem drops to `topAboveGradeIn` over grade, a cripple wall over it.
   */
  maxStemIn?: number
  /** A raised floor's crawl space: the dirt under it dug out to this under the joists (IRC R317.1). */
  crawlClearanceIn?: number
  /**
   * A house over a basement: its walls' top (where the floor over them bears on its sill) over the
   * highest grade along the house. More stands a daylight basement further out of the ground.
   */
  basementTopAboveGradeIn?: number
  /** A basement's poured walls, under the house's outline where the basement draws none of its own. */
  basementWallThicknessIn?: number
  /**
   * A raised house's room on a slab of its own (a garage): the slab's top over the highest grade
   * along the room, the ground held that far under it.
   */
  slabRoomTopAboveGradeIn?: number
  gradeBeamWidthIn?: number
  gradeBeamDepthIn?: number
  pileDiameterIn?: number
  pileSpacingIn?: number
  pileLengthIn?: number
}

/** The numbers a record holds, in the order the panel lists them. */
export const BUILDING_FOUNDATION_DIMENSIONS = [
  'ffAboveGradeIn',
  'slabThicknessIn',
  'edgeDepthIn',
  'edgeWidthIn',
  'stemThicknessIn',
  'topAboveGradeIn',
  'floorFramingDepthIn',
  'footingWidthIn',
  'footingThicknessIn',
  'footingDepthIn',
  'stepHeightIn',
  'minStepRunIn',
  'maxStemIn',
  'crawlClearanceIn',
  'basementTopAboveGradeIn',
  'basementWallThicknessIn',
  'slabRoomTopAboveGradeIn',
  'gradeBeamWidthIn',
  'gradeBeamDepthIn',
  'pileDiameterIn',
  'pileSpacingIn',
  'pileLengthIn',
] as const satisfies readonly (keyof BuildingFoundationRecord)[]

export type BuildingFoundationDimension = (typeof BUILDING_FOUNDATION_DIMENSIONS)[number]

/** Every number resolved, inches, with the storey count the defaults were read for. */
export type BuildingFoundation = Required<
  Omit<BuildingFoundationRecord, 'source' | 'edgeTaperIn'>
> & {
  source: string | null
  /** The slab edge's taper as set, inside its range; `null`: the rule sets it ({@link slabEdgeTaper}). */
  edgeTaperIn: number | null
  storeys: number
  /** The least finish floor the record allows: the slab's top, or the stem's top plus the floor framing, over the highest grade. */
  ffMinIn: number
}

/**
 * The common US residential numbers (IRC chapters 4 and 5), the ones a record left out takes.
 *
 * - Slab on grade: 4 in (R506.1 asks 3½), its top 8 in over grade (R317.1: wood sills bear on it); the
 *   edge turned down 12 in under grade (R403.1.4), 12 in wide at the bottom, its inside face plumb
 *   from there, square to the bottom, then in at 45° to the slab ({@link slabEdgeTaper}).
 * - Raised floor: a cast concrete stem wall, 6 in for one storey and 8 in for more (Table
 *   R404.1.2), its top at least 8 in over grade (R317.1, R404.1.6); on a footing 8 in thick, 12, 15
 *   or 23 in wide for one, two or three storeys (Table R403.1(1), 1500 psf soil), its bottom 12 in
 *   under grade. A side whose stem would stand over 36 in out of the ground steps down the slope
 *   (R403.1.5: the top of a footing is level), 8 in steps at least 24 in apart, its stem dropping to
 *   8 in over grade under a cripple wall. The floor framing over it: ¾ in flooring, ⅝ in T&G
 *   sheathing, 2x12 joists (11¼ in), 1½ in sill; the crawl space dug out to 18 in under the joists
 *   (R317.1), the footing's bottom 12 in under it as under the grade outside (R403.1.4).
 * - Over a basement: 8 in poured walls (Table R404.1.2(1)) on the footing, their top 8 in over the
 *   highest grade (R317.1: the sill and the floor framing on it stay off the ground); the slab inside.
 * - A raised house's room on a slab (a garage): its slab's top 4 in over grade, its walls on an 8 in
 *   curb over the slab (R317.1), the curb on the house's footing.
 * - Piles: a 12 × 24 in grade beam on 12 in piles 8 ft apart and at every corner, 10 ft deep.
 *   Engineered sizes: the defaults only draw them.
 */
export function buildingFoundationDefaults(
  storeys: number,
): Omit<BuildingFoundation, 'ffMinIn' | 'source' | 'storeys'> {
  return {
    enabled: true,
    type: 'slab',
    support: 'footing',
    ffAboveGradeIn: 8,
    slabThicknessIn: 4,
    edgeDepthIn: 12,
    edgeWidthIn: 12,
    edgeTaperIn: null,
    stemThicknessIn: storeys > 1 ? 8 : 6,
    topAboveGradeIn: 8,
    floorFramingDepthIn: floorFramingIn(DEFAULT_RAISED_FLOOR_BUILD_UP),
    floorBuildUp: DEFAULT_RAISED_FLOOR_BUILD_UP,
    footingWidthIn: storeys >= 3 ? 23 : storeys === 2 ? 15 : 12,
    footingThicknessIn: 8,
    footingDepthIn: 12,
    stepped: true,
    stepHeightIn: 8,
    minStepRunIn: 24,
    maxStemIn: 36,
    crawlClearanceIn: 18,
    basementTopAboveGradeIn: 8,
    basementWallThicknessIn: 8,
    slabRoomTopAboveGradeIn: 4,
    gradeBeamWidthIn: 12,
    gradeBeamDepthIn: 24,
    pileDiameterIn: 12,
    pileSpacingIn: 96,
    pileLengthIn: 120,
  }
}

/** The range each number may take, inches (the slope in degrees). */
export const BUILDING_FOUNDATION_LIMITS: Record<BuildingFoundationDimension, [number, number]> = {
  ffAboveGradeIn: [0, 120],
  slabThicknessIn: [3.5, 12],
  edgeDepthIn: [0, 60],
  edgeWidthIn: [6, 48],
  stemThicknessIn: [4, 16],
  topAboveGradeIn: [0, 48],
  floorFramingDepthIn: [4, 30],
  footingWidthIn: [8, 60],
  footingThicknessIn: [6, 36],
  footingDepthIn: [6, 120],
  stepHeightIn: [2, 48],
  minStepRunIn: [12, 120],
  maxStemIn: [12, 120],
  crawlClearanceIn: [12, 48],
  basementTopAboveGradeIn: [0, 120],
  basementWallThicknessIn: [6, 16],
  slabRoomTopAboveGradeIn: [0, 24],
  gradeBeamWidthIn: [8, 36],
  gradeBeamDepthIn: [12, 60],
  pileDiameterIn: [6, 48],
  pileSpacingIn: [36, 240],
  pileLengthIn: [24, 600],
}

/** The slab edge's 45° taper: the least and the most it runs in (and rises), inches. */
export const SLAB_EDGE_TAPER_IN: readonly [number, number] = [6, 12]

/**
 * A slab edge's 45° taper, metres: how far it runs in, as far as it rises, from the top of the
 * edge's plumb inside face to the slab's underside, for an edge reaching `depth` under that
 * underside. `taper` where the record sets one, else half the depth held to 6 to 12 in, so a
 * deeper edge grows plumb, not wider; never more than the depth (a shallow edge tapers from its
 * bottom).
 */
export function slabEdgeTaper(depth: number, taper: number | null = null): number {
  const [least, most] = SLAB_EDGE_TAPER_IN
  const run = taper ?? Math.min(inches(most), Math.max(inches(least), depth / 2))
  return Math.max(0, Math.min(depth, run))
}

/** The record a building stores, as written; `null` where it stores none. */
export function buildingFoundationRecordOf(
  building: Pick<BuildingNode, 'metadata'> | null | undefined,
): BuildingFoundationRecord | null {
  const stored = (building?.metadata as { foundation?: unknown } | undefined)?.foundation
  return stored && typeof stored === 'object' ? (stored as BuildingFoundationRecord) : null
}

/** The building's storeys: its levels from the ground level up, the roof level left out. */
export function buildingStoreyCount(nodes: Record<AnyNodeId, AnyNode>, buildingId: string): number {
  const ground = groundLevelOf(nodes, buildingId)
  const elevations = getLevelElevations(nodes)
  let count = 0
  for (const node of Object.values(nodes)) {
    if (node.type !== 'level' || elevations.get(node.id)?.buildingId !== buildingId) continue
    if (ground && (node as LevelNode).level < ground.level.level) continue
    if (servesAsRoofLevel(nodes, node as LevelNode)) continue
    count += 1
  }
  return Math.max(1, count)
}

/**
 * The building's foundation with every number filled: the stored value inside its range, or the
 * default for the building's storey count (the slab edge's taper, stored none, is left to the
 * rule). The finish floor never goes under the least the type allows (`ffMinIn`).
 */
export function resolveBuildingFoundation(
  record: BuildingFoundationRecord | null,
  storeys: number,
): BuildingFoundation {
  const defaults = buildingFoundationDefaults(storeys)
  const type: BuildingFoundationType = record?.type === 'raised' ? 'raised' : 'slab'
  const support: BuildingFoundationSupport = record?.support === 'piles' ? 'piles' : 'footing'
  const resolved = { ...defaults, type, support } as BuildingFoundation
  for (const key of BUILDING_FOUNDATION_DIMENSIONS) {
    const value = record?.[key]
    const [min, max] = BUILDING_FOUNDATION_LIMITS[key]
    resolved[key] =
      typeof value === 'number' && Number.isFinite(value)
        ? Math.min(max, Math.max(min, value))
        : defaults[key]
  }
  // The floor framing is the floor's layers and the sill. A record that set only the depth (an
  // older record, a generator's) keeps it; its layers read the default until one is set.
  const floorBuildUp = record?.floorBuildUp ?? DEFAULT_RAISED_FLOOR_BUILD_UP
  resolved.floorBuildUp = floorBuildUp
  if (record?.floorBuildUp || typeof record?.floorFramingDepthIn !== 'number')
    resolved.floorFramingDepthIn = floorFramingIn(floorBuildUp)
  const [least, most] = SLAB_EDGE_TAPER_IN
  const taper = record?.edgeTaperIn
  resolved.edgeTaperIn =
    typeof taper === 'number' && Number.isFinite(taper)
      ? Math.min(most, Math.max(least, taper))
      : null
  resolved.enabled = record?.enabled !== false
  resolved.stepped = record?.stepped !== false
  resolved.source = typeof record?.source === 'string' ? record.source : null
  resolved.storeys = storeys
  resolved.ffMinIn = ffMinimumIn(resolved)
  const storedFloor = record?.ffAboveGradeIn
  resolved.ffAboveGradeIn = Math.max(
    resolved.ffMinIn,
    typeof storedFloor === 'number' && Number.isFinite(storedFloor)
      ? storedFloor
      : resolved.ffMinIn,
  )
  return resolved
}

/** The least finish floor over the highest grade: the slab's top, or the stem's top plus the framing on it. */
export function ffMinimumIn(
  foundation: Pick<BuildingFoundation, 'type' | 'topAboveGradeIn' | 'floorFramingDepthIn'>,
): number {
  return foundation.type === 'raised'
    ? foundation.topAboveGradeIn + foundation.floorFramingDepthIn
    : foundation.topAboveGradeIn
}

/** The building's foundation, resolved; `null` for an id that is no building. */
export function buildingFoundationOf(
  nodes: Record<AnyNodeId, AnyNode>,
  buildingId: string,
): BuildingFoundation | null {
  const building = nodes[buildingId as AnyNodeId]
  if (building?.type !== 'building') return null
  return resolveBuildingFoundation(
    buildingFoundationRecordOf(building),
    buildingStoreyCount(nodes, buildingId),
  )
}

/**
 * Whether the building draws its designed foundation: unless its record is switched off, a building
 * with no record standing on the default slab.
 */
export function isBuildingFoundationOn(building: Pick<BuildingNode, 'metadata'> | undefined) {
  return building !== undefined && buildingFoundationRecordOf(building)?.enabled !== false
}

export const inches = (value: number) => value * INCH
