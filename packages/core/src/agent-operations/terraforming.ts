import { z } from 'zod'
import { isAgentRefusal, refuse } from '../agent-tools/refusal'
import {
  addStepsToGroundTool,
  gradeAlongLineTool,
  readTerrainFactsTool,
  seatHouseTool,
  setTerrainPlaneTool,
} from '../agent-tools/terraforming'
import { GROUND_SUPPORT_ID } from '../hooks/spatial-grid/support-host-id'
import { floorPlateAtGroundContact } from '../lib/floor-foundation-datum'
import { floorSlabsOf } from '../lib/grade-standing'
import { groundLevelOf } from '../lib/ground-level'
import { heightAt, quantize, type TerrainField } from '../lib/terrain-field'
import { closedHollows } from '../lib/terrain-hollows'
import { isLevelAtSiteDatum } from '../lib/terrain-support-query'
import { queryNodes } from '../runtime/node-queries'
import type { AnyNode, AnyNodeId, BuildingNode, DoorNode, LevelNode } from '../schema'
import { StairNode } from '../schema'
import {
  DEFAULT_SLAB_ELEVATION,
  DEFAULT_SLAB_THICKNESS,
  MIN_SLAB_THICKNESS,
} from '../schema/nodes/slab'
import {
  getLevelElevations,
  getLevelFloorToFloorHeight,
  levelPlaneWorldY,
} from '../services/storey'
import { pointInPolygon as onFloorPlate } from '../systems/slab/slab-support'
import { createDefaultStairSegment } from '../systems/stair/stair-flight'
import { getWallCurveFrameAt, getWallCurveLength } from '../systems/wall/wall-curve'
import { getWallFaceOffsets } from '../systems/wall/wall-frame'
import { applySceneChanges } from './apply-changes'
import { pointInPolygon, polygonBounds, type Vec2 } from './plan-geometry'
import {
  areaBounds,
  depthInsideArea,
  editingField,
  fieldSamplesIn,
  footprintOf,
  gradeHouse,
  gradeWallsOf,
  groundOf,
  houseOutline,
  insideArea,
  parseInput,
  pointOf,
  propertyOf,
  requireInsideProperty,
  type ShapingArea,
  samplingOf,
  terrainWriteOutcome,
} from './terrain'
import { sillOf, terrainFacts } from './terrain-facts'
import {
  type GradeLowLine,
  type LowLineFacts,
  MAX_LOW_LINE_CORNERS,
  outlineDistance,
} from './terrain-grade'
import type { AgentOperation, SceneChanges, SceneNodes } from './types'

const factsInput = z.strictObject(readTerrainFactsTool.input)
const seatInput = z.strictObject(seatHouseTool.input)
const planeInput = z.strictObject(setTerrainPlaneTool.input)
const lineInput = z.strictObject(gradeAlongLineTool.input)
const stepsInput = z.strictObject(addStepsToGroundTool.input)

/** How far from the property a point of a ground tool may lie, whatever its scope. */
const NEAR_LOT_M = 500
/** The most terrain samples one of these edits may visit: bounded before any is read or allocated. */
const MAX_SAMPLES = 400_000
/** The most point-against-edge tests one edit may make: samples times the corners of its area. */
const MAX_EDGE_TESTS = 20_000_000
/** The same for a house's own outline, which a seat grades against up to fifteen times. */
const MAX_OUTLINE_TESTS = 2_000_000

/** Points are finite and near the property: nothing is sized from a coordinate before this. */
export function requireNearLot(points: Vec2[], property: Vec2[], what: string): void {
  const bounds = polygonBounds(property)
  for (const [x, z] of points)
    if (
      !(Number.isFinite(x) && Number.isFinite(z)) ||
      x < bounds.minX - NEAR_LOT_M ||
      x > bounds.maxX + NEAR_LOT_M ||
      z < bounds.minZ - NEAR_LOT_M ||
      z > bounds.maxZ + NEAR_LOT_M
    )
      refuse(
        'invalid_input',
        `${what} has a point that is not finite or lies more than ${NEAR_LOT_M} m from the property.`,
      )
}

/** The samples a rectangle holds at the write lattice: refused over the limit, before the field is built. */
export function requireSampleBudget(
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number },
  haloM: number,
): void {
  const count =
    (Math.ceil((bounds.maxX - bounds.minX + 2 * haloM) / 0.5) + 2) *
    (Math.ceil((bounds.maxZ - bounds.minZ + 2 * haloM) / 0.5) + 2)
  if (!Number.isFinite(count) || count > MAX_SAMPLES)
    refuse(
      'sampling_limit',
      `The edit would visit more than ${MAX_SAMPLES.toLocaleString('en-US')} terrain samples; use a smaller area or a shorter line.`,
    )
}

const round = (value: number, digits = 2) => {
  const k = 10 ** digits
  return Math.round(value * k) / k
}

/** `read_terrain_facts`: how what is built meets the ground (terrain-facts.ts), refused where there is no one ground. */
export const readTerrainFacts: AgentOperation<z.infer<typeof factsInput>> = (nodes, raw) => {
  const input = parseInput(factsInput, raw)
  groundOf(nodes)
  const section = input.section
    ? { from: pointOf(input.section.from), to: pointOf(input.section.to) }
    : undefined
  const facts = terrainFacts(nodes, section ? { section } : {})
  if (!facts) refuse('no_site', 'The scene has no site to read the ground from.')
  return { result: facts }
}

const SEAT_DEFAULTS = { marginM: 1, padFallPercent: 5, apronM: 3 } as const

/**
 * The low line a seated house gets round its high side: a level bottom a lattice cell and a half
 * wide, 15 cm under the pad's edge at its summit, falling 1 % along its length to where it comes
 * out; before held ground it stands a metre
 * off the face, 0.25 m under the ground, and the ground falls 8 % from the face to it.
 */
const LOW_LINE: GradeLowLine = {
  widthM: 0.75,
  fallPerM: 0.01,
  underPadM: 0.15,
  offM: 1,
  depthM: 0.25,
  faceFallPerM: 0.08,
  daylightM: 8,
}

/** Ground samples under an outline: its corners and a grid across it, half a metre or 200 lines a side. */
function groundUnder(outline: Vec2[], ground: (x: number, z: number) => number) {
  const bounds = polygonBounds(outline)
  const stepX = Math.max(0.5, (bounds.maxX - bounds.minX) / 200)
  const stepZ = Math.max(0.5, (bounds.maxZ - bounds.minZ) / 200)
  let lowest = Number.POSITIVE_INFINITY
  let highest = Number.NEGATIVE_INFINITY
  let sum = 0
  let count = 0
  const take = (height: number) => {
    lowest = Math.min(lowest, height)
    highest = Math.max(highest, height)
    sum += height
    count++
  }
  for (const [x, z] of outline) take(ground(x, z))
  for (let x = bounds.minX + stepX / 2; x < bounds.maxX; x += stepX)
    for (let z = bounds.minZ + stepZ / 2; z < bounds.maxZ; z += stepZ)
      if (pointInPolygon([x, z], outline)) take(ground(x, z))
  return { lowest, highest, mean: sum / count }
}

/** The level a house is seated by: the one asked for, else the ground level of the scene's one building. */
function seatLevel(nodes: SceneNodes, levelId: string | undefined) {
  if (levelId !== undefined) return houseOutline(nodes, levelId)
  const record = nodes as Record<AnyNodeId, AnyNode>
  const buildings = queryNodes<BuildingNode>(nodes, { type: 'building' })
  const ground = buildings.length === 1 ? groundLevelOf(record, buildings[0]?.id as string) : null
  return houseOutline(nodes, ground?.level.id)
}

/** The edge of an outline that looks most to `direction`, with its outward unit normal. */
function edgeFacing(outline: Vec2[], direction: Vec2) {
  const centre: Vec2 = [
    outline.reduce((sum, point) => sum + point[0], 0) / outline.length,
    outline.reduce((sum, point) => sum + point[1], 0) / outline.length,
  ]
  let best: { from: Vec2; to: Vec2; normal: Vec2; score: number } | undefined
  outline.forEach((from, index) => {
    const to = outline[(index + 1) % outline.length] as Vec2
    const length = Math.hypot(to[0] - from[0], to[1] - from[1])
    if (length < 1e-6) return
    let normal: Vec2 = [(to[1] - from[1]) / length, -(to[0] - from[0]) / length]
    const mid: Vec2 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
    if ((mid[0] - centre[0]) * normal[0] + (mid[1] - centre[1]) * normal[1] < 0)
      normal = [-normal[0], -normal[1]]
    // The longest edge among those that face the direction squarely.
    const facing = normal[0] * direction[0] + normal[1] * direction[1]
    const score = facing > 0.7 ? facing + length / 1000 : facing - 1
    if (!best || score > best.score) best = { from, to, normal, score }
  })
  return best as { from: Vec2; to: Vec2; normal: Vec2; score: number }
}

/**
 * `seat_house`: the height a house's ground level stands at against the ground under it, the
 * building moved to it, the ground graded to meet it. The ground at the walls is brought to the
 * level's base, as it lies on a flat site: a floor that rests on the ground then stands where it
 * was drawn and the storey keeps its height. The grading is grade_around_house's (`gradeHouse`)
 * with a pad that falls away from the walls; where the base goes is what this adds.
 */
export const seatHouse: AgentOperation<z.infer<typeof seatInput>> = (nodes, raw) => {
  const input = parseInput(seatInput, raw)
  const hillside = input.strategy === 'hillside'
  if (input.strategy !== undefined && input.groundM !== undefined && !hillside)
    refuse(
      'invalid_input',
      'Give a strategy or groundM, not both (hillside alone takes groundM, as the height of its base).',
    )
  if (input.exactWall && !input.wallM) refuse('invalid_input', 'An exact wall needs wallM above 0.')
  if (hillside && (input.wallM !== undefined || input.exactWall))
    refuse(
      'invalid_input',
      'hillside holds the ground with its own face (retainM, areawayM); wallM and exactWall are not for it.',
    )
  if (!hillside && (input.retainM !== undefined || input.areawayM !== undefined))
    refuse('invalid_input', 'retainM and areawayM are for the hillside strategy.')
  const record = nodes as Record<AnyNodeId, AnyNode>
  const { site, field } = groundOf(nodes)
  const house = seatLevel(nodes, input.levelId)
  const building = nodes[house.buildingId] as BuildingNode
  const level = nodes[house.levelId] as LevelNode
  const named = building.groundLevelId
  if (named ? named !== level.id : level.level !== 0)
    refuse(
      'invalid_input',
      `${level.name ?? level.id} (${level.id}) is not the ground level of its building${named ? ` (${named} is)` : ''}: a house is seated by the level that stands on the ground.`,
    )
  const marginM = input.marginM ?? SEAT_DEFAULTS.marginM
  const strategy = hillside
    ? 'hillside'
    : input.groundM !== undefined
      ? 'ground'
      : (input.strategy ?? 'balance')
  if (strategy === 'walk_out' && input.exactWall)
    refuse(
      'invalid_input',
      'A walk-out keeps the natural slope beside the house; exactWall is not for it.',
    )
  // A terrain break holds one height on its numeric side: inside an exact wall the pad is level.
  const padFallPerM = input.exactWall
    ? 0
    : (input.padFallPercent ?? SEAT_DEFAULTS.padFallPercent) / 100
  const ground = (x: number, z: number) => (field ? heightAt(field, x, z) : 0)
  // The grading's extent, counted before it or its balance runs: the outline, the pad, the reach.
  requireSampleBudget(
    polygonBounds(house.footprint),
    marginM + (input.reachM ?? 15) + (input.apronM ?? SEAT_DEFAULTS.apronM) + 0.5,
  )
  // Every sample is measured against every side of the outline, and the balance grades up to
  // fifteen times: the product is bounded before any of it runs.
  {
    const bounds = polygonBounds(house.footprint)
    const reach = marginM + (input.reachM ?? 15) + (input.apronM ?? SEAT_DEFAULTS.apronM) + 0.5
    const samples =
      (Math.ceil((bounds.maxX - bounds.minX + 2 * reach) / 0.5) + 2) *
      (Math.ceil((bounds.maxZ - bounds.minZ + 2 * reach) / 0.5) + 2)
    if (house.footprint.length * samples > MAX_OUTLINE_TESTS)
      refuse(
        'sampling_limit',
        `The outline of the house has ${house.footprint.length} corners: with the ${samples.toLocaleString('en-US')} terrain samples of this edit that is more than ${MAX_OUTLINE_TESTS.toLocaleString('en-US')} point-against-side tests. Seat a house with a simpler floor outline, or give a shorter reachM.`,
      )
  }
  const under = groundUnder(house.footprint, ground)
  const baseM = levelPlaneWorldY(record, level.id) ?? 0
  const edgeDropM = padFallPerM * marginM

  // A walk-out: the level under the ground level opens on the ground at the low side.
  const elevations = getLevelElevations(record)
  const lower =
    strategy === 'walk_out'
      ? queryNodes<LevelNode>(nodes, { type: 'level' })
          .filter(
            (each) =>
              elevations.get(each.id)?.buildingId === building.id && each.level < level.level,
          )
          .sort((a, b) => b.level - a.level)[0]
      : undefined
  if (strategy === 'walk_out' && !lower)
    refuse(
      'invalid_input',
      `A walk-out needs a level under ${level.name ?? level.id}: the one that opens on the ground at the low side.`,
    )
  const storeyBelowM = lower ? baseM - (levelPlaneWorldY(record, lower.id) ?? baseM) : 0
  const open = lower
    ? edgeFacing(
        house.footprint,
        input.openToward
          ? pointOf(input.openToward)
          : (() => {
              // Downhill: against the ground's rise across the footprint.
              const bounds = polygonBounds(house.footprint)
              const dx =
                ground(bounds.maxX, (bounds.minZ + bounds.maxZ) / 2) -
                ground(bounds.minX, (bounds.minZ + bounds.maxZ) / 2)
              const dz =
                ground((bounds.minX + bounds.maxX) / 2, bounds.maxZ) -
                ground((bounds.minX + bounds.maxX) / 2, bounds.minZ)
              const length = Math.hypot(dx, dz) || 1
              return [-dx / length, -dz / length] as Vec2
            })(),
      )
    : undefined
  const apronM = input.apronM ?? SEAT_DEFAULTS.apronM
  const apronOutline = open
    ? ([
        open.from,
        open.to,
        [open.to[0] + open.normal[0] * apronM, open.to[1] + open.normal[1] * apronM],
        [open.from[0] + open.normal[0] * apronM, open.from[1] + open.normal[1] * apronM],
      ] as Vec2[])
    : undefined
  // A house backed into the slope: its own face holds the ground, as high as the storey unless less is asked.
  const retain = hillside
    ? {
        atM: input.areawayM ?? 0,
        heightM: input.retainM ?? getLevelFloorToFloorHeight(level.id, record),
      }
    : undefined
  const scopeInside = (points: Vec2[]) =>
    input.scope === 'context' || points.every((point) => pointInPolygon(point, propertyOf(site)))
  if (apronOutline && !scopeInside(apronOutline))
    refuse(
      'outside_property',
      'The apron before the open side reaches outside the site polygon; give a shorter apronM or another openToward.',
    )

  const grading = (padHeightM: number, exactWall: boolean) =>
    gradeHouse(
      nodes,
      {
        scope: input.scope,
        footprint: house.footprint,
        padHeightM,
        marginM,
        run: input.run,
        reachM: input.reachM,
        terraceRiserM: input.terraceRiserM,
        wallM: input.wallM,
        ...(exactWall ? { exactWall: true } : {}),
      },
      {
        padFallPerM,
        replaceWalls: true,
        // A declared wall at the pad's edge is the caller's own answer to the high side.
        ...(input.wallM ? {} : { lowLine: LOW_LINE }),
        ...(retain ? { retain } : {}),
        ...(apronOutline
          ? {
              // The hill is cut back where it stands over the ground level's base and keeps its
              // slope where it does not; the apron stands at the lower level's base.
              cutOnly: true,
              morePads: [{ outline: apronOutline, heightM: padHeightM - storeyBelowM, marginM: 0 }],
            }
          : {}),
      },
    )
  /** Cut minus fill of the grading with the pad at `padHeightM`: falls as the pad rises. */
  const net = (padHeightM: number): number => {
    try {
      const result = grading(padHeightM, false).result as {
        cutVolumeM3: number
        fillVolumeM3: number
      }
      return result.cutVolumeM3 - result.fillVolumeM3
    } catch (error) {
      if (isAgentRefusal(error) && error.code === 'no_change') return 0
      throw error
    }
  }
  const balanced = (): number => {
    let low = under.lowest - 0.5
    let high = under.highest + 0.5
    for (let i = 0; i < 14 && high - low > 0.005; i++) {
      const mid = (low + high) / 2
      if (net(mid) > 0) low = mid
      else high = mid
    }
    return (low + high) / 2
  }
  // The lowest ground along the open side: the lower level's base stands on it.
  const openGroundM = open
    ? Math.min(
        ...Array.from({ length: 21 }, (_, i) =>
          ground(
            open.from[0] + ((open.to[0] - open.from[0]) * i) / 20 + open.normal[0] * 0.5,
            open.from[1] + ((open.to[1] - open.from[1]) * i) / 20 + open.normal[1] * 0.5,
          ),
        ),
      )
    : 0
  // Ground already level under the house at its base: the house is seated, and seating it
  // again by the same rule leaves it where it stands.
  // The ground at the pad's edge, a margin out from the middle of each side of the outline (a
  // point a re-entrant corner brings nearer another wall is on the pad, not at its edge).
  const padEdges = house.footprint.flatMap((from, index) => {
    const to = house.footprint[(index + 1) % house.footprint.length] as Vec2
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1
    const mid: Vec2 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
    const out: Vec2 = [(to[1] - from[1]) / length, -(to[0] - from[0]) / length]
    const sign = pointInPolygon([mid[0] + out[0] * 0.05, mid[1] + out[1] * 0.05], house.footprint)
      ? -1
      : 1
    const at: Vec2 = [mid[0] + sign * out[0] * marginM, mid[1] + sign * out[1] * marginM]
    return outlineDistance(at, house.footprint) >= marginM - 0.05 ? [ground(at[0], at[1])] : []
  })
  const seated =
    under.highest - under.lowest < 0.03 &&
    Math.abs(under.lowest - baseM) < 0.08 &&
    (edgeDropM < 0.005 ||
      (padEdges.length > 0 && Math.max(...padEdges) <= baseM - edgeDropM + 0.02) ||
      // Backed into the slope already: the face that holds the ground is there.
      (hillside && gradeWallsOf(nodes, site, house.footprint).length > 0))
  const wanted =
    strategy === 'ground' || (hillside && input.groundM !== undefined)
      ? (input.groundM as number)
      : (strategy === 'fill' || strategy === 'cut' || strategy === 'balance' || hillside) && seated
        ? baseM
        : strategy === 'fill'
          ? under.highest + edgeDropM
          : strategy === 'cut' || hillside
            ? under.lowest + edgeDropM
            : strategy === 'keep'
              ? baseM
              : strategy === 'walk_out'
                ? openGroundM + storeyBelowM
                : // Level ground has nothing to balance: the pad's edge stands on it, as fill does,
                  // so the fall of the pad is a rise to the walls and not a hollow round the house.
                  under.highest - under.lowest < 0.03
                  ? under.highest + edgeDropM
                  : balanced()
  // A balance within 3 cm of where the house stands is not worth moving it for.
  const padHeightM = round(
    strategy === 'balance' && Math.abs(wanted - baseM) < 0.03 ? baseM : wanted,
  )
  const movedBy = Math.abs(padHeightM - baseM) < 5e-4 ? 0 : round(padHeightM - baseM, 4)

  let graded: ReturnType<typeof grading> | undefined
  try {
    graded = grading(padHeightM, input.exactWall === true)
  } catch (error) {
    if (!(isAgentRefusal(error) && error.code === 'no_change')) throw error
  }
  const [x, y, z] = building.position
  const seats: { id: string; data: Partial<AnyNode> }[] =
    movedBy !== 0 || (strategy !== 'keep' && !named)
      ? [
          {
            id: building.id,
            data: {
              position: [x, round(y + movedBy, 4), z],
              groundLevelId: level.id,
            } as Partial<AnyNode>,
          },
        ]
      : []
  // A floor the ground lifted before a level was put under it no longer follows the ground: it
  // kept the lift. Seated, it goes back on the base of its level, where a floor is drawn.
  // A plate a scene stored thinner than a slab can be takes a slab's thickness, whatever the strategy.
  const putBack = floorSlabsOf(record, level).filter(
    (slab) =>
      slab.plateRole === 'base' &&
      slab.floorHeight === undefined &&
      slab.referenceFloorElevation === undefined &&
      !floorPlateAtGroundContact(nodes as Record<string, AnyNode>, slab) &&
      (slab.thickness < MIN_SLAB_THICKNESS ||
        (strategy !== 'keep' && Math.abs(slab.elevation - DEFAULT_SLAB_ELEVATION) > 0.01)),
  )
  for (const slab of putBack)
    seats.push({
      id: slab.id,
      data: {
        elevation: strategy === 'keep' ? slab.elevation : DEFAULT_SLAB_ELEVATION,
        ...(slab.thickness < MIN_SLAB_THICKNESS ? { thickness: DEFAULT_SLAB_THICKNESS } : {}),
      } as Partial<AnyNode>,
    })
  // A regrading that moves a few samples by a centimetre is the lattice, not a change.
  const regraded =
    graded &&
    ((graded.result as { cutVolumeM3: number }).cutVolumeM3 +
      (graded.result as { fillVolumeM3: number }).fillVolumeM3 >=
      0.25 ||
      // A face is a change unless the one it replaces is the same face.
      (graded.changes?.create ?? []).some(({ node }) => {
        if (node.type !== 'terrain-break') return false
        const replaced = (graded?.changes?.delete ?? []).map((id) => nodes[id])
        return !replaced.some(
          (old) =>
            old?.type === 'terrain-break' &&
            old.left === node.left &&
            JSON.stringify(old.line) === JSON.stringify(node.line),
        )
      }) ||
      (graded.changes?.delete?.length ?? 0) >
        (graded.changes?.create ?? []).filter(({ node }) => node.type === 'terrain-break').length)
  if (!regraded) graded = undefined
  if (!graded && !seats.length)
    refuse(
      'no_change',
      'The house already stands at that height and no terrain sample would move; nothing was written.',
    )
  const changes: SceneChanges = {
    ...(graded?.changes ?? {}),
    update: [...(graded?.changes?.update ?? []), ...seats],
  }
  // Flights that climbed to this house's doors from the ground: the sills and the ground have
  // moved, so each is solved again from the two, or taken away where its door now meets the ground.
  const stepsResolved: {
    stairId: string
    doorId: string
    stepCount?: number
    riseM?: number
    removed?: true
  }[] = []
  const stepsUnmet: string[] = []
  // Only a flight this set makes: one straight segment standing on the ground, to a door that
  // opens on the ground (a door with a stoop, a flight of several segments are left as drawn).
  const readBefore = terrainFacts({ ...nodes })
  const flights = (readBefore?.steps ?? []).filter((flight) => {
    const stair = nodes[flight.stairId]
    const parent = stair?.parentId ? nodes[stair.parentId] : undefined
    const door = readBefore?.houses
      .flatMap((each) => each.doors)
      .find((each) => each.doorId === flight.doorId)
    return (
      stair?.type === 'stair' &&
      parent?.parentId === building.id &&
      stair.supportSlabId === GROUND_SUPPORT_ID &&
      stair.stairType === 'straight' &&
      (stair.children ?? []).length === 1 &&
      door?.outside === 'ground'
    )
  })
  if (flights.length) {
    const seatedNodes = applySceneChanges(nodes, changes) as SceneNodes
    for (const flight of flights) {
      const stair = nodes[flight.stairId] as StairNode
      const doorId = flight.doorId as string
      let solved: DoorSteps
      try {
        solved = solveDoorSteps(seatedNodes, doorId)
      } catch (error) {
        if (!isAgentRefusal(error)) throw error
        continue
      }
      const storey = getLevelFloorToFloorHeight(solved.level.id, seatedNodes as never)
      if (solved.rise < 0.05) {
        changes.delete = [...(changes.delete ?? []), stair.id]
        stepsResolved.push({ stairId: stair.id, doorId, removed: true })
        if (solved.rise < -0.02)
          stepsUnmet.push(
            `The ground outside ${doorId} now stands ${(-solved.rise).toFixed(2)} m over its sill; its steps were taken away.`,
          )
        continue
      }
      if (solved.rise >= Math.min(storey, 2)) {
        stepsUnmet.push(
          `The sill of ${doorId} now stands ${solved.rise.toFixed(2)} m over the ground: its steps (${stair.id}) are left as they were, no longer a flight to the ground.`,
        )
        continue
      }
      const segmentId = stair.children?.[0]
      changes.update = [
        ...(changes.update ?? []),
        {
          id: stair.id,
          data: {
            position: [solved.foot[0], round(solved.footY, 4), solved.foot[1]],
            rotation: solved.rotation,
            totalRise: solved.rise,
            stepCount: solved.stepCount,
            railingMode: solved.stepCount > 3 ? 'both' : 'none',
          } as Partial<AnyNode>,
        },
        ...(segmentId
          ? [
              {
                id: segmentId,
                data: {
                  height: solved.rise,
                  length: solved.runM,
                  stepCount: solved.stepCount,
                } as Partial<AnyNode>,
              },
            ]
          : []),
      ]
      stepsResolved.push({
        stairId: stair.id,
        doorId,
        stepCount: solved.stepCount,
        riseM: round(solved.rise, 3),
      })
    }
  }
  const result = (graded?.result ?? {}) as Record<string, unknown>
  const daylight = result.daylight as
    | { reached: boolean; farthestChangeM: number; outsideLotM2: number; outsideLotMaxM?: number }
    | undefined
  // What the grading could not do, said: the property line and the reach bound it.
  const unmet: string[] = []
  if (daylight && daylight.outsideLotM2 > 0)
    unmet.push(
      `The batter wanted ${daylight.outsideLotM2.toFixed(0)} m2 beyond the property and stopped at its line: the ground steps up to ${(daylight.outsideLotMaxM ?? 0).toFixed(2)} m there.`,
    )
  if (open && padHeightM - under.highest > 0.2)
    unmet.push(
      `The ground falls ${(under.highest - under.lowest).toFixed(2)} m across the house, less than the ${storeyBelowM.toFixed(2)} m between the two levels: the base of the ground level stands ${(padHeightM - under.highest).toFixed(2)} m over the highest ground under the house, and on that side the ground does not reach it.`,
    )
  if (daylight && !daylight.reached)
    unmet.push(
      `The batter did not meet the ground within reachM (${(input.reachM ?? 15).toFixed(0)} m): a face stands where it stopped.`,
    )
  const lowLine = result.lowLine as LowLineFacts | undefined
  if (!input.wallM && house.footprint.length > MAX_LOW_LINE_CORNERS)
    unmet.push(
      `The outline of the house has ${house.footprint.length} corners, over the ${MAX_LOW_LINE_CORNERS} a low line is solved round: none was made, and the ground may run to the walls on the high side.`,
    )
  if (seated && (strategy === 'cut' || strategy === 'fill' || hillside) && graded)
    unmet.push(
      `The ground under the house already lay level at the base of its ground level (${baseM.toFixed(2)} m), as an earlier seating leaves it: the base is kept there and the ground is graded from where it lies now. The slope that was there before that seating is not known to this one.`,
    )
  if (lowLine?.closed)
    unmet.push(
      'The ground stands over the base of the house on every side: the low line round it has nowhere to run to, and water stands in it unless a drain takes it.',
    )
  else if (lowLine && lowLine.blindEnds > 0)
    unmet.push(
      `The low line round the high side did not come out on lower ground within ${LOW_LINE.daylightM} m at ${lowLine.blindEnds} of its ends: water stands there.`,
    )
  const facts = {
    strategy,
    levelId: level.id,
    buildingId: building.id,
    groundAtWallsM: padHeightM,
    movedBuildingByM: movedBy,
    padEdgeM: round(padHeightM - padFallPerM * marginM),
    groundUnderHouseM: {
      lowest: round(under.lowest),
      highest: round(under.highest),
      mean: round(under.mean),
    },
    cutVolumeM3: (result.cutVolumeM3 as number | undefined) ?? 0,
    fillVolumeM3: (result.fillVolumeM3 as number | undefined) ?? 0,
    netM3: (result.netM3 as number | undefined) ?? 0,
    changedSamples: (result.changedSamples as number | undefined) ?? 0,
    ...(graded
      ? {
          batterSlopeDeg: result.batterSlopeDeg,
          steepestSampledSlopeDeg: result.steepestSampledSlopeDeg,
          daylight: daylight
            ? {
                reached: daylight.reached,
                farthestChangeM: daylight.farthestChangeM,
                outsideLotM2: daylight.outsideLotM2,
              }
            : undefined,
          ...(result.wall ? { wall: result.wall } : {}),
          ...(result.terraces ? { terraces: result.terraces } : {}),
          sampling: result.sampling,
        }
      : {}),
    ...(lowLine
      ? {
          lowLine: {
            lengthM: round(lowLine.lengthM, 1),
            summitM: round(lowLine.summitM),
            lowestM: round(lowLine.lowestM),
            deepestCutM: round(lowLine.deepestCutM),
            outlets: lowLine.outlets,
          },
        }
      : {}),
    ...(retain
      ? {
          hillside: {
            retainM: round(retain.heightM),
            areawayM: retain.atM,
            ...(result.face ? { faceBreakId: (result.face as { breakId: string }).breakId } : {}),
          },
        }
      : {}),
    ...(open && lower
      ? {
          walkOut: {
            lowerLevelId: lower.id,
            lowerBaseM: round(padHeightM - storeyBelowM),
            openSide: [round(open.normal[0]), round(open.normal[1])],
            fallAcrossHouseM: round(under.highest - under.lowest),
            storeyBelowM: round(storeyBelowM),
            apron: apronOutline?.map(([px, pz]) => [round(px), round(pz)]),
          },
        }
      : {}),
    ...(putBack.length ? { floorsPutBack: putBack.map((slab) => slab.id) } : {}),
    ...(stepsResolved.length ? { stepsResolved } : {}),
    unmet: [...unmet, ...stepsUnmet],
  }
  /** The house as it stands once the scene has settled: a floor that follows the ground has moved. */
  const settled = (after: SceneNodes) => {
    // A copy of the record: what a host remembers against its own is not this operation's to trust.
    const read = terrainFacts({ ...after })
    const seated = read?.houses.find((each) => each.buildingId === building.id)
    const about = new Set<string>([
      level.id,
      ...(seated?.walls.map((wall) => wall.wallId) ?? []),
      ...(seated?.doors.map((door) => door.doorId) ?? []),
    ])
    // A level under the one seated, its door under the ground: this strategy did not open it.
    const buried = (seated?.doors ?? []).filter(
      (door) => door.levelId !== level.id && door.stepM < -0.02 && strategy !== 'walk_out',
    )
    return {
      ...facts,
      unmet: [
        ...facts.unmet,
        ...buried.map(
          (door) =>
            `${door.doorId}, on the level under ${level.name ?? level.id}, has the ground ${(-door.stepM).toFixed(2)} m over its sill: this strategy seats the ground level and leaves the level under it in the ground; walk_out stands that level on the low ground.`,
        ),
      ],
      floorM: seated?.floorM.max ?? padHeightM,
      after: {
        floorOverGroundM: seated?.floorOverGroundM ?? { min: 0, max: 0 },
        clearHeightM: seated?.clearHeightM ?? 0,
        doors: (seated?.doors ?? []).map((door) => ({
          doorId: door.doorId,
          levelId: door.levelId,
          stepM: door.stepM,
          outside: door.outside,
        })),
        open: (read?.open ?? []).filter((finding) => about.has(finding.id)),
      },
    }
  }
  return {
    result: settled(applySceneChanges(nodes, changes) as SceneNodes),
    changes,
    afterReconcile: (after) => ({ result: settled(after) }),
  }
}

type Plane = { at: (x: number, z: number) => number; gradient: Vec2 }

/** The plane one, two or three points with heights give. */
function planeThrough(points: { at: Vec2; heightM: number }[]): Plane {
  const [a, b, c] = points
  if (!a) refuse('invalid_input', 'A plane needs at least one point with a height.')
  if (!b) return { at: () => a.heightM, gradient: [0, 0] }
  if (!c) {
    const dx = b.at[0] - a.at[0]
    const dz = b.at[1] - a.at[1]
    const lengthSq = dx * dx + dz * dz
    if (lengthSq < 1e-9) refuse('invalid_input', 'The two points of the plane coincide.')
    const rise = (b.heightM - a.heightM) / lengthSq
    return {
      at: (x, z) => a.heightM + rise * ((x - a.at[0]) * dx + (z - a.at[1]) * dz),
      gradient: [rise * dx, rise * dz],
    }
  }
  const ux = b.at[0] - a.at[0]
  const uz = b.at[1] - a.at[1]
  const vx = c.at[0] - a.at[0]
  const vz = c.at[1] - a.at[1]
  const det = ux * vz - vx * uz
  if (Math.abs(det) < 1e-9)
    refuse('invalid_input', 'The three points of the plane lie in a line; they do not fix a plane.')
  const gx = ((b.heightM - a.heightM) * vz - (c.heightM - a.heightM) * uz) / det
  const gz = ((c.heightM - a.heightM) * ux - (b.heightM - a.heightM) * vx) / det
  return {
    at: (x, z) => a.heightM + gx * (x - a.at[0]) + gz * (z - a.at[1]),
    gradient: [gx, gz],
  }
}

/** `set_terrain_plane`: the ground over an area as one sloping plane, blended back outside it. */
export const setTerrainPlane: AgentOperation<z.infer<typeof planeInput>> = (nodes, raw) => {
  const input = parseInput(planeInput, raw)
  const { site } = groundOf(nodes)
  const property = propertyOf(site)
  const area: ShapingArea = Array.isArray(input.area)
    ? { kind: 'polygon', polygon: footprintOf(input.area) }
    : { kind: 'circle', center: pointOf(input.area.center), radiusM: input.area.radiusM }
  requireNearLot(area.kind === 'polygon' ? area.polygon : [area.center], property, 'The area')
  requireNearLot(
    input.through.map((point) => pointOf(point.at)),
    property,
    'The plane',
  )
  if (input.scope !== 'context') requireInsideProperty(area, property)
  const plane = planeThrough(
    input.through.map((point) => ({ at: pointOf(point.at), heightM: point.heightM })),
  )
  const blendM = input.blendM ?? 0
  const bounds = areaBounds(area)
  requireSampleBudget(bounds, blendM + 0.5)
  // Each sample is tested against every edge of a polygon: the product is bounded too.
  if (area.kind === 'polygon') {
    const visits =
      area.polygon.length *
      (Math.ceil((bounds.maxX - bounds.minX + 2 * blendM) / 0.5) + 2) *
      (Math.ceil((bounds.maxZ - bounds.minZ + 2 * blendM) / 0.5) + 2)
    if (visits > MAX_EDGE_TESTS)
      refuse(
        'sampling_limit',
        `An area of ${area.polygon.length} corners over this extent takes more than ${MAX_EDGE_TESTS.toLocaleString('en-US')} edge tests; use fewer corners or a smaller area.`,
      )
  }
  const field = editingField(site, nodes, area, blendM + 0.5)
  const samples = fieldSamplesIn(field, {
    minX: bounds.minX - blendM,
    minZ: bounds.minZ - blendM,
    maxX: bounds.maxX + blendM,
    maxZ: bounds.maxZ + blendM,
  }).filter((sample) => input.scope === 'context' || pointInPolygon(sample.point, property))
  const heights = new Int16Array(field.heights)
  const cellM2 = field.spacing * field.spacing
  let cutVolumeM3 = 0
  let fillVolumeM3 = 0
  let changedSamples = 0
  let minM = Number.POSITIVE_INFINITY
  let maxM = Number.NEGATIVE_INFINITY
  for (const sample of samples) {
    const beforeQ = field.heights[sample.index] ?? 0
    const beforeM = beforeQ * field.step
    const onPlane = plane.at(sample.point[0], sample.point[1])
    const inside = insideArea(area, sample.point)
    let target = beforeM
    if (inside) target = onPlane
    else if (blendM > 0) {
      const depth = depthInsideArea(area, sample.point)
      if (depth > -blendM) target = beforeM + (onPlane - beforeM) * (1 + depth / blendM)
    }
    const nextQ = quantize(field, target)
    if (inside) {
      minM = Math.min(minM, nextQ * field.step)
      maxM = Math.max(maxM, nextQ * field.step)
    }
    if (nextQ === beforeQ) continue
    heights[sample.index] = nextQ
    changedSamples++
    const movedM = (nextQ - beforeQ) * field.step
    if (movedM < 0) cutVolumeM3 += -movedM * cellM2
    else fillVolumeM3 += movedM * cellM2
  }
  if (!Number.isFinite(minM))
    refuse(
      'no_change',
      'The area holds no terrain sample inside the property; nothing was written.',
    )
  const slope = Math.hypot(plane.gradient[0], plane.gradient[1])
  return terrainWriteOutcome(site, nodes, field, heights, {
    slopePercent: round(slope * 100, 2),
    fallDirection:
      slope < 1e-9
        ? [0, 0]
        : [round(-plane.gradient[0] / slope, 3), round(-plane.gradient[1] / slope, 3)],
    minM,
    maxM,
    cutVolumeM3,
    fillVolumeM3,
    netM3: cutVolumeM3 - fillVolumeM3,
    changedSamples,
    sampling: samplingOf(field, 'field_samples_in_area', samples.length),
  })
}

const LINE_STATION_M = 0.5
/** The longest line a strip is graded along: its stations are bounded by this before any is made. */
const MAX_LINE_M = 2000
/** The farthest a strip with its batters may reach to a side. */
const MAX_STRIP_REACH_M = 40

type Station = { s: number; point: Vec2; ground: number; height: number }

/** The breakpoints of a profile: the stations a straight line through their kept neighbours misses by 2 cm. */
function breakpoints(stations: Station[]): Station[] {
  const keep = new Set<number>([0, stations.length - 1])
  const visit = (a: number, b: number) => {
    let worst = 0
    let index = -1
    const from = stations[a] as Station
    const to = stations[b] as Station
    for (let i = a + 1; i < b; i++) {
      const each = stations[i] as Station
      const t = (each.s - from.s) / (to.s - from.s)
      const miss = Math.max(
        Math.abs(each.height - (from.height + (to.height - from.height) * t)),
        Math.abs(each.ground - (from.ground + (to.ground - from.ground) * t)),
      )
      if (miss > worst) {
        worst = miss
        index = i
      }
    }
    if (index >= 0 && worst > 0.02) {
      keep.add(index)
      visit(a, index)
      visit(index, b)
    }
  }
  visit(0, stations.length - 1)
  return [...keep].sort((a, b) => a - b).map((i) => stations[i] as Station)
}

/**
 * `grade_along_line`: a strip of ground along a line, level across, standing `offsetM` over the
 * ground that was there and, with a slope limit, eased so no stretch is steeper. The eased profile
 * is the mean of the gentlest profiles lying over and under the ground, held between the cones
 * the limit allows from each end: it cuts the rises and fills the dips in like measure.
 */
export const gradeAlongLine: AgentOperation<z.infer<typeof lineInput>> = (nodes, raw) => {
  const input = parseInput(lineInput, raw)
  const { site, field: persisted } = groundOf(nodes)
  const property = propertyOf(site)
  const line = input.line.map(pointOf)
  const widthM = input.widthM ?? 1.2
  const offsetM = input.offsetM ?? 0
  const run = input.run ?? 2
  if (
    (input.startHeightM !== undefined || input.endHeightM !== undefined) &&
    input.maxSlopePercent === undefined
  )
    refuse(
      'invalid_input',
      'A stated end height needs maxSlopePercent: the strip is eased from that height to the ground within it.',
    )
  // Bounds first: nothing below is sized from a coordinate, a length or a height before these.
  requireNearLot(line, property, 'The line')
  if (input.scope !== 'context' && !line.every((point) => pointInPolygon(point, property)))
    refuse('outside_property', 'The line reaches outside the site polygon; nothing was written.')
  const segments = line.slice(1).map((to, index) => {
    const from = line[index] as Vec2
    const length = Math.hypot(to[0] - from[0], to[1] - from[1])
    if (length < 1e-6) refuse('invalid_input', 'Two consecutive points of the line coincide.')
    return { from, to, length, count: Math.max(1, Math.ceil(length / LINE_STATION_M)), first: 0 }
  })
  const totalLengthM = segments.reduce((sum, segment) => sum + segment.length, 0)
  if (totalLengthM > MAX_LINE_M)
    refuse(
      'sampling_limit',
      `The line is ${totalLengthM.toFixed(0)} m long; a strip is graded along at most ${MAX_LINE_M} m.`,
    )
  const ground = (x: number, z: number) => (persisted ? heightAt(persisted, x, z) : 0)

  // Stations along the line, the corners of the line among them: at most MAX_LINE_M / LINE_STATION_M + 64.
  const stations: Station[] = []
  let travelled = 0
  segments.forEach((segment, index) => {
    const { from, to, length, count } = segment
    segment.first = index === 0 ? 0 : stations.length - 1
    for (let i = index === 0 ? 0 : 1; i <= count; i++) {
      const point: Vec2 = [
        from[0] + ((to[0] - from[0]) * i) / count,
        from[1] + ((to[1] - from[1]) * i) / count,
      ]
      const height = ground(point[0], point[1])
      stations.push({
        s: travelled + (length * i) / count,
        point,
        ground: height,
        height: height + offsetM,
      })
    }
    travelled += length
  })
  const first = stations[0] as Station
  const last = stations[stations.length - 1] as Station
  const lengthM = last.s
  if (input.startHeightM !== undefined) first.height = input.startHeightM
  if (input.endHeightM !== undefined) last.height = input.endHeightM
  if (input.maxSlopePercent !== undefined) {
    const slope = input.maxSlopePercent / 100
    const rise = Math.abs(last.height - first.height)
    if (rise > slope * lengthM + 1e-6)
      refuse(
        'slope_limit_unreachable',
        `The ends differ by ${rise.toFixed(2)} m over ${lengthM.toFixed(1)} m (${((rise / lengthM) * 100).toFixed(1)} %): ${input.maxSlopePercent} % needs a line of at least ${(rise / slope).toFixed(1)} m between them, or other end heights.`,
        { riseM: rise, lengthM, neededLengthM: rise / slope },
      )
    const under = stations.map((station) => station.height)
    const over = [...under]
    for (let i = 1; i < stations.length; i++) {
      const reach = slope * ((stations[i] as Station).s - (stations[i - 1] as Station).s)
      under[i] = Math.max(under[i] as number, (under[i - 1] as number) - reach)
      over[i] = Math.min(over[i] as number, (over[i - 1] as number) + reach)
    }
    for (let i = stations.length - 2; i >= 0; i--) {
      const reach = slope * ((stations[i + 1] as Station).s - (stations[i] as Station).s)
      under[i] = Math.max(under[i] as number, (under[i + 1] as number) - reach)
      over[i] = Math.min(over[i] as number, (over[i + 1] as number) + reach)
    }
    stations.forEach((station, i) => {
      const fromStart = slope * station.s
      const fromEnd = slope * (lengthM - station.s)
      const low = Math.max(first.height - fromStart, last.height - fromEnd)
      const high = Math.min(first.height + fromStart, last.height + fromEnd)
      const eased = ((under[i] as number) + (over[i] as number)) / 2
      station.height = Math.max(low, Math.min(high, eased))
    })
  }
  const deviation = Math.max(
    ...stations.map((station) => Math.abs(station.height - station.ground)),
  )
  const half = widthM / 2
  const haloM = half + run * deviation + 1
  if (haloM > MAX_STRIP_REACH_M)
    refuse(
      'invalid_input',
      `The strip stands up to ${deviation.toFixed(2)} m off the ground: with its batters it would reach ${haloM.toFixed(0)} m to a side, over the ${MAX_STRIP_REACH_M} m a strip may. Give end heights nearer the ground, a steeper side batter or a gentler slope limit.`,
    )

  const bounds = polygonBounds(line)
  requireSampleBudget(bounds, haloM + 0.5)
  const field: TerrainField = editingField(
    site,
    nodes,
    {
      kind: 'polygon',
      polygon: [
        [bounds.minX, bounds.minZ],
        [bounds.maxX, bounds.minZ],
        [bounds.maxX, bounds.maxZ],
        [bounds.minX, bounds.maxZ],
      ],
    },
    haloM + 0.5,
  )
  const samples = fieldSamplesIn(field, {
    minX: bounds.minX - haloM,
    minZ: bounds.minZ - haloM,
    maxX: bounds.maxX + haloM,
    maxZ: bounds.maxZ + haloM,
  }).filter((sample) => input.scope === 'context' || pointInPolygon(sample.point, property))
  const heights = new Int16Array(field.heights)
  const cellM2 = field.spacing * field.spacing
  let cutVolumeM3 = 0
  let fillVolumeM3 = 0
  let changedSamples = 0
  /** The strip's height `t` of the way along a segment of the line, between its two stations there. */
  const heightOn = (segment: (typeof segments)[number], t: number) => {
    const along = Math.max(0, Math.min(1, t)) * segment.count
    const index = Math.min(segment.count - 1, Math.floor(along))
    const a = stations[segment.first + index] as Station
    const b = stations[segment.first + index + 1] as Station
    return a.height + (b.height - a.height) * (along - index)
  }
  for (const sample of samples) {
    // The nearest point of the line that is not beyond one of its ends: one test per segment of
    // the line (64 points at most), not per station.
    let nearest = Number.POSITIVE_INFINITY
    let heightM = 0
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i] as (typeof segments)[number]
      const dx = segment.to[0] - segment.from[0]
      const dz = segment.to[1] - segment.from[1]
      const t =
        ((sample.point[0] - segment.from[0]) * dx + (sample.point[1] - segment.from[1]) * dz) /
        (segment.length * segment.length)
      if ((i === 0 && t < 0) || (i + 1 === segments.length && t > 1)) continue
      const clamped = Math.max(0, Math.min(1, t))
      const distance = Math.hypot(
        sample.point[0] - (segment.from[0] + dx * clamped),
        sample.point[1] - (segment.from[1] + dz * clamped),
      )
      if (distance < nearest) {
        nearest = distance
        heightM = heightOn(segment, clamped)
      }
    }
    if (nearest > haloM) continue
    const beforeQ = field.heights[sample.index] ?? 0
    const beforeM = beforeQ * field.step
    let target = beforeM
    if (nearest <= half) target = heightM
    else if (beforeM > heightM + 0.005) target = Math.min(beforeM, heightM + (nearest - half) / run)
    else if (beforeM < heightM - 0.005) target = Math.max(beforeM, heightM - (nearest - half) / run)
    const nextQ = quantize(field, target)
    if (nextQ === beforeQ) continue
    heights[sample.index] = nextQ
    changedSamples++
    const movedM = (nextQ - beforeQ) * field.step
    if (movedM < 0) cutVolumeM3 += -movedM * cellM2
    else fillVolumeM3 += movedM * cellM2
  }

  const steepest = (read: (station: Station) => number) =>
    stations.slice(1).reduce((max, station, i) => {
      const previous = stations[i] as Station
      return Math.max(max, Math.abs(read(station) - read(previous)) / (station.s - previous.s))
    }, 0) * 100
  // The strip's outline: its left side out, its right side back.
  const side = (sign: number) =>
    stations.map((station, i): Vec2 => {
      const a = stations[Math.max(0, i - 1)] as Station
      const b = stations[Math.min(stations.length - 1, i + 1)] as Station
      const length = Math.hypot(b.point[0] - a.point[0], b.point[1] - a.point[1]) || 1
      return [
        round(station.point[0] - (sign * half * (b.point[1] - a.point[1])) / length, 3),
        round(station.point[1] + (sign * half * (b.point[0] - a.point[0])) / length, 3),
      ]
    })
  const corners = new Set(breakpoints(stations).map((station) => station.s))
  line.forEach((point) => {
    const at = stations.find(
      (station) => station.point[0] === point[0] && station.point[1] === point[1],
    )
    if (at) corners.add(at.s)
  })
  const kept = stations
    .map((station, i) => ({ station, i }))
    .filter(({ station }) => corners.has(station.s))
  const left = side(1)
  const right = side(-1)
  // A strip lowered into the ground is a swale: where it leads. Its lowest bottom, and the
  // deepest closed hollow the strip leaves within a metre of it (none where it comes out).
  let drains:
    | { lowestAt: 'start' | 'end' | 'between'; lowestM: number; standingWaterM: number }
    | undefined
  if (offsetM < 0) {
    let lowest = first
    for (const station of stations) if (station.height < lowest.height - 1e-9) lowest = station
    const after: TerrainField = { ...field, heights }
    const reach = half + 1
    const [hollow] = closedHollows((x, z) => heightAt(after, x, z), {
      bounds: {
        minX: bounds.minX - haloM,
        minZ: bounds.minZ - haloM,
        maxX: bounds.maxX + haloM,
        maxZ: bounds.maxZ + haloM,
      },
      within: (x, z) =>
        segments.some((segment) => {
          const dx = segment.to[0] - segment.from[0]
          const dz = segment.to[1] - segment.from[1]
          const t = Math.max(
            0,
            Math.min(
              1,
              ((x - segment.from[0]) * dx + (z - segment.from[1]) * dz) /
                (segment.length * segment.length),
            ),
          )
          return Math.hypot(x - segment.from[0] - dx * t, z - segment.from[1] - dz * t) <= reach
        }),
    })
    drains = {
      lowestAt: lowest.s < 0.26 ? 'start' : lowest.s > lengthM - 0.26 ? 'end' : 'between',
      lowestM: round(lowest.height),
      standingWaterM: round(hollow?.depthM ?? 0),
    }
  }
  return terrainWriteOutcome(site, nodes, field, heights, {
    lengthM: round(lengthM),
    startM: round(first.height),
    endM: round(last.height),
    steepestPercent: round(
      steepest((station) => station.height),
      1,
    ),
    groundSteepestPercent: round(
      steepest((station) => station.ground),
      1,
    ),
    profile: breakpoints(stations).map((station) => ({
      sM: round(station.s),
      heightM: round(station.height),
      groundM: round(station.ground),
    })),
    outline: [
      ...kept.map(({ i }) => left[i] as Vec2),
      ...kept.reverse().map(({ i }) => right[i] as Vec2),
    ],
    cutVolumeM3,
    fillVolumeM3,
    netM3: cutVolumeM3 - fillVolumeM3,
    ...(drains ? { drains } : {}),
    deepestCutM: round(Math.max(0, ...stations.map((station) => station.ground - station.height))),
    highestFillM: round(Math.max(0, ...stations.map((station) => station.height - station.ground))),
    changedSamples,
    sampling: samplingOf(field, 'field_samples_along_line', samples.length),
  })
}

export const STEP = { maxRiser: 0.19, comfort: 0.63, minGoing: 0.25, maxGoing: 0.35 } as const

type DoorSteps = {
  door: DoorNode
  level: LevelNode
  rise: number
  stepCount: number
  runM: number
  sill: number
  /** The foot in the level's frame, the flight's turn, the height of its foot over the level's own ground reference. */
  foot: Vec2
  rotation: number
  footY: number
  footSite: Vec2
  groundAtFootM: number
  doorWidth: number
}

/**
 * The flight an exterior door needs: its top at the sill against the wall, its foot on the ground,
 * the rise and the run solved from the two. Refuses a door that is not exterior; the caller reads
 * `rise` for a door at, under or far over the ground.
 */
function solveDoorSteps(nodes: SceneNodes, doorId: string): DoorSteps {
  const record = nodes as Record<AnyNodeId, AnyNode>
  const door = nodes[doorId]
  if (!door) refuse('node_not_found', `No node ${doorId} in the scene.`)
  if (door.type !== 'door') refuse('not_a_door', `Node ${doorId} is not a door.`)
  const wall = door.parentId ? nodes[door.parentId] : undefined
  const level = wall?.parentId ? nodes[wall.parentId] : undefined
  const building = level?.parentId ? nodes[level.parentId] : undefined
  if (wall?.type !== 'wall' || level?.type !== 'level' || building?.type !== 'building')
    refuse('not_exterior', `Door ${door.id} is not on a wall of a building's level.`)
  if (Math.abs(building.rotation[0]) > 1e-9 || Math.abs(building.rotation[2]) > 1e-9)
    refuse('building_rotation_unsupported', 'The building tips out of the site plane.')
  const { field } = groundOf(nodes)
  const cos = Math.cos(building.rotation[1])
  const sin = Math.sin(building.rotation[1])
  const toSite = ([lx, lz]: Vec2): Vec2 => [
    cos * lx + sin * lz + building.position[0],
    -sin * lx + cos * lz + building.position[2],
  ]
  const ground = (local: Vec2) => {
    const [sx, sz] = toSite(local)
    return field ? heightAt(field, sx, sz) : 0
  }
  const length = getWallCurveLength(wall)
  const { position, height, width: doorWidth } = door as DoorNode
  const curve = getWallCurveFrameAt(wall, position[0] / length)
  const faces = getWallFaceOffsets(wall)
  const floors = floorSlabsOf(record, level)
  const beside = (offset: number): Vec2 => [
    curve.point.x + curve.normal.x * offset,
    curve.point.y + curve.normal.y * offset,
  ]
  const onFloor = ([lx, lz]: Vec2) => floors.some((slab) => onFloorPlate(lx, lz, slab.polygon))
  const a = onFloor(beside(faces.a + 0.15))
  const b = onFloor(beside(faces.b - 0.15))
  if (a === b)
    refuse(
      'not_exterior',
      `Door ${door.id} has a floor on ${a ? 'both sides' : 'neither side'}: steps to the ground climb to a door with a floor on one side only.`,
    )
  // The floor is on the `b` side: out is along the normal, from the `a` face.
  const outward = a ? -1 : 1
  const face = a ? faces.b : faces.a
  const out = (distance: number) => beside(face + outward * distance)
  const plane = levelPlaneWorldY(record, level.id) ?? 0
  const sill = sillOf(
    wall,
    { position, height },
    a ? beside(faces.a + 0.15) : beside(faces.b - 0.15),
    floors,
    plane,
    nodes,
  )
  let rise = sill - ground(out(0.3))
  let stepCount = 1
  let runM = STEP.maxGoing
  for (let i = 0; i < 6; i++) {
    // No riser over 0.19 m: a 0.25 m rise is two steps, not one tall one.
    stepCount = Math.max(1, Math.ceil(rise / STEP.maxRiser - 1e-9))
    const going = Math.min(
      STEP.maxGoing,
      Math.max(STEP.minGoing, STEP.comfort - (2 * rise) / stepCount),
    )
    runM = stepCount * going
    const next = sill - ground(out(runM))
    if (Math.abs(next - rise) < 1e-3) {
      rise = next
      break
    }
    rise = next
  }
  const foot = out(runM)
  const groundAtFootM = ground(foot)
  return {
    door: door as DoorNode,
    level,
    rise,
    stepCount,
    runM,
    sill,
    foot,
    // A flight climbs along +z turned by its rotation: toward the wall is against the outward normal.
    rotation: Math.atan2(-outward * curve.normal.x, -outward * curve.normal.y),
    // A level the ground carries stands its flights on the ground; on any other the foot states
    // the ground's height itself.
    footY: isLevelAtSiteDatum(record, level.id) ? 0 : groundAtFootM - plane,
    footSite: toSite(foot),
    groundAtFootM,
    doorWidth,
  }
}

/**
 * `add_steps_to_ground`: the outside flight an exterior door needs, its top at the sill against
 * the wall, its foot on the ground, the rise and the run solved from the two.
 */
export const addStepsToGround: AgentOperation<z.infer<typeof stepsInput>> = (nodes, raw) => {
  const input = parseInput(stepsInput, raw)
  const solved = solveDoorSteps(nodes, input.doorId)
  const { door, level, rise, stepCount, runM, sill, foot } = solved
  if (rise < -0.02)
    refuse(
      'door_below_ground',
      `The ground outside ${door.id} stands ${(-rise).toFixed(2)} m over its sill: grade the ground down to the door before steps.`,
      { stepM: rise },
    )
  if (rise < 0.05)
    refuse(
      'steps_not_needed',
      `The sill of ${door.id} is ${rise.toFixed(2)} m over the ground outside it; there is no rise to climb.`,
      { stepM: rise },
    )
  const storey = getLevelFloorToFloorHeight(level.id, nodes as never)
  if (rise >= Math.min(storey, 2))
    refuse(
      'steps_too_tall',
      `The sill of ${door.id} is ${rise.toFixed(2)} m over the ground outside it: that is a flight between storeys, not steps to the ground, or ground to raise first.`,
      { rise },
    )
  const width = input.width ?? solved.doorWidth + 0.4
  const segment = createDefaultStairSegment({
    width,
    height: rise,
    length: runM,
    stepCount,
    attachmentSide: 'front',
    fillToFloor: true,
  })
  const stair = StairNode.parse({
    name: `Steps to ${door.name ?? door.id}`,
    parentId: level.id,
    position: [foot[0], round(solved.footY, 4), foot[1]],
    rotation: solved.rotation,
    supportSlabId: GROUND_SUPPORT_ID,
    stairType: 'straight',
    fromLevelId: level.id,
    toLevelId: null,
    totalRise: rise,
    width,
    stepCount,
    railingMode: stepCount > 3 ? 'both' : 'none',
    children: [segment.id],
  })
  return {
    result: {
      stairId: stair.id,
      doorId: door.id,
      stepCount,
      riseM: round(rise, 3),
      runM: round(runM, 3),
      sillM: round(sill, 3),
      foot: [round(solved.footSite[0], 3), round(solved.footSite[1], 3)],
      groundAtFootM: round(solved.groundAtFootM, 3),
    },
    changes: {
      create: [
        { node: stair, parentId: level.id },
        { node: { ...segment, parentId: stair.id }, parentId: stair.id },
      ],
    },
  }
}
