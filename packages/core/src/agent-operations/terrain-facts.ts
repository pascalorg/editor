import { stretchesAlongWall } from '../building/zone-wall-stretches'
import { automaticFloorHeight, floorPlateAtGroundContact } from '../lib/floor-foundation-datum'
import { floorSlabsOf, levelGradeStanding } from '../lib/grade-standing'
import { groundLevelOf } from '../lib/ground-level'
import { getOpeningFloorDatum, wallSupportForNodes } from '../lib/opening-floor-datum'
import { rampHeightAt, rampOffsetPoint, rampStations } from '../lib/ramp'
import { rampFacts } from '../lib/ramp-facts'
import { roomFloorElevation } from '../lib/room-floor-elevation'
import { classifyEdges, outwardNormal, resolveFrontEdge } from '../lib/setback-envelope'
import { isSiteFlatwork } from '../lib/site-flatwork'
import { slabTerrainHeightAt } from '../lib/slab-terrain'
import { terrainBreakFacts, terrainBreaksOf } from '../lib/terrain-breaks'
import { heightAt, slopeAt, type TerrainField } from '../lib/terrain-field'
import { persistedTerrainFieldOf } from '../lib/terrain-source-persisted'
import { queryNodes } from '../runtime/node-queries'
import type {
  AnyNode,
  AnyNodeId,
  BuildingNode,
  DoorNode,
  LevelNode,
  RampNode,
  SiteNode,
  SlabNode,
  StairNode,
  WallNode,
  ZoneNode,
} from '../schema'
import { MIN_SLAB_THICKNESS } from '../schema/nodes/slab'
import {
  getLevelElevations,
  getLevelFloorToFloorHeight,
  levelPlaneWorldY,
} from '../services/storey'
import { pointInPolygon as inPolygon } from '../systems/slab/slab-support'
import { stairBaseElevation } from '../systems/stair/stair-base-elevation'
import { resolveStairWalkingSurfaces } from '../systems/stair/stair-clearance'
import { getWallCurveFrameAt, getWallCurveLength } from '../systems/wall/wall-curve'
import { getWallFaceOffsets } from '../systems/wall/wall-frame'
import { pointInPolygon as onOrInPolygon } from './plan-geometry'
import type { SceneNodes } from './types'

/**
 * What stands on the ground, against the ground: one measure for the model (read_terrain_facts) and
 * for a harness that states it. Every height is metres above the scene datum and every point is in
 * the site frame; the ground is the persisted terrain, or the flat datum where nobody shaped any.
 *
 * The facts are measured; `open` lists the ones past a stated limit, each with its number. The
 * limits are design context, said in the answer, not a code check.
 */

type Pt = [number, number]
type Range = { min: number; max: number }

export const TERRAIN_FACT_LIMITS = {
  /** Ground this far over a floor's top, a sill or a paved surface counts as over it. */
  groundOverM: 0.02,
  /** A floor edge this far over the ground stands in the air (the unguarded-drop threshold). */
  floorInAirM: 0.5,
  /** A floor that follows the ground this far over its level's base has taken that much of the storey. */
  floorLiftM: 0.15,
  /** A door's sill this far over what is outside it is more than one riser. */
  doorStepM: 0.2,
  /** How far from a wall the ground's fall is measured, and from how close to its face. */
  fallReachM: 3,
  fallFromM: 0.3,
  /** Ground rising more than this going away from a wall runs to it, unless it first falls this much from the wall's foot. */
  fallTowardPercent: 1,
  fallAtWallPercent: 2,
  /** The stretch from the wall's foot that fall is read over. */
  fallAtWallM: 0.5,
  /** A stretch of wall this long with the ground running to it is stated. */
  fallTowardLengthM: 1,
  /**
   * Water runs to a wall where the ground climbs from its foot, without first falling, over at
   * least this reach and by at least this much; a face the ground steps up at is not a climb.
   */
  runsToWallReachM: 1,
  runsToWallRiseM: 0.03,
  /** Ground this far over a floor, against a wall, is earth the wall holds. */
  earthAgainstM: 0.3,
  /** A paved surface this far off the ground is off it. */
  surfaceOffGroundM: 0.15,
  drivePercent: 18,
  walkPercent: 12.5,
  /** The end of a flight or a ramp this far from the ground or the sill misses it. */
  meetM: 0.05,
  /** A house this close to the top of a face this high stands at the edge of a drop. */
  dropEdgeM: 2,
  dropHeightM: 1,
  /** Ground steeper than this with no wall or face holding it is a bank to hold. */
  bankDeg: 45,
  bankAreaM2: 1,
} as const

export type TerrainFinding = {
  code:
    | 'ground_over_floor'
    | 'floor_in_air'
    | 'floor_lifted_by_ground'
    | 'floor_without_thickness'
    | 'floor_split'
    | 'room_without_floor'
    | 'door_above_ground'
    | 'door_below_ground'
    | 'ground_falls_to_wall'
    | 'window_below_ground'
    | 'room_light_behind_earth'
    | 'surface_off_ground'
    | 'surface_under_ground'
    | 'surface_steep'
    | 'steps_off_ground'
    | 'steps_miss_door'
    | 'ramp_end_off_ground'
    | 'ramp_steep'
    | 'ramp_side_unheld'
    | 'house_at_drop_edge'
    | 'steep_bank'
  /** The node the fact is about. */
  id: string
  /** The number past its limit: metres, percent or degrees, as the message says. */
  value: number
  message: string
}

export type WallGroundFacts = {
  wallId: string
  /** The side of the lot the wall's outside faces, the street being the front; absent with no street edge. */
  side?: 'front' | 'rear' | 'left' | 'right'
  /** Unit vector from the wall to its outside. */
  outward: Pt
  lengthM: number
  /** The ground along the wall's outside foot. */
  groundM: Range
  /** The floor the wall stands on, over that ground: negative where the ground stands over the floor. */
  floorOverGroundM: Range
  /** How the ground falls going away from the wall, percent over `fallReachM`: negative rises. */
  fallAwayPercent: Range
  /** The same over the first half metre from the wall's foot: a fall here carries water off the wall even under a bank. */
  fallAtWallPercent: Range
  /** Length of the wall where the ground climbs from its foot without first falling: water runs to the wall. */
  fallsTowardLengthM: number
  /** How far under the wall's foot the lowest ground within 2.5 m of it lies: 0 where the ground only rises. */
  lowLineUnderFootM: Range
  /** Earth against the wall: the ground at its outside face over the floor inside (0 where it is lower). */
  earthAgainstM: { max: number; mean: number }
  /** Length of the wall with more than `earthAgainstM` of earth against it, and that earth's share of the storey height. */
  earthLengthM: number
  buriedShare: number
  /** A face the ground steps up at before the wall (a retaining face across an areaway): how far, how high. */
  faceBefore?: { distanceM: number; heightM: number }
  /** Windows in the wall: the sill of each against the ground outside it. */
  windows: { windowId: string; sillM: number; outsideM: number; underGroundM: number }[]
}

export type DoorGroundFacts = {
  doorId: string
  wallId: string
  levelId: string
  at: Pt
  sillM: number
  /** What is outside the door: the ground, or a slab laid there (a porch, a patio). */
  outside: 'ground' | 'slab'
  outsideId?: string
  outsideM: number
  /** Sill minus outside: positive is a step down to it, negative is ground or paving over the sill. */
  stepM: number
  /** Steps or a ramp whose upper end stands at this door. */
  servedBy?: string
}

export type HouseGroundFacts = {
  buildingId: string
  levelId: string
  /** `at-grade`, `partly-below-grade` or `below-grade`, as the level's standing is read everywhere. */
  standing: string
  /** The level's base: the plane its storey stands on, and its storey height from there. */
  levelBaseM: number
  storeyHeightM: number
  /** The top of the ground level's floor (its lowest and highest floor slab). */
  floorM: Range
  /**
   * What the storey keeps between its highest floor and its top. A floor that rests on the ground
   * follows the ground at its walls; the storey's top stays on the level's base.
   */
  clearHeightM: number
  /** The floor rests on the ground and follows it (an automatic floor plate), or stands where it was drawn. */
  floorFollowsGround: boolean
  /** How far the highest floor that follows the ground stands over the level's base; 0 with none. */
  followingFloorOverBaseM: number
  /** The ground under the floor. */
  groundM: { lowest: number; highest: number; mean: number }
  /** Floor top minus ground under it: negative where the ground stands over the floor. */
  floorOverGroundM: Range
  /** Share of the floor with the ground over it, and with more than `floorInAirM` of air under it. */
  groundOverFloorShare: number
  floorInAirShare: number
  walls: WallGroundFacts[]
  doors: DoorGroundFacts[]
  /** Rooms of the ground level along a wall that holds earth: what light their openings keep. */
  roomsAgainstEarth: {
    zoneId: string
    name: string
    /** Its length along outside walls, and along those that hold earth. */
    frontageM: number
    earthFrontageM: number
    /** Its windows and doors to the outside: with the ground under the sill, and with the ground over it. */
    openingsClear: number
    openingsUnderGround: number
    /** The room states artificial light and ventilation (its daylight declaration). */
    declared: boolean
  }[]
}

export type SurfaceGroundFacts = {
  slabId: string
  kind: string
  mode: 'flat' | 'draped'
  areaM2: number
  /** Surface top minus the ground under it. */
  overGroundM: Range
  /**
   * The slope of the surface itself (0 for a flat one). A drive or a walk is read the way it is
   * travelled: down its middle (the points farthest from its sides), along the side nearest each
   * point, over 3 m; any other surface by the ground's steepest slope under it.
   */
  slopePercent: { max: number; mean: number }
  /** A drive or a walk: its fall across the way it is travelled. */
  crossFallPercent?: { max: number; mean: number }
  /** The steepest the ground stands under any point of it (its edges on a batter included). */
  steepestGroundPercent: number
}

export type StepsGroundFacts = {
  stairId: string
  foot: Pt
  footM: number
  groundAtFootM: number
  /** Foot minus ground: positive stands in the air, negative is under the ground. */
  footOverGroundM: number
  topM: number
  /** The door whose sill the upper end stands at, and upper end minus that sill. */
  doorId?: string
  topOverSillM?: number
}

export type RampGroundFacts = {
  rampId: string
  lengthM: number
  maximumSlopePercent: number
  statedLimitPercent: number
  /** Each end: its height, the ground just beyond it, and the difference. */
  ends: { at: Pt; heightM: number; groundBeyondM: number; overGroundM: number }[]
  /**
   * The ground beside the ramp against its surface: the highest it stands over it (a cut) and
   * under it (a fill), the height of the ramp's own retaining sides, and the length of side
   * where a face higher than those sides, and than 0.3 m, stands with nothing to hold it.
   */
  sides: { cutMaxM: number; fillMaxM: number; retainingHeightM: number; unheldLengthM: number }
}

export type TerrainFacts = {
  hasTerrain: boolean
  houses: HouseGroundFacts[]
  surfaces: SurfaceGroundFacts[]
  steps: StepsGroundFacts[]
  ramps: RampGroundFacts[]
  /**
   * Faces that hold ground: terrain breaks, with the height they hold, and each house within 10 m
   * of one: on its high side (`top`) or its low side (`foot`), and how far its walls stand from it.
   */
  retaining: {
    breakId: string
    kind: string
    lengthM: number
    heightM: Range
    houses: { buildingId: string; standsAt: 'top' | 'foot'; distanceM: number }[]
  }[]
  /** Ground steeper than `bankDeg` inside the lot that no face holds. */
  banks: { steepestDeg: number; areaM2: number }
  /**
   * Earth moved against the ground before any tile was written (the frozen base field, or the
   * datum): a lot whose natural relief was itself written as tiles counts that relief here.
   */
  earthwork?: { cutM3: number; fillM3: number; against: 'base_field' | 'datum' }
  open: TerrainFinding[]
  limits: typeof TERRAIN_FACT_LIMITS
  section?: TerrainSection
  note?: string
}

export type TerrainSection = {
  from: Pt
  to: Pt
  lengthM: number
  /** The ground along the line at its breakpoints, `sM` metres from `from`. */
  ground: { sM: number; groundM: number }[]
  /** The floors the line passes over: where, and their top. */
  floors: { slabId: string; fromM: number; toM: number; topM: number; overGroundM: Range }[]
}

const round = (value: number, digits = 2) => {
  const k = 10 ** digits
  return Math.round(value * k) / k
}
/** The least and the greatest of a list, by a loop: a long list is not spread onto the stack. */
const rangeOf = (values: number[]): Range => {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const value of values) {
    if (value < min) min = value
    if (value > max) max = value
  }
  return { min: round(min), max: round(max) }
}

type Frame = {
  building: BuildingNode
  toSite: (x: number, z: number) => Pt
  toLocal: (x: number, z: number) => Pt
  /** A building-local direction in the site frame. */
  turn: (x: number, z: number) => Pt
}

function frameOf(building: BuildingNode): Frame | null {
  if (Math.abs(building.rotation[0]) > 1e-9 || Math.abs(building.rotation[2]) > 1e-9) return null
  const cos = Math.cos(building.rotation[1])
  const sin = Math.sin(building.rotation[1])
  const [px, , pz] = building.position
  return {
    building,
    toSite: (x, z) => [cos * x + sin * z + px, -sin * x + cos * z + pz],
    toLocal: (x, z) => [cos * (x - px) - sin * (z - pz), sin * (x - px) + cos * (z - pz)],
    turn: (x, z) => [cos * x + sin * z, -sin * x + cos * z],
  }
}

type Ground = (x: number, z: number) => number

/** A floor that rests on the ground and takes its height from it, not from what was drawn. */
function followsGround(nodes: SceneNodes, slab: SlabNode): boolean {
  return (
    slab.plateRole === 'base' &&
    slab.floorHeight === undefined &&
    slab.referenceFloorElevation === undefined &&
    floorPlateAtGroundContact(nodes as Record<string, AnyNode>, slab)
  )
}

/**
 * The top of a floor slab over its level's base. A floor that follows the ground is read from the
 * ground as it lies now: its stored elevation is only rewritten when the scene next settles.
 */
function floorTopOf(nodes: SceneNodes, slab: SlabNode): number {
  return followsGround(nodes, slab)
    ? automaticFloorHeight(nodes as Record<string, AnyNode>, slab)
    : slab.elevation
}

/** Corners and a grid across a polygon, no finer than half a metre, capped so a big plate stays cheap. */
function polygonSamples(polygon: Pt[], stepM = 0.5, cap = 40): Pt[] {
  const samples: Pt[] = [...polygon]
  const xs = polygon.map(([x]) => x)
  const zs = polygon.map(([, z]) => z)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)
  const stepX = Math.max(stepM, (maxX - minX) / cap)
  const stepZ = Math.max(stepM, (maxZ - minZ) / cap)
  for (let x = minX + stepX / 2; x < maxX; x += stepX)
    for (let z = minZ + stepZ / 2; z < maxZ; z += stepZ)
      if (inPolygon(x, z, polygon)) samples.push([x, z])
  return samples
}

function shoelace(polygon: Pt[]): number {
  let sum = 0
  for (let i = 0; i < polygon.length; i++) {
    const [x, z] = polygon[i] as Pt
    const [nx, nz] = polygon[(i + 1) % polygon.length] as Pt
    sum += x * nz - nx * z
  }
  return Math.abs(sum / 2)
}

/** The level a building stands on the ground by: the one it names or the stack gives, else its lowest floor. */
function groundLevel(nodes: Record<AnyNodeId, AnyNode>, building: BuildingNode): LevelNode | null {
  const named = groundLevelOf(nodes, building.id)?.level
  if (named && floorSlabsOf(nodes, named).length) return named
  const elevations = getLevelElevations(nodes)
  const levels = queryNodes<LevelNode>(nodes, { type: 'level' })
    .filter(
      (node) =>
        elevations.get(node.id)?.buildingId === building.id && floorSlabsOf(nodes, node).length > 0,
    )
    .sort((a, b) => a.level - b.level)
  return levels.find((level) => level.level >= 0) ?? levels[0] ?? null
}

/** The side of the lot a direction faces: the role of the lot edge whose outward normal it follows best. */
function lotSides(site: SiteNode): ((outward: Pt) => WallGroundFacts['side']) | null {
  const points = site.polygon?.points as Pt[] | undefined
  if (!points || points.length < 3) return null
  if (site.frontEdge === undefined && !site.streetEdges?.length) return null
  const roles = classifyEdges(
    points,
    resolveFrontEdge(points, site.frontEdge, site.northRotation),
    site.streetEdges,
  )
  const normals = points.map((_, index) => outwardNormal(points, index))
  return ([ox, oz]) => {
    let best = 0
    let bestDot = Number.NEGATIVE_INFINITY
    normals.forEach(([nx, nz], index) => {
      const dot = ox * nx + oz * nz
      if (dot > bestDot) {
        bestDot = dot
        best = index
      }
    })
    const role = roles[best]
    return role === 'front' || role === 'rear' || role === 'left' || role === 'right'
      ? role
      : undefined
  }
}

/**
 * The sill of a door or a window over the datum. Its height is counted from the floor it stands
 * on; a floor that follows the ground is read as it lies now, like the floor itself.
 */
export function sillOf(
  wall: WallNode,
  opening: { position: [number, number, number]; height: number },
  inside: Pt,
  floors: SlabNode[],
  plane: number,
  nodes: SceneNodes,
): number {
  const floor = floors.find((slab) => inPolygon(inside[0], inside[1], slab.polygon))
  const datum =
    floor && followsGround(nodes, floor)
      ? automaticFloorHeight(nodes as Record<string, AnyNode>, floor)
      : getOpeningFloorDatum(wall, opening as DoorNode, nodes)
  return plane + datum + opening.position[1] - opening.height / 2
}

/** Whether a point lies in a polygon or within `reach` of its edges. */
function inOrNear(x: number, z: number, polygon: Pt[], reach: number): boolean {
  if (inPolygon(x, z, polygon)) return true
  for (let i = 0; i < polygon.length; i++) {
    const [ax, az] = polygon[i] as Pt
    const [bx, bz] = polygon[(i + 1) % polygon.length] as Pt
    const dx = bx - ax
    const dz = bz - az
    const lengthSq = dx * dx + dz * dz
    const t = lengthSq ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSq)) : 0
    if (Math.hypot(x - ax - dx * t, z - az - dz * t) <= reach) return true
  }
  return false
}

type Exterior = { wall: WallNode; outward: 1 | -1 }

function floorlessRooms(level: LevelNode, nodes: SceneNodes): ZoneNode[] {
  return level.children.flatMap((id) => {
    const zone = nodes[id as AnyNodeId]
    return zone?.type === 'zone' &&
      zone.spaceRole === 'room' &&
      zone.hasFloor === false &&
      zone.polygon.length >= 3
      ? [zone]
      : []
  })
}

/** Whether a point of a level is inside its house: over a floor plate, or in a room with none. */
function insideOf(floors: SlabNode[], floorless: ZoneNode[]) {
  return ([x, z]: Pt) =>
    floors.some((slab) => inPolygon(x, z, slab.polygon)) ||
    floorless.some((zone) => inPolygon(x, z, zone.polygon))
}

/** The walls of a level with the house on one side only, and which side is out. */
function exteriorWalls(
  level: LevelNode,
  onFloor: (point: Pt) => boolean,
  nodes: SceneNodes,
): Exterior[] {
  const found: Exterior[] = []
  for (const id of level.children) {
    const wall = nodes[id]
    if (wall?.type !== 'wall') continue
    const length = getWallCurveLength(wall)
    if (length < 0.05) continue
    const faces = getWallFaceOffsets(wall)
    let a = 0
    let b = 0
    for (const t of [0.2, 0.5, 0.8]) {
      const frame = getWallCurveFrameAt(wall, t)
      const side = (offset: number): Pt => [
        frame.point.x + frame.normal.x * offset,
        frame.point.y + frame.normal.y * offset,
      ]
      if (onFloor(side(faces.a + 0.15))) a++
      if (onFloor(side(faces.b - 0.15))) b++
    }
    // Floor on the `b` side alone: the `a` side is out, along the normal.
    if (b >= 2 && a === 0) found.push({ wall, outward: 1 })
    else if (a >= 2 && b === 0) found.push({ wall, outward: -1 })
  }
  return found
}

/** Points just inside an exterior wall, at a fifth, half and four fifths of its length. */
function insideSide({ wall, outward }: Exterior): Pt[] {
  const faces = getWallFaceOffsets(wall)
  const offset = outward === 1 ? faces.b - 0.15 : faces.a + 0.15
  return [0.2, 0.5, 0.8].map((t) => {
    const frame = getWallCurveFrameAt(wall, t)
    return [frame.point.x + frame.normal.x * offset, frame.point.y + frame.normal.y * offset]
  })
}

function wallFacts(
  { wall, outward }: Exterior,
  frame: Frame,
  floorM: number,
  ground: Ground,
  nodes: SceneNodes,
  sideOf: ReturnType<typeof lotSides>,
  floors: SlabNode[],
  plane: number,
  storeyHeightM: number,
): WallGroundFacts {
  const L = TERRAIN_FACT_LIMITS
  const length = getWallCurveLength(wall)
  const faces = getWallFaceOffsets(wall)
  const face = outward === 1 ? faces.a : faces.b
  const floor = floorM
  // A wall is read every half metre, a very long one at 400 places.
  const count = Math.min(400, Math.max(2, Math.ceil(length / 0.5)))
  const grounds: number[] = []
  const gaps: number[] = []
  const falls: number[] = []
  const fallsAtWall: number[] = []
  const lows: number[] = []
  let toward = 0
  let earthMax = 0
  let earthSum = 0
  let earthLength = 0
  let faceBefore: WallGroundFacts['faceBefore']
  let normal: Pt = [0, 0]
  for (let i = 0; i <= count; i++) {
    const curve = getWallCurveFrameAt(wall, i / count)
    const out = (distance: number): Pt =>
      frame.toSite(
        curve.point.x + curve.normal.x * (face + outward * distance),
        curve.point.y + curve.normal.y * (face + outward * distance),
      )
    const near = ground(...out(L.fallFromM))
    const far = ground(...out(L.fallFromM + L.fallReachM))
    const fall = ((near - far) / L.fallReachM) * 100
    const atWall = ((near - ground(...out(L.fallFromM + L.fallAtWallM))) / L.fallAtWallM) * 100
    grounds.push(near)
    gaps.push(floor - near)
    falls.push(fall)
    fallsAtWall.push(atWall)
    // The ground from the wall's foot outward, every 0.2 m to 3.1 m: how far it climbs without
    // first falling (a step of more than 100 % is a face, not a climb), and its lowest within 2.5 m.
    const foot = ground(...out(0.1))
    let before = foot
    let reach = 0
    let climb = 0
    let climbing = true
    let lowest = foot
    for (let k = 1; k <= 15; k++) {
      const distance = 0.1 + 0.2 * k
      const here = ground(...out(distance))
      const step = here - before
      if (climbing) {
        if (step < -0.005) climbing = false
        else {
          reach = distance
          if (step <= 0.2) climb += Math.max(0, step)
          else if (!faceBefore || step > faceBefore.heightM)
            faceBefore = { distanceM: round(distance - 0.1), heightM: round(step) }
        }
      }
      if (distance <= 2.5) lowest = Math.min(lowest, here)
      before = here
    }
    lows.push(foot - lowest)
    if (reach >= L.runsToWallReachM && climb >= L.runsToWallRiseM) toward += length / (count + 1)
    const earth = Math.max(0, foot - floor)
    earthMax = Math.max(earthMax, earth)
    earthSum += earth
    if (earth > L.earthAgainstM) earthLength += length / (count + 1)
    if (i === Math.floor(count / 2))
      normal = frame.turn(curve.normal.x * outward, curve.normal.y * outward)
  }
  const windows: WallGroundFacts['windows'] = []
  for (const childId of wall.children ?? []) {
    const node = nodes[childId]
    if (node?.type !== 'window' || !Array.isArray(node.position)) continue
    const curve = getWallCurveFrameAt(wall, node.position[0] / length)
    const beside = (offset: number): Pt => [
      curve.point.x + curve.normal.x * offset,
      curve.point.y + curve.normal.y * offset,
    ]
    const inside = outward === 1 ? beside(faces.b - 0.15) : beside(faces.a + 0.15)
    const sill = sillOf(wall, node as never, inside, floors, plane, nodes)
    const outsideM = ground(...frame.toSite(...beside(face + outward * 0.15)))
    windows.push({
      windowId: node.id,
      sillM: round(sill),
      outsideM: round(outsideM),
      underGroundM: round(Math.max(0, outsideM - sill)),
    })
  }
  const side = sideOf?.(normal)
  const earthMean = earthSum / (count + 1)
  return {
    wallId: wall.id,
    ...(side ? { side } : {}),
    outward: [round(normal[0]), round(normal[1])],
    lengthM: round(length),
    groundM: rangeOf(grounds),
    floorOverGroundM: rangeOf(gaps),
    fallAwayPercent: { min: round(Math.min(...falls), 1), max: round(Math.max(...falls), 1) },
    fallAtWallPercent: {
      min: round(Math.min(...fallsAtWall), 1),
      max: round(Math.max(...fallsAtWall), 1),
    },
    fallsTowardLengthM: round(toward, 1),
    lowLineUnderFootM: rangeOf(lows),
    earthAgainstM: { max: round(earthMax), mean: round(earthMean) },
    earthLengthM: round(earthLength, 1),
    buriedShare: round(Math.min(1, earthMean / storeyHeightM)),
    ...(faceBefore ? { faceBefore } : {}),
    windows,
  }
}

function doorFacts(
  level: LevelNode,
  floors: SlabNode[],
  frame: Frame,
  plane: number,
  ground: Ground,
  nodes: SceneNodes,
): DoorGroundFacts[] {
  const onFloor = insideOf(floors, floorlessRooms(level, nodes))
  const others = level.children
    .map((id) => nodes[id])
    .filter(
      (node): node is SlabNode =>
        node?.type === 'slab' &&
        !node.recessed &&
        node.polygon.length >= 3 &&
        !floors.includes(node),
    )
  const facts: DoorGroundFacts[] = []
  for (const id of level.children) {
    const wall = nodes[id]
    if (wall?.type !== 'wall') continue
    const length = getWallCurveLength(wall)
    if (length < 0.05) continue
    const faces = getWallFaceOffsets(wall)
    for (const childId of wall.children ?? []) {
      const door = nodes[childId]
      if (door?.type !== 'door' || !Array.isArray(door.position)) continue
      const { position, height } = door as DoorNode
      const curve = getWallCurveFrameAt(wall, position[0] / length)
      const side = (offset: number): Pt => [
        curve.point.x + curve.normal.x * offset,
        curve.point.y + curve.normal.y * offset,
      ]
      const a = onFloor(side(faces.a + 0.15))
      const b = onFloor(side(faces.b - 0.15))
      if (a === b) continue
      const local = a ? side(faces.b - 0.6) : side(faces.a + 0.6)
      const inside = a ? side(faces.a + 0.15) : side(faces.b - 0.15)
      const sill = sillOf(wall, { position, height }, inside, floors, plane, nodes)
      const at = frame.toSite(...local)
      const landing = others
        .filter((slab) => inPolygon(local[0], local[1], slab.polygon))
        .sort((p, q) => q.elevation - p.elevation)[0]
      const outsideM = landing
        ? plane + slabTerrainHeightAt(landing, nodes, local[0], local[1])
        : ground(...at)
      facts.push({
        doorId: door.id,
        wallId: wall.id,
        levelId: level.id,
        at: [round(at[0]), round(at[1])],
        sillM: round(sill),
        outside: landing ? 'slab' : 'ground',
        ...(landing ? { outsideId: landing.id } : {}),
        outsideM: round(outsideM),
        stepM: round(sill - outsideM),
      })
    }
  }
  return facts
}

function houseFacts(
  building: BuildingNode,
  site: SiteNode,
  ground: Ground,
  nodes: SceneNodes,
): HouseGroundFacts | null {
  const record = nodes as Record<AnyNodeId, AnyNode>
  const frame = frameOf(building)
  const level = groundLevel(record, building)
  if (!frame || !level) return null
  const plane = levelPlaneWorldY(record, level.id)
  if (plane === null) return null
  const floors = floorSlabsOf(record, level)
  const tops = floors.map((slab) => plane + floorTopOf(nodes, slab))
  const storeyHeight = getLevelFloorToFloorHeight(level.id, record)
  const following = floors.flatMap((slab, index) =>
    followsGround(nodes, slab) ? [tops[index] as number] : [],
  )
  // A lower level under the floor: the floor over it is not in the air, it is a storey.
  const elevationsOf = getLevelElevations(record)
  const below = queryNodes<LevelNode>(nodes, { type: 'level' })
    .filter(
      (each) => elevationsOf.get(each.id)?.buildingId === building.id && each.level < level.level,
    )
    .flatMap((each) => floorSlabsOf(record, each))
  const gaps: number[] = []
  const grounds: number[] = []
  let over = 0
  let air = 0
  floors.forEach((slab, index) => {
    const top = tops[index] as number
    for (const [x, z] of polygonSamples(slab.polygon)) {
      const height = ground(...frame.toSite(x, z))
      grounds.push(height)
      gaps.push(top - height)
      if (height - top > TERRAIN_FACT_LIMITS.groundOverM) over++
      if (
        top - height > TERRAIN_FACT_LIMITS.floorInAirM &&
        // Over a level under it, to the thickness of a wall, the floor is a storey, not in the air.
        !below.some((lower) => inOrNear(x, z, lower.polygon, 0.35))
      )
        air++
    }
  })
  const sideOf = lotSides(site)
  // Doors of the ground level and of the levels under it: a basement that walks out has a door too.
  const elevations = getLevelElevations(record)
  const doors = queryNodes<LevelNode>(nodes, { type: 'level' })
    .filter(
      (node) => elevations.get(node.id)?.buildingId === building.id && node.level <= level.level,
    )
    .flatMap((each) => {
      const eachPlane = levelPlaneWorldY(record, each.id)
      return eachPlane === null
        ? []
        : doorFacts(each, floorSlabsOf(record, each), frame, eachPlane, ground, nodes)
    })
  const floorless = floorlessRooms(level, nodes)
  const overPlate = ([x, z]: Pt) => floors.some((slab) => inPolygon(x, z, slab.polygon))
  const walls = exteriorWalls(level, insideOf(floors, floorless), nodes).map((exterior) =>
    wallFacts(
      exterior,
      frame,
      // A wall with no floor plate inside it (a room with none) is read from its own foot.
      insideSide(exterior).some(overPlate)
        ? Math.max(...tops)
        : plane + wallSupportForNodes(exterior.wall, nodes as Record<string, AnyNode>).elevation,
      ground,
      nodes,
      sideOf,
      floors,
      plane,
      storeyHeight,
    ),
  )
  return {
    buildingId: building.id,
    levelId: level.id,
    standing: levelGradeStanding(record, level.id),
    levelBaseM: round(plane),
    storeyHeightM: round(storeyHeight),
    floorM: rangeOf(tops),
    clearHeightM: round(plane + storeyHeight - Math.max(...tops)),
    floorFollowsGround: following.length > 0,
    followingFloorOverBaseM: round(Math.max(0, ...following.map((top) => top - plane))),
    groundM: {
      lowest: rangeOf(grounds).min,
      highest: rangeOf(grounds).max,
      mean: round(grounds.reduce((sum, value) => sum + value, 0) / grounds.length),
    },
    floorOverGroundM: rangeOf(gaps),
    groundOverFloorShare: round(over / gaps.length),
    floorInAirShare: round(air / gaps.length),
    walls,
    doors,
    roomsAgainstEarth: roomsAgainstEarth(level, walls, doors, nodes),
  }
}

/** Whether two outlines touch or come within a wall's thickness of each other. */
function touches(a: Pt[], b: Pt[]): boolean {
  const reach = 0.35
  return (
    a.some(([x, z]) => inOrNear(x, z, b, reach)) || b.some(([x, z]) => inOrNear(x, z, a, reach))
  )
}

/**
 * What splits the floor of a house's ground level, and the rooms the house holds with no floor:
 * - shared base plates (not a room's own keyed floor) of one house, joined by a room or touching,
 *   standing at different heights (a detached shed on the same level is another floor);
 * - a room with an authored step off its shared base;
 * - a room with no floor plate, measured from its walls' resolved support.
 */
function floorFindings(house: HouseGroundFacts, nodes: SceneNodes): TerrainFinding[] {
  const L = TERRAIN_FACT_LIMITS
  const record = nodes as Record<AnyNodeId, AnyNode>
  const level = record[house.levelId as AnyNodeId]
  const plane = levelPlaneWorldY(record, house.levelId)
  if (level?.type !== 'level' || plane === null) return []
  const findings: TerrainFinding[] = []
  const nameOf = (zone: ZoneNode) => `${zone.name ?? 'A room'} (${zone.id})`
  const zoneOf = (id: string) => {
    const zone = record[id as AnyNodeId]
    return zone?.type === 'zone' ? zone : undefined
  }
  const floors = floorSlabsOf(record, level)
  const shared = floors.filter(
    (slab) =>
      slab.plateRole === 'base' && !(slab.zoneIds ?? []).some((id) => zoneOf(id)?.floor?.footprint),
  )
  const tops = shared.map((slab) => ({ slab, top: plane + floorTopOf(nodes, slab) }))
  // The plates of one house: joined by a room of the level (with a floor or without) or touching.
  const rooms = level.children.flatMap((id) => {
    const zone = zoneOf(id)
    return zone?.spaceRole === 'room' && zone.polygon.length >= 3 ? [zone.polygon as Pt[]] : []
  })
  const joined = (a: SlabNode, b: SlabNode) =>
    touches(a.polygon as Pt[], b.polygon as Pt[]) ||
    rooms.some((room) => touches(room, a.polygon as Pt[]) && touches(room, b.polygon as Pt[]))
  const groups: (typeof tops)[] = []
  for (const each of tops) {
    const linked = groups.filter((group) => group.some((other) => joined(other.slab, each.slab)))
    const merged = [...linked.flat(), each]
    for (const group of linked) groups.splice(groups.indexOf(group), 1)
    groups.push(merged)
  }
  for (const group of groups) {
    const high = Math.max(...group.map((each) => each.top))
    const low = Math.min(...group.map((each) => each.top))
    if (group.length > 1 && high - low > L.meetM)
      findings.push({
        code: 'floor_split',
        id: level.id,
        value: round(high - low),
        message: `The floor of ${level.id} is split into ${group.length} plates at different heights: ${group
          .map(
            ({ slab, top }) =>
              `${slab.id} at ${top.toFixed(2)} m (${(slab.zoneIds ?? [])
                .map((id) => zoneOf(id)?.name ?? id)
                .join(', ')})`,
          )
          .join('; ')}.`,
      })
  }
  for (const { slab, top } of tops) {
    for (const id of slab.zoneIds ?? []) {
      const zone = zoneOf(id)
      if (!zone || zone.hasFloor === false || zone.floor?.support === 'open') continue
      const floor = plane + roomFloorElevation(nodes, zone.id)
      const step = floor - top
      if (Math.abs(step) <= L.floorLiftM + 1e-9) continue
      findings.push({
        code: 'floor_split',
        id: zone.id,
        value: round(Math.abs(step)),
        message: `${nameOf(zone)} has an authored floor step of ${Math.abs(step).toFixed(2)} m ${step < 0 ? 'under' : 'over'} its shared base (${top.toFixed(2)} m): its walking surface is at ${floor.toFixed(2)} m.`,
      })
    }
  }
  for (const zone of floorlessRooms(level, nodes)) {
    const bases = zone.boundaryWallIds.flatMap((id) => {
      const wall = record[id as AnyNodeId]
      return wall?.type === 'wall'
        ? [plane + wallSupportForNodes(wall, record as Record<string, AnyNode>).elevation]
        : []
    })
    const foot = bases.length ? Math.min(...bases) : plane
    const floor = house.floorM.max
    findings.push({
      code: 'room_without_floor',
      id: zone.id,
      value: round(Math.abs(foot - floor)),
      message: `${nameOf(zone)} has no floor plate. Its walls stand at ${foot.toFixed(2)} m, ${Math.abs(foot - floor).toFixed(2)} m ${foot < floor ? 'under' : 'over'} the floor of ${level.id} (${floor.toFixed(2)} m); they are read here with the house's other walls.`,
    })
  }
  return findings
}

/** The rooms of a level that lie along a wall holding earth, with what their openings keep clear. */
function roomsAgainstEarth(
  level: LevelNode,
  walls: WallGroundFacts[],
  doors: DoorGroundFacts[],
  nodes: SceneNodes,
): HouseGroundFacts['roomsAgainstEarth'] {
  const L = TERRAIN_FACT_LIMITS
  const rooms: HouseGroundFacts['roomsAgainstEarth'] = []
  for (const id of level.children) {
    const zone = nodes[id]
    if (zone?.type !== 'zone' || zone.spaceRole !== 'room' || zone.polygon.length < 3) continue
    let frontage = 0
    let earthFrontage = 0
    let clear = 0
    let under = 0
    for (const facts of walls) {
      const wall = nodes[facts.wallId]
      if (wall?.type !== 'wall') continue
      const stretches = stretchesAlongWall(zone, wall)
      const along = stretches.reduce((sum, [from, to]) => sum + to - from, 0)
      if (along <= 0.05) continue
      frontage += along
      if (facts.earthAgainstM.max > L.earthAgainstM)
        earthFrontage += Math.min(along, facts.earthLengthM)
      const within = (openingId: string) => {
        const opening = nodes[openingId]
        const at = (opening as { position?: number[] } | undefined)?.position?.[0]
        return at !== undefined && stretches.some(([from, to]) => at >= from && at <= to)
      }
      for (const window of facts.windows)
        if (within(window.windowId)) window.underGroundM > L.groundOverM ? under++ : clear++
      for (const door of doors)
        if (door.wallId === facts.wallId && within(door.doorId))
          door.stepM < -L.groundOverM ? under++ : clear++
    }
    if (earthFrontage > 0.05)
      rooms.push({
        zoneId: zone.id,
        name: zone.name ?? zone.id,
        frontageM: round(frontage, 1),
        earthFrontageM: round(earthFrontage, 1),
        openingsClear: clear,
        openingsUnderGround: under,
        declared: (zone.metadata as { daylight?: unknown } | undefined)?.daylight !== undefined,
      })
  }
  return rooms
}

function surfaceFacts(
  slab: SlabNode,
  field: TerrainField | null,
  ground: Ground,
  nodes: SceneNodes,
): SurfaceGroundFacts | null {
  const record = nodes as Record<AnyNodeId, AnyNode>
  const level = slab.parentId ? nodes[slab.parentId] : undefined
  const building = level?.parentId ? nodes[level.parentId] : undefined
  if (level?.type !== 'level' || building?.type !== 'building') return null
  const frame = frameOf(building)
  const plane = levelPlaneWorldY(record, level.id)
  if (!frame || plane === null || slab.polygon.length < 3) return null
  const gaps: number[] = []
  const slopes: number[] = []
  const along: number[] = []
  const across: number[] = []
  const draped = slab.terrainMode === 'draped'
  const flatwork = (slab.metadata as { flatwork?: unknown } | undefined)?.flatwork
  const kind = typeof flatwork === 'string' ? flatwork : 'surface'
  const travelled = draped && (kind === 'driveway' || kind === 'walk')
  const top = (x: number, z: number) => plane + slabTerrainHeightAt(slab, nodes, x, z)
  /** The nearest side of the outline to a point: how far, and which way it runs. */
  const nearestSide = (x: number, z: number): { distance: number; way: Pt } => {
    let distance = Number.POSITIVE_INFINITY
    let way: Pt = [1, 0]
    for (let i = 0; i < slab.polygon.length; i++) {
      const [ax, az] = slab.polygon[i] as Pt
      const [bx, bz] = slab.polygon[(i + 1) % slab.polygon.length] as Pt
      const dx = bx - ax
      const dz = bz - az
      const lengthSq = dx * dx + dz * dz
      if (lengthSq < 1e-9) continue
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSq))
      const d = Math.hypot(x - ax - dx * t, z - az - dz * t)
      if (d < distance) {
        distance = d
        const length = Math.sqrt(lengthSq)
        way = [dx / length, dz / length]
      }
    }
    return { distance, way }
  }
  const samples = polygonSamples(slab.polygon)
  const sides = travelled ? samples.map(([x, z]) => nearestSide(x, z)) : []
  // The middle of the way: the points farthest from its sides, where a wheel or a foot goes and
  // the lattice does not mix in the batter beside it.
  const middle = Math.max(0.3, 0.75 * Math.max(0, ...sides.map((side) => side.distance)))
  const on = (px: number, pz: number) => inPolygon(px, pz, slab.polygon)
  samples.forEach(([x, z], index) => {
    const at = frame.toSite(x, z)
    gaps.push(top(x, z) - ground(...at))
    slopes.push(draped && field ? Math.tan(slopeAt(field, at[0], at[1])) * 100 : 0)
    const side = sides[index]
    if (!side || side.distance < middle) return
    const { way } = side
    const reach = 1.5
    const ends: [Pt, Pt] = [
      [x - way[0] * reach, z - way[1] * reach],
      [x + way[0] * reach, z + way[1] * reach],
    ]
    if (on(...ends[0]) && on(...ends[1]))
      along.push((Math.abs(top(...ends[1]) - top(...ends[0])) / (2 * reach)) * 100)
    const beside: [Pt, Pt] = [
      [x + way[1] * 0.4, z - way[0] * 0.4],
      [x - way[1] * 0.4, z + way[0] * 0.4],
    ]
    if (on(...beside[0]) && on(...beside[1]))
      across.push((Math.abs(top(...beside[1]) - top(...beside[0])) / 0.8) * 100)
  })
  const stat = (values: number[]) => ({
    max: round(Math.max(...values), 1),
    mean: round(values.reduce((sum, value) => sum + value, 0) / values.length, 1),
  })
  return {
    slabId: slab.id,
    kind,
    mode: draped ? 'draped' : 'flat',
    areaM2: round(shoelace(slab.polygon), 1),
    overGroundM: rangeOf(gaps),
    slopePercent: stat(along.length ? along : slopes),
    ...(along.length && across.length ? { crossFallPercent: stat(across) } : {}),
    steepestGroundPercent: round(Math.max(...slopes), 1),
  }
}

/** Outside flights: a stair that climbs to no storey. */
function stepsFacts(
  stair: StairNode,
  ground: Ground,
  nodes: SceneNodes,
  doors: DoorGroundFacts[],
): StepsGroundFacts | null {
  const record = nodes as Record<AnyNodeId, AnyNode>
  const level = stair.parentId ? nodes[stair.parentId] : undefined
  const building = level?.parentId ? nodes[level.parentId] : undefined
  if (level?.type !== 'level' || building?.type !== 'building') return null
  const frame = frameOf(building)
  const plane = levelPlaneWorldY(record, level.id)
  if (!frame || plane === null) return null
  const base = stairBaseElevation(stair, nodes as Record<string, AnyNode>, level.id)
  const foot = frame.toSite(stair.position[0], stair.position[2])
  const footM = plane + base
  const rise = stair.totalRise ?? 0
  let upper: Pt | null = null
  try {
    const surfaces = resolveStairWalkingSurfaces(stair, nodes as Record<string, AnyNode>)
    const top = surfaces.reduce<(typeof surfaces)[number] | null>(
      (best, surface) => (!best || surface.top > best.top ? surface : best),
      null,
    )
    if (top) upper = frame.toSite(top.walkingLine[1][0], top.walkingLine[1][2])
  } catch {
    upper = null
  }
  const groundAtFoot = ground(...foot)
  const near = upper
    ? doors
        .map((door) => ({ door, gap: Math.hypot(door.at[0] - upper[0], door.at[1] - upper[1]) }))
        .filter(({ gap }) => gap <= 1.2)
        .sort((p, q) => p.gap - q.gap)[0]?.door
    : undefined
  return {
    stairId: stair.id,
    foot: [round(foot[0]), round(foot[1])],
    footM: round(footM),
    groundAtFootM: round(groundAtFoot),
    footOverGroundM: round(footM - groundAtFoot),
    topM: round(footM + rise),
    ...(near ? { doorId: near.doorId, topOverSillM: round(footM + rise - near.sillM) } : {}),
  }
}

function rampGroundFacts(ramp: RampNode, ground: Ground, nodes: SceneNodes): RampGroundFacts {
  const facts = rampFacts(ramp, nodes)
  const stations = rampStations(ramp)
  const first = stations[0]
  const last = stations[stations.length - 1]
  // A cell diagonal beyond the end clears the ground the ramp itself graded.
  const beyond = 0.5 * Math.SQRT2 + 0.03
  const ends = (
    [
      [first, -1, facts.endpoints.start.heightM],
      [last, 1, facts.endpoints.end.heightM],
    ] as const
  ).flatMap(([station, sign, heightM]) => {
    if (!station) return []
    const at: Pt = [
      station.point[0] + station.tangent[0] * sign * beyond,
      station.point[1] + station.tangent[1] * sign * beyond,
    ]
    const groundBeyondM = ground(...at)
    return [
      {
        at: [round(station.point[0]), round(station.point[1])] as Pt,
        heightM: round(heightM),
        groundBeyondM: round(groundBeyondM),
        overGroundM: round(heightM - groundBeyondM),
      },
    ]
  })
  // The ground 0.15 m beyond each side, at every station: a cut-fill ramp keeps the ground that
  // was there beside its corridor, so a face stands at its edge wherever the two differ.
  let cutMaxM = 0
  let fillMaxM = 0
  let unheldLengthM = 0
  const held = Math.max(ramp.retainingHeight ?? 0, 0.3)
  for (let i = 0; i < stations.length; i++) {
    const station = stations[i] as (typeof stations)[number]
    const next = stations[i + 1] ?? station
    const before = stations[i - 1] ?? station
    const span = (next.distance - before.distance) / 2
    const surface = rampHeightAt(ramp, station.distance)
    for (const side of [1, -1]) {
      const beside = rampOffsetPoint(station, side * (ramp.width / 2 + 0.15))
      const over = ground(beside[0], beside[1]) - surface
      cutMaxM = Math.max(cutMaxM, over)
      fillMaxM = Math.max(fillMaxM, -over)
      if (Math.abs(over) > held) unheldLengthM += span
    }
  }
  return {
    rampId: ramp.id,
    lengthM: round(facts.lengthM),
    maximumSlopePercent: round(facts.maximumSlopePercent, 1),
    statedLimitPercent: facts.maxSlopePercent,
    ends,
    sides: {
      cutMaxM: round(cutMaxM),
      fillMaxM: round(fillMaxM),
      retainingHeightM: ramp.retainingHeight ?? 0,
      unheldLengthM: round(unheldLengthM, 1),
    },
  }
}

/** Lot samples at half a metre, coarser on a large lot. */
function lotSamples(site: SiteNode): { points: Pt[]; cellM2: number } {
  const polygon = (site.polygon?.points ?? []) as Pt[]
  if (polygon.length < 3) return { points: [], cellM2: 0 }
  const xs = polygon.map(([x]) => x)
  const zs = polygon.map(([, z]) => z)
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)]
  const [minZ, maxZ] = [Math.min(...zs), Math.max(...zs)]
  const width = maxX - minX
  const depth = maxZ - minZ
  const step = Math.max(0.5, Math.sqrt((width * depth) / 40_000))
  const points: Pt[] = []
  for (let x = minX + step / 2; x < maxX; x += step)
    for (let z = minZ + step / 2; z < maxZ; z += step)
      if (inPolygon(x, z, polygon)) points.push([x, z])
  return { points, cellM2: step * step }
}

function sectionOf(
  from: Pt,
  to: Pt,
  ground: Ground,
  nodes: SceneNodes,
  houses: { frame: Frame; plane: number; floors: SlabNode[] }[],
): TerrainSection {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1])
  const count = Math.max(1, Math.min(2000, Math.ceil(length / 0.25)))
  const at = (i: number): Pt => [
    from[0] + ((to[0] - from[0]) * i) / count,
    from[1] + ((to[1] - from[1]) * i) / count,
  ]
  const heights = Array.from({ length: count + 1 }, (_, i) => ground(...at(i)))
  // Keep the breakpoints: a station whose height the line through its kept neighbours misses by 2 cm.
  const keep = new Set<number>([0, count])
  const simplify = (a: number, b: number) => {
    let worst = 0
    let index = -1
    for (let i = a + 1; i < b; i++) {
      const line =
        (heights[a] as number) +
        (((heights[b] as number) - (heights[a] as number)) * (i - a)) / (b - a)
      const miss = Math.abs((heights[i] as number) - line)
      if (miss > worst) {
        worst = miss
        index = i
      }
    }
    if (index >= 0 && worst > 0.02) {
      keep.add(index)
      simplify(a, index)
      simplify(index, b)
    }
  }
  simplify(0, count)
  const floors: TerrainSection['floors'] = []
  for (const { frame, plane, floors: slabs } of houses)
    for (const slab of slabs) {
      let start = -1
      const gaps: number[] = []
      const close = (end: number) => {
        if (start < 0) return
        floors.push({
          slabId: slab.id,
          fromM: round((length * start) / count),
          toM: round((length * end) / count),
          topM: round(plane + floorTopOf(nodes, slab)),
          overGroundM: rangeOf(gaps),
        })
        start = -1
        gaps.length = 0
      }
      for (let i = 0; i <= count; i++) {
        const [x, z] = frame.toLocal(...at(i))
        if (onOrInPolygon([x, z], slab.polygon)) {
          if (start < 0) start = i
          gaps.push(plane + floorTopOf(nodes, slab) - (heights[i] as number))
        } else close(i - 1)
      }
      close(count)
    }
  return {
    from,
    to,
    lengthM: round(length),
    ground: [...keep]
      .sort((a, b) => a - b)
      .map((i) => ({ sM: round((length * i) / count), groundM: round(heights[i] as number) })),
    floors,
  }
}

/**
 * A house against a face: the least distance from the corners and mid-sides of its ground floor
 * to the face's line, and whether the ground the house stands on is the higher or the lower of
 * the two beside the face there. `null` beyond 10 m, and for a face the house's own floor covers
 * (the face that holds the ground against a house backed into a slope).
 */
function houseAtFace(
  building: BuildingNode,
  line: Pt[],
  ground: Ground,
  nodes: SceneNodes,
): { standsAt: 'top' | 'foot'; distanceM: number } | null {
  const record = nodes as Record<AnyNodeId, AnyNode>
  const frame = frameOf(building)
  const level = groundLevel(record, building)
  if (!frame || !level) return null
  let best: { distance: number; from: Pt; to: Pt } | null = null
  for (const slab of floorSlabsOf(record, level)) {
    const points = slab.polygon.flatMap((corner, i) => {
      const next = slab.polygon[(i + 1) % slab.polygon.length] as Pt
      return [corner as Pt, [(corner[0] + next[0]) / 2, (corner[1] + next[1]) / 2] as Pt]
    })
    for (const local of points) {
      const from = frame.toSite(local[0], local[1])
      for (let i = 0; i + 1 < line.length; i++) {
        const [ax, az] = line[i] as Pt
        const [bx, bz] = line[i + 1] as Pt
        const dx = bx - ax
        const dz = bz - az
        const lengthSq = dx * dx + dz * dz
        const t = lengthSq
          ? Math.max(0, Math.min(1, ((from[0] - ax) * dx + (from[1] - az) * dz) / lengthSq))
          : 0
        const to: Pt = [ax + dx * t, az + dz * t]
        const distance = Math.hypot(from[0] - to[0], from[1] - to[1])
        if (!best || distance < best.distance) best = { distance, from, to }
      }
    }
  }
  if (!best || best.distance > 10 || best.distance < 0.25) return null
  // The ground 0.3 m each side of the face, along the way from the house to it.
  const way: Pt = [
    (best.to[0] - best.from[0]) / best.distance,
    (best.to[1] - best.from[1]) / best.distance,
  ]
  const near = ground(best.to[0] - way[0] * 0.3, best.to[1] - way[1] * 0.3)
  const far = ground(best.to[0] + way[0] * 0.3, best.to[1] + way[1] * 0.3)
  if (Math.abs(near - far) < 0.3) return null
  return { standsAt: near > far ? 'top' : 'foot', distanceM: round(best.distance) }
}

const FLAT_NOTE =
  'No relief is shaped on this site: the ground is the flat datum plane at y = 0, and every fact here is measured against it.'

export type TerrainFactsOptions = { section?: { from: Pt; to: Pt } }

/** `null` for a scene with no single site: there is no ground to measure against. */
export function terrainFacts(
  nodes: SceneNodes,
  options: TerrainFactsOptions = {},
): TerrainFacts | null {
  const sites = queryNodes<SiteNode>(nodes, { type: 'site' })
  const site = sites[0]
  if (sites.length !== 1 || !site) return null
  const field = persistedTerrainFieldOf(site, nodes)
  const ground: Ground = (x, z) => (field ? heightAt(field, x, z) : 0)
  const L = TERRAIN_FACT_LIMITS
  const record = nodes as Record<AnyNodeId, AnyNode>

  const buildings = queryNodes<BuildingNode>(nodes, { type: 'building' })
  const houses = buildings.flatMap((building) => {
    const facts = houseFacts(building, site, ground, nodes)
    return facts ? [facts] : []
  })
  const doors = houses.flatMap((house) => house.doors)
  const surfaces = queryNodes<SlabNode>(nodes, { type: 'slab' }).flatMap((node) => {
    if (!isSiteFlatwork(node)) return []
    const facts = surfaceFacts(node, field, ground, nodes)
    return facts ? [facts] : []
  })
  const steps = queryNodes<StairNode>(nodes, { type: 'stair' }).flatMap((node) => {
    if (node.toLevelId) return []
    const facts = stepsFacts(node, ground, nodes, doors)
    return facts ? [facts] : []
  })
  for (const flight of steps) {
    const door = doors.find((each) => each.doorId === flight.doorId)
    if (door && !door.servedBy) door.servedBy = flight.stairId
  }
  const ramps = queryNodes<RampNode>(nodes, { type: 'ramp' }).map((node) =>
    rampGroundFacts(node, ground, nodes),
  )
  const retaining = field
    ? terrainBreaksOf(site, nodes).map((boundary) => {
        const facts = terrainBreakFacts(boundary, field)
        return {
          breakId: boundary.id,
          kind: boundary.kind,
          lengthM: round(facts.lengthM),
          heightM: { min: round(facts.dropMinM), max: round(facts.dropMaxM) },
          houses: buildings.flatMap((building) => {
            const stands = houseAtFace(building, boundary.line as Pt[], ground, nodes)
            return stands ? [{ buildingId: building.id, ...stands }] : []
          }),
        }
      })
    : []

  // The lot: banks no face holds, and the earth moved against the base ground.
  const lot = lotSamples(site)
  let steepestDeg = 0
  let bankM2 = 0
  let cutM3 = 0
  let fillM3 = 0
  const tiles = queryNodes(nodes, { type: 'terrain-tile', parentId: site.id }).length > 0
  const base =
    tiles && site.terrain
      ? persistedTerrainFieldOf({ terrain: site.terrain, polygon: site.polygon })
      : null
  if (field)
    for (const [x, z] of lot.points) {
      const deg = (slopeAt(field, x, z) * 180) / Math.PI
      steepestDeg = Math.max(steepestDeg, deg)
      if (deg > L.bankDeg) bankM2 += lot.cellM2
      if (tiles) {
        const moved = heightAt(field, x, z) - (base ? heightAt(base, x, z) : 0)
        if (moved < 0) cutM3 += -moved * lot.cellM2
        else fillM3 += moved * lot.cellM2
      }
    }

  const open: TerrainFinding[] = []
  const say = (code: TerrainFinding['code'], id: string, value: number, message: string) =>
    open.push({ code, id, value: round(value), message })
  for (const house of houses) {
    open.push(...floorFindings(house, nodes))
    if (house.floorOverGroundM.min < -L.groundOverM)
      say(
        'ground_over_floor',
        house.levelId,
        -house.floorOverGroundM.min,
        `The ground stands up to ${(-house.floorOverGroundM.min).toFixed(2)} m over the floor of ${house.levelId} (floor ${house.floorM.min.toFixed(2)} m, ground up to ${house.groundM.highest.toFixed(2)} m), over ${Math.round(house.groundOverFloorShare * 100)} % of it.`,
      )
    if (house.followingFloorOverBaseM > L.floorLiftM)
      say(
        'floor_lifted_by_ground',
        house.levelId,
        house.followingFloorOverBaseM,
        `The floor of ${house.levelId} rests on the ground and the ground at its walls stands up to ${(house.followingFloorOverBaseM - 0.05).toFixed(2)} m over the level's base (${house.levelBaseM.toFixed(2)} m): the floor follows it to ${(house.levelBaseM + house.followingFloorOverBaseM).toFixed(2)} m, the storey's top does not, and the storey keeps ${house.clearHeightM.toFixed(2)} m of its ${house.storeyHeightM.toFixed(2)} m.`,
      )
    if (house.floorOverGroundM.max > L.floorInAirM && house.floorInAirShare > 0)
      say(
        'floor_in_air',
        house.levelId,
        house.floorOverGroundM.max,
        `The floor of ${house.levelId} stands up to ${house.floorOverGroundM.max.toFixed(2)} m over the ground under it (floor ${house.floorM.max.toFixed(2)} m, ground down to ${house.groundM.lowest.toFixed(2)} m), over ${Math.round(house.floorInAirShare * 100)} % of it.`,
      )
    for (const wall of house.walls)
      if (wall.fallsTowardLengthM >= L.fallTowardLengthM)
        say(
          'ground_falls_to_wall',
          wall.wallId,
          wall.fallAwayPercent.min,
          `The ground climbs from the foot of ${wall.wallId}${wall.side ? ` (${wall.side})` : ''} along ${wall.fallsTowardLengthM.toFixed(1)} m of it, by up to ${(-wall.fallAwayPercent.min).toFixed(1)} % over ${L.fallReachM} m, with no lower line between the wall and that rise: water runs to the wall.`,
        )
    for (const wall of house.walls)
      for (const window of wall.windows)
        if (window.underGroundM > L.groundOverM)
          say(
            'window_below_ground',
            window.windowId,
            window.underGroundM,
            `The ground outside ${window.windowId} stands ${window.underGroundM.toFixed(2)} m over its sill (sill ${window.sillM.toFixed(2)} m, ground ${window.outsideM.toFixed(2)} m).`,
          )
    for (const room of house.roomsAgainstEarth)
      if (room.openingsUnderGround > 0 && room.openingsClear === 0 && !room.declared)
        say(
          'room_light_behind_earth',
          room.zoneId,
          room.earthFrontageM,
          `${room.name} (${room.zoneId}) lies along ${room.earthFrontageM.toFixed(1)} m of wall that holds earth, and each of its ${room.openingsUnderGround} openings to the outside has the ground over its sill: it takes no daylight, and states no artificial light and ventilation.`,
        )
    for (const door of house.doors) {
      if (door.stepM < -L.groundOverM)
        say(
          'door_below_ground',
          door.doorId,
          -door.stepM,
          `The ${door.outside} outside ${door.doorId} stands ${(-door.stepM).toFixed(2)} m over its sill (sill ${door.sillM.toFixed(2)} m, outside ${door.outsideM.toFixed(2)} m).`,
        )
      else if (door.stepM > L.doorStepM && !door.servedBy)
        say(
          'door_above_ground',
          door.doorId,
          door.stepM,
          `${door.doorId} opens ${door.stepM.toFixed(2)} m over the ${door.outside} outside it (sill ${door.sillM.toFixed(2)} m, outside ${door.outsideM.toFixed(2)} m), with no steps or ramp to it.`,
        )
    }
  }
  // A floor stored thinner than a slab can be: its underside stands at or over its top.
  for (const slab of queryNodes<SlabNode>(nodes, { type: 'slab' }))
    if (!isSiteFlatwork(slab) && !slab.recessed && slab.thickness < MIN_SLAB_THICKNESS)
      say(
        'floor_without_thickness',
        slab.id,
        slab.thickness,
        `The floor ${slab.id} is stored ${slab.thickness.toFixed(2)} m thick (top ${slab.elevation.toFixed(2)} m over its level's base, underside ${(slab.elevation - slab.thickness).toFixed(2)} m): a floor is at least ${MIN_SLAB_THICKNESS} m thick.`,
      )
  for (const surface of surfaces) {
    if (surface.overGroundM.max > L.surfaceOffGroundM)
      say(
        'surface_off_ground',
        surface.slabId,
        surface.overGroundM.max,
        `The ${surface.kind} ${surface.slabId} (${surface.mode}) stands up to ${surface.overGroundM.max.toFixed(2)} m over the ground under it.`,
      )
    if (surface.overGroundM.min < -L.groundOverM - 0.03)
      say(
        'surface_under_ground',
        surface.slabId,
        -surface.overGroundM.min,
        `The ground stands up to ${(-surface.overGroundM.min).toFixed(2)} m over the ${surface.kind} ${surface.slabId} (${surface.mode}).`,
      )
    const limit =
      surface.kind === 'driveway' ? L.drivePercent : surface.kind === 'walk' ? L.walkPercent : null
    if (limit !== null && surface.slopePercent.max > limit)
      say(
        'surface_steep',
        surface.slabId,
        surface.slopePercent.max,
        `The ${surface.kind} ${surface.slabId} slopes up to ${surface.slopePercent.max.toFixed(1)} % (mean ${surface.slopePercent.mean.toFixed(1)} %), over the ${limit} % stated here for a ${surface.kind}.`,
      )
  }
  for (const flight of steps) {
    if (Math.abs(flight.footOverGroundM) > L.meetM)
      say(
        'steps_off_ground',
        flight.stairId,
        flight.footOverGroundM,
        `The foot of ${flight.stairId} stands ${Math.abs(flight.footOverGroundM).toFixed(2)} m ${flight.footOverGroundM > 0 ? 'over' : 'under'} the ground (foot ${flight.footM.toFixed(2)} m, ground ${flight.groundAtFootM.toFixed(2)} m).`,
      )
    if (flight.topOverSillM !== undefined && Math.abs(flight.topOverSillM) > L.meetM)
      say(
        'steps_miss_door',
        flight.stairId,
        flight.topOverSillM,
        `The top of ${flight.stairId} stands ${Math.abs(flight.topOverSillM).toFixed(2)} m ${flight.topOverSillM > 0 ? 'over' : 'under'} the sill of ${flight.doorId} (top ${flight.topM.toFixed(2)} m).`,
      )
  }
  for (const ramp of ramps) {
    for (const end of ramp.ends)
      if (Math.abs(end.overGroundM) > L.meetM)
        say(
          'ramp_end_off_ground',
          ramp.rampId,
          end.overGroundM,
          `The end of ${ramp.rampId} at [${end.at[0]}, ${end.at[1]}] stands ${Math.abs(end.overGroundM).toFixed(2)} m ${end.overGroundM > 0 ? 'over' : 'under'} the ground beyond it (end ${end.heightM.toFixed(2)} m, ground ${end.groundBeyondM.toFixed(2)} m).`,
        )
    if (ramp.sides.unheldLengthM >= 1)
      say(
        'ramp_side_unheld',
        ramp.rampId,
        Math.max(ramp.sides.cutMaxM, ramp.sides.fillMaxM),
        `Beside ${ramp.rampId} the ground stands up to ${ramp.sides.cutMaxM.toFixed(2)} m over its surface and up to ${ramp.sides.fillMaxM.toFixed(2)} m under it, along ${ramp.sides.unheldLengthM.toFixed(1)} m of its sides, and its retaining sides are ${ramp.sides.retainingHeightM.toFixed(2)} m high: a face stands there that nothing holds.`,
      )
    if (ramp.maximumSlopePercent > ramp.statedLimitPercent + 1e-6)
      say(
        'ramp_steep',
        ramp.rampId,
        ramp.maximumSlopePercent,
        `${ramp.rampId} reaches ${ramp.maximumSlopePercent.toFixed(1)} %, over its stated ${ramp.statedLimitPercent} %.`,
      )
  }
  for (const face of retaining)
    for (const house of face.houses)
      if (
        house.standsAt === 'top' &&
        house.distanceM < L.dropEdgeM &&
        face.heightM.max >= L.dropHeightM
      )
        say(
          'house_at_drop_edge',
          house.buildingId,
          house.distanceM,
          `${house.buildingId} stands ${house.distanceM.toFixed(2)} m from the top of ${face.breakId} (${face.kind}), a drop of up to ${face.heightM.max.toFixed(2)} m.`,
        )
  if (bankM2 >= L.bankAreaM2)
    say(
      'steep_bank',
      site.id,
      steepestDeg,
      `${bankM2.toFixed(0)} m2 of the lot is ground steeper than ${L.bankDeg} degrees (up to ${steepestDeg.toFixed(0)}) that no wall or face holds.`,
    )

  const sectionHouses = buildings.flatMap((building) => {
    const frame = frameOf(building)
    const level = groundLevel(record, building)
    const plane = level ? levelPlaneWorldY(record, level.id) : null
    return frame && level && plane !== null
      ? [{ frame, plane, floors: floorSlabsOf(record, level) }]
      : []
  })
  return {
    hasTerrain: field !== null,
    houses,
    surfaces,
    steps,
    ramps,
    retaining,
    banks: { steepestDeg: round(steepestDeg, 1), areaM2: round(bankM2, 1) },
    ...(field && tiles
      ? {
          earthwork: {
            cutM3: round(cutM3, 1),
            fillM3: round(fillM3, 1),
            against: base ? 'base_field' : 'datum',
          },
        }
      : {}),
    open,
    limits: L,
    ...(options.section
      ? {
          section: sectionOf(
            options.section.from,
            options.section.to,
            ground,
            nodes,
            sectionHouses,
          ),
        }
      : {}),
    ...(field ? {} : { note: FLAT_NOTE }),
  }
}
