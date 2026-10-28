import { isCaptureSessionOn } from '../events/capture-sessions'
import { nodeRegistry } from '../registry'
import type {
  AnyNode,
  AnyNodeId,
  BuildingNode,
  FoundationNode,
  LevelNode,
  SlabNode,
  WallNode,
} from '../schema'
import { isRailingWall } from '../schema/nodes/railing-wall'
import {
  getLevelElevations,
  levelFloorWorldY,
  levelPlaneWorldY,
  levelPlateUndersideWorldY,
} from '../services/storey'
import { getWallCenterlineSegments } from '../systems/wall/wall-curve'
import { getWallThickness } from '../systems/wall/wall-footprint'
import { getWallBodyCenterOffset } from '../systems/wall/wall-frame'
import { buildingFoundationOf, inches, isBuildingFoundationOn } from './building-foundation'
import {
  type DesignedFoundationReport,
  designedBasement,
  designedFoundation,
  type FoundationOutline,
  type FoundationRimStep,
  foundationOutlines,
  outlineOfPolygon,
} from './designed-foundation'
import { exteriorWallLoops } from './exterior-wall-loops'
import { type FoundationConstructionId, foundationReadingOf } from './foundation-construction'
import type { GradingPad } from './foundation-grading'
import { FOUNDATION_STANDARD } from './foundation-standard'
import { levelGradeStanding } from './grade-standing'
import { groundLevelOf } from './ground-level'
import { containsPoint } from './polygon-boolean'
import { groundHeightAt } from './site-ground-height'
import { levelLocalToWorldXZ } from './terrain-support-query'

type Nodes = Record<AnyNodeId, AnyNode>

/**
 * One run of the foundation under the exterior walls: a prism along `from` to `to` (world plan,
 * already carried past the wall's ends so the corners close), `width` wide, from `bottomY` up to
 * `topY`. A `footing` is the concrete pour under the wall, a `stem` the foundation wall on it,
 * built of `material`: the footing is always concrete, the stem is what the building's
 * foundation construction is (block or cast concrete, by region).
 *
 * A designed foundation (the building's record switched on, `designedFoundation`) adds what a box
 * does not draw: a slab's `turndown` edge, drawn as its `section`; a `grade-beam`; a `pile`, a
 * cylinder `width` across at `from`; the `slab` itself, its plan `outline` from `bottomY` to `topY`.
 */
export type FoundationMember = {
  /** `cripple`: a raised floor's wood cripple wall, from a stepped-down stem's top up to the floor framing. */
  kind: 'footing' | 'stem' | 'cripple' | 'turndown' | 'grade-beam' | 'pile' | 'slab'
  material: 'concrete' | 'cmu' | 'wood'
  levelId: string
  from: [number, number]
  to: [number, number]
  width: number
  bottomY: number
  topY: number
  /**
   * The run's cross-section in place of the `width` box: `[across, y]` points of a closed outline,
   * `across` metres to the left of `from` → `to` (into the building), `y` world.
   */
  section?: Array<[number, number]>
  /** `slab`: the plan outline, world XZ, and the holes in it (where the slab drops under a lower floor). */
  outline?: Array<[number, number]>
  holes?: Array<Array<[number, number]>>
  /** Drawn from the building's foundation record: no plugin takes it over. */
  designed?: true
}

// A stem wall under a raised floor is poured, wherever the house stands: block is for basement
// walls, not the short course a crawl space stands on.
const STEM_MATERIAL: Record<FoundationConstructionId, FoundationMember['material']> = {
  cmu: 'concrete',
  'cast-concrete': 'concrete',
}

/** The lowest grade is sampled at this many points along each wall, the generator's own count. */
const GRADE_SAMPLES = 7
/** A stem shorter than this is the floor sitting on the footing: nothing to draw. */
const MIN_STEM_HEIGHT = 1e-3

type FoundationScene = {
  capturing: boolean
  members: FoundationMember[]
  rimBottoms: Map<string, number>
  rimSteps: Map<string, FoundationRimStep[]>
  sharedStemTops: Map<string, number>
  reports: Map<string, DesignedFoundationReport>
  pads: GradingPad[]
}

// Per scene and per capture session: a plugin's `drawsFoundation` may step aside from a picture
// (the pictures show the finished house), a state no node holds.
const memo = new WeakMap<object, FoundationScene>()

/**
 * The foundation each building stands on. Unless its record is switched off, that is its designed
 * foundation (`designedFoundation`, a slab on grade where there is no record), under its
 * foundation outlines where it has some (`foundation` nodes), else under its exterior walls; over a
 * basement, the basement's walls cut into the ground (`designedBasement`, which stands walls of
 * the basement's own on the generic footing). Switched off, it is the generic one: a continuous
 * footing and a poured foundation wall under the exterior walls of each building's lowest level
 * with a closed outline,
 * derived from those walls, never stored, so nothing in a saved scene changes. The numbers are
 * {@link FOUNDATION_STANDARD}: a 16 × 8 in footing whose bottom sits 12 in under the lowest grade
 * (a generic depth: core has no frost data), and a wall from the footing up to the underside of the
 * lowest floor, as thick as the building's foundation construction says (`foundationReadingOf`).
 *
 * - A level below grade (all of it) has no second wall: its exterior walls are the foundation
 *   walls, so only the footing is drawn, under the underside of its floor.
 * - A wall that stores its own stem (`underpinning`) keeps it; the footing goes under that stem.
 * - A slab that stores a solid foundation skirt (`foundation`) is the foundation under its level:
 *   walls without a stored stem get nothing.
 * - A node that declares `drawsFoundation` on the level (a framing plugin) draws it itself: the
 *   generic one steps aside. The plugin may read `isCaptureSessionOn()` to give it back to a
 *   picture, which shows the finished house.
 */
export function genericFoundation(nodes: Nodes): FoundationMember[] {
  return foundationScene(nodes).members
}

/**
 * Where a wall's finish runs down to over the floor framing, level-local: the stem wall's top under
 * a raised designed foundation, for the exterior walls it carries. `null` where the wall stores
 * its own underpinning, or no designed foundation carries it.
 */
export function foundationRimBottom(nodes: Nodes, wallId: string): number | null {
  return foundationScene(nodes).rimBottoms.get(wallId) ?? null
}

/** Every wall's {@link foundationRimBottom}, by wall id. */
export function foundationRimBottoms(nodes: Nodes): ReadonlyMap<string, number> {
  return foundationScene(nodes).rimBottoms
}

/**
 * Where each wall's finish runs further down than its {@link foundationRimBottom}: over the
 * cripple walls a raised floor stands on down a slope, to the stepped-down stem's top. By wall id.
 */
export function foundationRimSteps(
  nodes: Nodes,
): ReadonlyMap<string, readonly FoundationRimStep[]> {
  return foundationScene(nodes).rimSteps
}

/**
 * Where each wall a slab room (a garage) shares with a raised house stands on the house's stem: the
 * stem's top, the sill line, level-local. The wall's face on the room's side is the stem's bare
 * concrete under it, down to the room's slab. By wall id.
 */
export function foundationSharedStemTops(nodes: Nodes): ReadonlyMap<string, number> {
  return foundationScene(nodes).sharedStemTops
}

/** What the building's designed foundation measured (a basement's, `report.basement`); `null` where its record is off or it has no closed outline. */
export function designedFoundationReport(
  nodes: Nodes,
  buildingId: string,
): DesignedFoundationReport | null {
  return foundationScene(nodes).reports.get(buildingId) ?? null
}

function foundationScene(nodes: Nodes): FoundationScene {
  const capturing = isCaptureSessionOn()
  const hit = memo.get(nodes)
  if (hit && hit.capturing === capturing) return hit
  const scene: FoundationScene = {
    capturing,
    members: [],
    rimBottoms: new Map(),
    rimSteps: new Map(),
    sharedStemTops: new Map(),
    reports: new Map(),
    pads: [],
  }
  for (const node of Object.values(nodes)) {
    if (node.type !== 'building' || node.visible === false) continue
    const designed = designedFoundationOf(nodes, node)
    if (designed) {
      scene.members.push(...designed.members)
      for (const [wallId, bottom] of designed.rimBottoms) {
        const wall = nodes[wallId as AnyNodeId]
        if (wall?.type === 'wall' && !wall.underpinning) scene.rimBottoms.set(wallId, bottom)
      }
      for (const [wallId, steps] of designed.rimSteps) {
        const wall = nodes[wallId as AnyNodeId]
        if (wall?.type === 'wall' && !wall.underpinning) scene.rimSteps.set(wallId, steps)
      }
      for (const [wallId, top] of designed.sharedStemTops) scene.sharedStemTops.set(wallId, top)
      scene.reports.set(node.id, designed.report)
      scene.pads.push(...designed.pads, ...outdoorSlabPads(nodes, node))
      continue
    }
    scene.members.push(...buildingFoundation(nodes, node))
  }
  memo.set(nodes, scene)
  return scene
}

/**
 * How the buildings' designed foundations grade the ground (`designedFoundation`): each slab's
 * pad, filled or cut to round it; the cut round a raised floor's stem wall and its crawl space dug
 * out; a basement's dig, the ground round it left as it lies (`designedBasement`). The site's
 * ground is graded to them (`gradeTerrainField`).
 */
export function foundationGradingPads(nodes: Nodes): readonly GradingPad[] {
  return foundationScene(nodes).pads
}

/** The least a porch or patio slab stands over the ground graded round it. */
const OUTDOOR_SLAB_MIN_EXPOSURE = inches(4)

/**
 * How a porch or patio slab beside the house grades the ground: a plate the structure kernel tags
 * `metadata.floor: 'porch-slab'` (`OutdoorRoomDefaults.floorTag`) on the storey standing on the
 * ground, held as far under its top as the house's pad is under the house's floor (`topAboveGrade`
 * less the slab's drop, 4 in at least). The slab then stands down in the ground the house is graded
 * to, its edge running into it (the slab draws its edge down to that ground), never over it. Beside
 * a raised floor the ground standing over that grade is only cut.
 */
function outdoorSlabPads(nodes: Nodes, building: BuildingNode): GradingPad[] {
  const foundation = buildingFoundationOf(nodes, building.id)
  const ground = groundLevelOf(nodes, building.id)?.level
  if (!foundation || !ground) return []
  const planeY = levelPlaneWorldY(nodes, ground.id) ?? building.position?.[1] ?? 0
  const floorTop = levelFloorWorldY(nodes, ground.id) ?? planeY
  const pads: GradingPad[] = []
  for (const id of ground.children) {
    const plate = nodes[id as AnyNodeId]
    if (plate?.type !== 'slab' || plate.plateRole === 'base' || plate.visible === false) continue
    if ((plate.metadata as Record<string, unknown> | undefined)?.floor !== 'porch-slab') continue
    if (plate.polygon.length < 3) continue
    const top = planeY + plate.elevation
    const exposure = Math.max(
      OUTDOOR_SLAB_MIN_EXPOSURE,
      inches(foundation.topAboveGradeIn) - Math.max(0, floorTop - top),
    )
    pads.push({
      outline: plate.polygon.map(([x, z]) => levelLocalToWorldXZ(building, x, z)),
      y: top - exposure,
      ...(foundation.type === 'raised' ? { kind: 'cut' as const } : {}),
    })
  }
  return pads
}

/**
 * The designed foundation, where the building's record is on. Over a basement it is the
 * basement's (`designedBasementOf`); else a ground floor the ground stands over is still designed,
 * so the record can seat it. It is the building's own: a plugin that draws a level's foundation
 * does not take it over. Its outline is the building's `foundation` nodes where it has some (then
 * it needs no walls), else its exterior walls'; an outline that pours a construction of its own or
 * stands a drop under the floor (a porch slab) is poured apart, and the house's own outlines
 * report.
 */
function designedFoundationOf(nodes: Nodes, building: BuildingNode) {
  if (!isBuildingFoundationOn(building)) return null
  const under = basementUnder(nodes, building)
  if (under) return designedBasementOf(nodes, building, under)
  const enclosed = lowestEnclosedLevel(nodes, building)
  const drawn = drawnOutlinesOf(nodes, building)
  const level = enclosed?.level ?? drawn?.level
  if (!level) return null
  const foundation = buildingFoundationOf(nodes, building.id)
  if (!foundation) return null
  const site = siteOf(nodes, building)
  const gradeAt = (x: number, z: number) => groundHeightAt(site, x, z)
  const walls = enclosed?.walls ?? []
  if (!drawn) return designedFoundation(nodes, building, level, walls, foundation, gradeAt)

  // The house's own outline is the walls' until an outline of the house's replaces it; a porch
  // slab or an outline of another construction pours beside it.
  let main: ReturnType<typeof designedFoundation> = drawn.groups.some(isHouseGroup)
    ? null
    : enclosed
      ? designedFoundation(nodes, building, level, walls, foundation, gradeAt)
      : null
  const members: FoundationMember[] = [...(main?.members ?? [])]
  const pads: GradingPad[] = [...(main?.pads ?? [])]
  let report: DesignedFoundationReport | null = main?.report ?? null
  for (const group of drawn.groups) {
    const own =
      group.construction === 'building' ? foundation : { ...foundation, type: group.construction }
    const designed = designedFoundation(
      nodes,
      building,
      level,
      walls,
      own,
      gradeAt,
      group.outlines,
      {
        drop: group.drop,
        ownTop: !group.covered,
      },
    )
    if (!designed) continue
    members.push(...designed.members)
    pads.push(...designed.pads)
    if (isHouseGroup(group) && !main) main = designed
    report ??= designed.report
  }
  if (!report) return null
  return {
    members,
    pads,
    rimBottoms: main?.rimBottoms ?? new Map<string, number>(),
    rimSteps: main?.rimSteps ?? new Map<string, FoundationRimStep[]>(),
    sharedStemTops: main?.sharedStemTops ?? new Map<string, number>(),
    report: main?.report ?? report,
  }
}

/**
 * The building's basement: its lowest level, where that lies under its ground floor (a lower floor
 * index, as the level panel's "+" under the lowest adds one, walls or none), and the ground floor
 * over it. `null` for a building that stands on its ground floor.
 */
function basementUnder(
  nodes: Nodes,
  building: BuildingNode,
): { basement: LevelNode; ground: LevelNode } | null {
  const ground = groundLevelOf(nodes, building.id)
  if (!ground) return null
  const elevations = getLevelElevations(nodes)
  let lowest: LevelNode | null = null
  for (const node of Object.values(nodes)) {
    if (node.type !== 'level' || elevations.get(node.id)?.buildingId !== building.id) continue
    if (!lowest || node.level < lowest.level) lowest = node
  }
  return lowest && lowest.level < ground.level.level
    ? { basement: lowest, ground: ground.level }
    : null
}

/**
 * A house over a basement, cut into the ground (`designedBasement`): no pad round it, the ground
 * dug out inside the basement walls' outside faces. Walls of the basement's own that close an
 * outline are its foundation walls, on the generic footing (`buildingFoundation`); without them
 * its walls are poured under the house's outline (its drawn one, else the ground floor walls'
 * outside faces). An outline of another construction or a drop under the floor (a porch slab)
 * still pours beside it, the ground under it dug as it digs, never filled or cut round it.
 */
function designedBasementOf(
  nodes: Nodes,
  building: BuildingNode,
  { basement, ground }: { basement: LevelNode; ground: LevelNode },
) {
  const foundation = buildingFoundationOf(nodes, building.id)
  if (!foundation) return null
  const site = siteOf(nodes, building)
  const gradeAt = (x: number, z: number) => groundHeightAt(site, x, z)
  const walls = basement.children.some((id) => isSolidWall(nodes[id]))
    ? exteriorWalls(nodes, basement)
    : []
  const outlines = walls.length > 0 ? foundationOutlines(walls) : []
  if (outlines.length > 0)
    return designedBasement(nodes, building, foundation, gradeAt, outlines, {
      basement,
      ground,
      outlineLevelId: basement.id,
      own: { footings: buildingFoundation(nodes, building) },
    })

  const enclosed = lowestEnclosedLevel(nodes, building)
  const drawn = drawnOutlinesOf(nodes, building)
  const house = drawn?.groups.filter(isHouseGroup).flatMap((group) => group.outlines) ?? []
  const designed = designedBasement(
    nodes,
    building,
    foundation,
    gradeAt,
    house.length > 0 ? house : enclosed ? foundationOutlines(enclosed.walls) : [],
    {
      basement,
      ground,
      outlineLevelId: (house.length > 0 ? drawn?.level.id : enclosed?.level.id) ?? ground.id,
    },
  )
  if (!designed) return null
  for (const group of drawn?.groups ?? []) {
    if (!drawn || isHouseGroup(group)) continue
    const porch = designedFoundation(
      nodes,
      building,
      drawn.level,
      enclosed?.walls ?? [],
      group.construction === 'building' ? foundation : { ...foundation, type: group.construction },
      gradeAt,
      group.outlines,
      { drop: group.drop, ownTop: !group.covered },
    )
    if (!porch) continue
    designed.members.push(...porch.members)
    designed.pads.push(...porch.pads.filter((pad) => pad.kind === 'pit'))
  }
  return designed
}

type OutlineGroup = {
  construction: FoundationNode['construction']
  drop: number
  /** A floor plate of the house lies over it: the plate is its walking surface. */
  covered: boolean
  outlines: FoundationOutline[]
}

/** Outlines of the house's own foundation (as its record, at its floor), which replace the walls'. */
function isHouseGroup(group: Pick<OutlineGroup, 'construction' | 'drop'>): boolean {
  return group.construction === 'building' && group.drop === 0
}

/** A drawn outline of the house's own foundation: it replaces the outline traced from the walls. */
export function isHouseOutline(node: Pick<FoundationNode, 'construction' | 'drop'>): boolean {
  return isHouseGroup({ construction: node.construction ?? 'building', drop: node.drop ?? 0 })
}

/**
 * The building's drawn foundation outlines (`foundation` nodes), with the level the lowest stands
 * on, grouped by what they pour: their construction, their drop, and whether a floor plate of the
 * house covers them.
 */
function drawnOutlinesOf(
  nodes: Nodes,
  building: BuildingNode,
): { level: LevelNode; groups: OutlineGroup[] } | null {
  const elevations = getLevelElevations(nodes)
  let level: LevelNode | null = null
  const groups: OutlineGroup[] = []
  const plates = Object.values(nodes).filter(
    (node): node is SlabNode =>
      node.type === 'slab' &&
      node.plateRole === 'base' &&
      !!node.parentId &&
      elevations.get(node.parentId)?.buildingId === building.id,
  )
  for (const node of Object.values(nodes)) {
    if (node.type !== 'foundation' || node.visible === false || !node.parentId) continue
    const host = nodes[node.parentId as AnyNodeId]
    if (host?.type !== 'level' || elevations.get(host.id)?.buildingId !== building.id) continue
    const outline = outlineOfPolygon(node.polygon)
    if (!outline) continue
    const centre = outlineCentre(outline)
    const covered = plates.some((plate) =>
      containsPoint([{ outer: plate.polygon, holes: plate.holes ?? [] }], centre),
    )
    const construction = node.construction ?? 'building'
    const drop = node.drop ?? 0
    const group = groups.find(
      (candidate) =>
        candidate.construction === construction &&
        candidate.drop === drop &&
        candidate.covered === covered,
    )
    if (group) group.outlines.push(outline)
    else groups.push({ construction, drop, covered, outlines: [outline] })
    if (!level || host.level < level.level) level = host
  }
  return level ? { level, groups } : null
}

/** A point well inside an outline: its corners' mean (an outline is a footprint, rarely hollow). */
function outlineCentre(outline: FoundationOutline): [number, number] {
  let x = 0
  let z = 0
  for (const edge of outline.edges) {
    x += edge.a[0]
    z += edge.a[1]
  }
  return [x / outline.edges.length, z / outline.edges.length]
}

function buildingFoundation(nodes: Nodes, building: BuildingNode): FoundationMember[] {
  const enclosed = lowestEnclosedLevel(nodes, building)
  if (!enclosed || levelDrawsFoundation(nodes, enclosed.level)) return []
  const { level, walls } = enclosed

  const site = siteOf(nodes, building)
  const gradeAt = (x: number, z: number) => groundHeightAt(site, x, z)
  const lowestGrade = Math.min(...walls.map((wall) => lowestGradeAlong(building, wall, gradeAt)))
  const floors = floorsOf(nodes, level)
  const wallBaseY =
    (building.position?.[1] ?? 0) + (getLevelElevations(nodes).get(level.id)?.baseY ?? 0)
  // The footing never pokes above the wall's base into the room, nor above the floor's underside.
  const floorUnderside = levelPlateUndersideWorldY(nodes, level.id) ?? wallBaseY
  const { construction } = foundationReadingOf(nodes, building.id)
  const stemMaterial = STEM_MATERIAL[construction.id]
  const stemThickness = construction.stemThickness
  const buried = levelGradeStanding(nodes, level.id) === 'below-grade'
  const solidSkirt = floors.some((floor) => floor.foundation?.type === 'solid')

  const members: FoundationMember[] = []
  for (const wall of walls) {
    const stored = wall.underpinning
    if (!stored && solidSkirt) continue
    const run = runOf(building, wall, stemThickness)
    const wallWidth = Math.max(stemThickness, getWallThickness(wall))
    const footingWidth =
      wallWidth + FOUNDATION_STANDARD.footingWidth - FOUNDATION_STANDARD.stemThickness
    const footingTop = stored
      ? Math.min(wallBaseY - stored.rim - stored.stem, lowestGradeAlong(building, wall, gradeAt))
      : footingTopUnder(floorUnderside, lowestGrade)
    const footingBottom = footingTop - FOUNDATION_STANDARD.footingThickness
    for (const segment of run) {
      members.push({
        kind: 'footing',
        material: 'concrete',
        levelId: level.id,
        ...segment,
        width: footingWidth,
        bottomY: footingBottom,
        topY: footingTop,
      })
      if (stored || buried || floorUnderside - footingTop < MIN_STEM_HEIGHT) continue
      members.push({
        kind: 'stem',
        material: stemMaterial,
        levelId: level.id,
        ...segment,
        width: wallWidth,
        bottomY: footingTop,
        topY: floorUnderside,
      })
    }
  }
  return members
}

/**
 * The footing's top: the generic depth under the lowest grade, or the floor's underside where that
 * is deeper (a level below grade sits its footing right under its floor).
 */
function footingTopUnder(floorUnderside: number, lowestGrade: number): number {
  const { footingBelowGrade, footingThickness } = FOUNDATION_STANDARD
  return Math.min(lowestGrade - footingBelowGrade + footingThickness, floorUnderside)
}

/**
 * The building's lowest level whose walls close an outline, with those exterior walls. A level
 * under the ground still being drawn (a basement's first wall, an open run) carries no foundation
 * yet, and the one over it does; a level at grade whose walls close nothing stands on nothing
 * drawn, whatever is over it.
 */
function lowestEnclosedLevel(
  nodes: Nodes,
  building: BuildingNode,
): { level: LevelNode; walls: WallNode[] } | null {
  const elevations = getLevelElevations(nodes)
  const levels = Object.values(nodes)
    .filter(
      (node): node is LevelNode =>
        node.type === 'level' && elevations.get(node.id)?.buildingId === building.id,
    )
    .sort((a, b) => a.level - b.level)
  for (const level of levels) {
    if (!level.children.some((id) => isSolidWall(nodes[id]))) continue
    const walls = exteriorWalls(nodes, level)
    if (walls.length > 0) return { level, walls }
    if (levelGradeStanding(nodes, level.id) === 'at-grade') return null
  }
  return null
}

/** The building's lowest level whose exterior walls close an outline, with those walls (`lowestEnclosedLevel`). */
export function enclosedFoundationWalls(
  nodes: Nodes,
  buildingId: string,
): { level: LevelNode; walls: WallNode[] } | null {
  const building = nodes[buildingId as AnyNodeId]
  return building?.type === 'building' ? lowestEnclosedLevel(nodes, building) : null
}

function levelDrawsFoundation(nodes: Nodes, level: LevelNode): boolean {
  return level.children.some((id) => {
    const child = nodes[id]
    return child
      ? nodeRegistry.get(child.type)?.capabilities?.drawsFoundation?.(child) === true
      : false
  })
}

/** A wall a foundation goes under: a railing stands on its floor as a guard, on no footing. */
function isSolidWall(node: AnyNode | undefined): boolean {
  return node?.type === 'wall' && !isRailingWall(node)
}

/** A level's walls on its outline (`exteriorWallLoops`, which a railing never closes). */
function exteriorWalls(nodes: Nodes, level: LevelNode): WallNode[] {
  const walls = level.children
    .map((id) => nodes[id])
    .filter((node): node is WallNode => node?.type === 'wall' && node.visible !== false)
  const outside = new Set<string>()
  for (const loop of exteriorWallLoops(walls)) for (const face of loop) outside.add(face.wallId)
  return walls.filter((wall) => outside.has(wall.id))
}

function floorsOf(nodes: Nodes, level: LevelNode): SlabNode[] {
  return level.children
    .map((id) => nodes[id])
    .filter((node): node is SlabNode => node?.type === 'slab' && node.recessed !== true)
}

export function siteOf(nodes: Nodes, building: BuildingNode): AnyNode | null {
  const parent = building.parentId ? nodes[building.parentId as AnyNodeId] : undefined
  return parent?.type === 'site'
    ? parent
    : (Object.values(nodes).find((node) => node.type === 'site') ?? null)
}

function lowestGradeAlong(
  building: BuildingNode,
  wall: WallNode,
  gradeAt: (x: number, z: number) => number,
): number {
  let lowest = Number.POSITIVE_INFINITY
  for (let k = 0; k < GRADE_SAMPLES; k++) {
    const t = k / (GRADE_SAMPLES - 1)
    const [x, z] = levelLocalToWorldXZ(
      building,
      wall.start[0] + (wall.end[0] - wall.start[0]) * t,
      wall.start[1] + (wall.end[1] - wall.start[1]) * t,
    )
    lowest = Math.min(lowest, gradeAt(x, z))
  }
  return lowest
}

/**
 * A wall's body centreline in the world as consecutive runs, each carried half its width past both
 * ends so the runs of a corner (or a curve's pieces) overlap and close it.
 */
function runOf(
  building: BuildingNode,
  wall: WallNode,
  stemThickness: number,
): Array<Pick<FoundationMember, 'from' | 'to'>> {
  const offset = getWallBodyCenterOffset(wall)
  const reach = Math.max(stemThickness, getWallThickness(wall)) / 2
  return getWallCenterlineSegments(wall).flatMap(([a, b]) => {
    const dx = b.x - a.x
    const dz = b.y - a.y
    const length = Math.hypot(dx, dz)
    if (length < 1e-9) return []
    const [ux, uz] = [dx / length, dz / length]
    // The wall's normal as the plan footprint takes it, so a justified wall sits where it is drawn.
    const [nx, nz] = [-uz * offset, ux * offset]
    return [
      {
        from: levelLocalToWorldXZ(building, a.x + nx - ux * reach, a.y + nz - uz * reach),
        to: levelLocalToWorldXZ(building, b.x + nx + ux * reach, b.y + nz + uz * reach),
      },
    ]
  })
}
