import { nodeRegistry } from '../registry'
import type { AnyNode, AnyNodeId, BuildingNode, LevelNode, SlabNode, WallNode } from '../schema'
import { getLevelElevations } from '../services/storey'
import { getWallCenterlineSegments } from '../systems/wall/wall-curve'
import { getWallThickness } from '../systems/wall/wall-footprint'
import { getWallBodyCenterOffset } from '../systems/wall/wall-frame'
import { exteriorWallLoops } from './exterior-wall-loops'
import { FOUNDATION_STANDARD } from './foundation-standard'
import { levelGradeStanding } from './grade-standing'
import { groundHeightAt } from './site-ground-height'
import { levelLocalToWorldXZ } from './terrain-support-query'

type Nodes = Record<AnyNodeId, AnyNode>

/**
 * One run of the foundation under the exterior walls: a prism along `from` to `to` (world plan,
 * already carried past the wall's ends so the corners close), `width` wide, from `bottomY` up to
 * `topY`. A `footing` is the concrete pour under the wall, a `stem` the foundation wall on it.
 */
export type FoundationMember = {
  kind: 'footing' | 'stem'
  levelId: string
  from: [number, number]
  to: [number, number]
  width: number
  bottomY: number
  topY: number
}

/** The lowest grade is sampled at this many points along each wall, the generator's own count. */
const GRADE_SAMPLES = 7
/** A stem shorter than this is the floor sitting on the footing: nothing to draw. */
const MIN_STEM_HEIGHT = 1e-3

const memo = new WeakMap<object, FoundationMember[]>()

/**
 * The foundation a building stands on where the scene stores none: a continuous footing and a
 * foundation wall under the exterior walls of each building's lowest level, derived from those
 * walls, never stored, so nothing in a saved scene changes. The numbers are
 * {@link FOUNDATION_STANDARD}: a 16 × 8 in footing whose bottom sits 12 in under the lowest grade
 * (a generic depth: core has no frost data), and an 8 in wall from the footing up to the underside
 * of the lowest floor.
 *
 * - A level below grade (all of it) has no second wall: its exterior walls are the foundation
 *   walls, so only the footing is drawn, under the underside of its floor.
 * - A wall that stores its own stem (`underpinning`) keeps it; the footing goes under that stem.
 * - A slab that stores a solid foundation skirt (`foundation`) is the foundation under its level:
 *   walls without a stored stem get nothing.
 * - A node that declares `drawsFoundation` on the level (a framing plugin) draws it itself: the
 *   generic one steps aside.
 */
export function genericFoundation(nodes: Nodes): FoundationMember[] {
  const hit = memo.get(nodes)
  if (hit) return hit
  const members: FoundationMember[] = []
  for (const node of Object.values(nodes)) {
    if (node.type === 'building') members.push(...buildingFoundation(nodes, node))
  }
  memo.set(nodes, members)
  return members
}

function buildingFoundation(nodes: Nodes, building: BuildingNode): FoundationMember[] {
  const level = lowestWalledLevel(nodes, building)
  if (!level || levelDrawsFoundation(nodes, level)) return []
  const walls = exteriorWalls(nodes, level)
  if (walls.length === 0) return []

  const site = siteOf(nodes, building)
  const gradeAt = (x: number, z: number) => groundHeightAt(site, nodes, x, z)
  const lowestGrade = Math.min(...walls.map((wall) => lowestGradeAlong(building, wall, gradeAt)))
  const floors = floorsOf(nodes, level)
  const wallBaseY = building.position[1] + (getLevelElevations(nodes).get(level.id)?.baseY ?? 0)
  // The footing never pokes above the wall's base into the room, nor above the floor's underside.
  const floorUnderside = Math.min(
    wallBaseY,
    ...floors.map((floor) => wallBaseY + floor.elevation - floor.thickness),
  )
  const buried = levelGradeStanding(nodes, level.id) === 'below-grade'
  const solidSkirt = floors.some((floor) => floor.foundation?.type === 'solid')

  const members: FoundationMember[] = []
  for (const wall of walls) {
    const stored = wall.underpinning
    if (!stored && solidSkirt) continue
    const run = runOf(building, wall)
    const wallWidth = Math.max(FOUNDATION_STANDARD.stemThickness, getWallThickness(wall))
    const footingWidth =
      wallWidth + FOUNDATION_STANDARD.footingWidth - FOUNDATION_STANDARD.stemThickness
    const footingTop = stored
      ? Math.min(wallBaseY - stored.rim - stored.stem, lowestGradeAlong(building, wall, gradeAt))
      : footingTopUnder(floorUnderside, lowestGrade)
    const footingBottom = footingTop - FOUNDATION_STANDARD.footingThickness
    for (const segment of run) {
      members.push({
        kind: 'footing',
        levelId: level.id,
        ...segment,
        width: footingWidth,
        bottomY: footingBottom,
        topY: footingTop,
      })
      if (stored || buried || floorUnderside - footingTop < MIN_STEM_HEIGHT) continue
      members.push({
        kind: 'stem',
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

function lowestWalledLevel(nodes: Nodes, building: BuildingNode): LevelNode | null {
  const elevations = getLevelElevations(nodes)
  const levels = Object.values(nodes)
    .filter(
      (node): node is LevelNode =>
        node.type === 'level' && elevations.get(node.id)?.buildingId === building.id,
    )
    .sort((a, b) => a.level - b.level)
  return levels.find((level) => level.children.some((id) => nodes[id]?.type === 'wall')) ?? null
}

function levelDrawsFoundation(nodes: Nodes, level: LevelNode): boolean {
  return level.children.some((id) => {
    const child = nodes[id]
    return child
      ? nodeRegistry.get(child.type)?.capabilities?.drawsFoundation?.(child) === true
      : false
  })
}

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

function siteOf(nodes: Nodes, building: BuildingNode): AnyNode | null {
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
): Array<Pick<FoundationMember, 'from' | 'to'>> {
  const offset = getWallBodyCenterOffset(wall)
  const reach = Math.max(FOUNDATION_STANDARD.stemThickness, getWallThickness(wall)) / 2
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
