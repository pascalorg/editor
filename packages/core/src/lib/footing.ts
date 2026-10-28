import type { AnyNode, AnyNodeId, BuildingNode, FootingNode, LevelNode, SlabNode } from '../schema'
import { getLevelElevations, levelFloorWorldY, levelPlaneWorldY } from '../services/storey'
import {
  type BuildingFoundation,
  buildingFoundationOf,
  buildingFoundationRecordOf,
  FOUNDATION_SILL_IN,
  inches,
} from './building-foundation'
import { groundFloorConstruction } from './floor-foundation-datum'
import { type FoundationMember, siteOf } from './generic-foundation'
import { containsPoint } from './polygon-boolean'
import { groundHeightAt } from './site-ground-height'
import { levelLocalToWorldXZ } from './terrain-support-query'

type Nodes = Record<AnyNodeId, AnyNode>
type P = [number, number]

/** Grade is read along a strip this often, metres. */
const GRADE_STEP = 0.15
/** A stem or pier shorter than this is the floor framing sitting on the footing: nothing to draw. */
const MIN_STEM_HEIGHT = 1e-3

/** A footing's plan, level-local: a strip's centreline, or a pad's centre, sides and turn. */
export type FootingPlan =
  | { shape: 'strip'; start: P; end: P; width: number }
  | { shape: 'pad'; center: P; width: number; length: number; rotation: number }

export function footingPlan(footing: FootingNode): FootingPlan | null {
  if (footing.shape === 'pad') {
    if (!footing.center) return null
    return {
      shape: 'pad',
      center: footing.center,
      width: footing.width,
      length: footing.length ?? footing.width,
      rotation: footing.rotation ?? 0,
    }
  }
  if (!(footing.start && footing.end)) return null
  return { shape: 'strip', start: footing.start, end: footing.end, width: footing.width }
}

/** A pad's local x and z directions in the plan, turned by `rotation` about Y as three.js turns them. */
function padAxes(rotation: number): { x: P; z: P } {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return { x: [cos, -sin], z: [sin, cos] }
}

/** The footing's outline, level-local, four corners. */
export function footingOutline(plan: FootingPlan): P[] {
  if (plan.shape === 'pad') {
    const { x, z } = padAxes(plan.rotation)
    const [hx, hz] = [plan.width / 2, plan.length / 2]
    return [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([sx, sz]) => [
      plan.center[0] + x[0] * hx * sx! + z[0] * hz * sz!,
      plan.center[1] + x[1] * hx * sx! + z[1] * hz * sz!,
    ])
  }
  const dx = plan.end[0] - plan.start[0]
  const dz = plan.end[1] - plan.start[1]
  const length = Math.hypot(dx, dz) || 1
  const [nx, nz] = [(-dz / length) * (plan.width / 2), (dx / length) * (plan.width / 2)]
  return [
    [plan.start[0] + nx, plan.start[1] + nz],
    [plan.end[0] + nx, plan.end[1] + nz],
    [plan.end[0] - nx, plan.end[1] - nz],
    [plan.start[0] - nx, plan.start[1] - nz],
  ]
}

/** How a footing stands, derived from the building's foundation record and the ground under it. */
export type FootingDesign = {
  levelId: string
  /** The level's frame in the world: `world = origin + Ry(yaw) · level-local`. */
  levelFrame: { origin: [number, number, number]; yaw: number }
  foundation: BuildingFoundation
  /** The concrete it pours, world (the {@link FoundationMember} frame). */
  members: FoundationMember[]
  /**
   * The ground its depth is measured from, world Y: the lowest grade under it, or under the
   * designed raised floor the crawl space's dug-out dirt where that is lower.
   */
  gradeY: number
  floorTopY: number
  /**
   * The footing's own body (the thickened slab, the footing, a strip's grade beam or a pad's pile
   * cap): its top and bottom, world Y. A stem, pier or pile is in `members`, not here.
   */
  topY: number
  bottomY: number
  /** The body's width across: the node's, or the record's grade beam for a strip on piles. */
  width: number
  /** Its bottom under the grade: the node's, else the building's footing depth (under a slab, none: down to the grade). */
  depth: number
}

const memo = new WeakMap<object, Map<string, FootingDesign | null>>()

/**
 * A footing as the building's foundation pours it: as the record says (the default slab where there
 * is none), else, where the record is switched off, as the floor over it is built (a floor plate
 * raised on its own foundation is a raised floor, its stem top the plate's underside; any other a
 * slab, its underside the plate's), the record's defaults for the rest:
 *
 * - Slab on grade: a thickened slab, its top at the slab body's underside, `thickness` under it and
 *   down at least to the lowest grade beneath it (the node's own depth under it, where it stores
 *   one), so on a slope it bears on the ground, not on the fill under the slab.
 * - Raised floor on footings: the bottom `depth` under the lowest grade beneath it, the top
 *   `thickness` over that; a strip carries a concrete stem (the record's stem thickness) up to the
 *   stem top under the floor framing, a pad a square pier of that side.
 * - Piles: a strip is a grade beam of the record's sizes on piles no further apart than the
 *   record's spacing, one at each end; a pad is a pile cap on one pile.
 *
 * `null` for a footing on no level of a building, or with no plan.
 */
export function footingDesign(nodes: Nodes, footing: FootingNode): FootingDesign | null {
  // A footing the scene does not hold as passed (a draft, a live drag) is designed afresh.
  const stored = nodes[footing.id] === footing
  let byId = memo.get(nodes)
  if (stored && byId?.has(footing.id)) return byId.get(footing.id) ?? null
  const design = designFooting(nodes, footing)
  if (stored) {
    if (!byId) {
      byId = new Map()
      memo.set(nodes, byId)
    }
    byId.set(footing.id, design)
  }
  return design
}

/** The concrete a footing pours, world; empty where it stands on no building. */
export function footingMembers(nodes: Nodes, footing: FootingNode): FoundationMember[] {
  return footingDesign(nodes, footing)?.members ?? []
}

function designFooting(nodes: Nodes, footing: FootingNode): FootingDesign | null {
  const plan = footingPlan(footing)
  const levelId = footing.parentId
  if (!(plan && levelId)) return null
  const buildingId = getLevelElevations(nodes).get(levelId)?.buildingId
  const building = buildingId ? nodes[buildingId as AnyNodeId] : undefined
  if (building?.type !== 'building') return null
  const resolved = buildingFoundationOf(nodes, building.id)
  const planeY = levelPlaneWorldY(nodes, levelId)
  if (!resolved || planeY === null) return null
  // The designed foundation decides it (the default slab where there is no record, a generator's
  // type, the panel's). One the panel switched off keeps its type but follows the floor again.
  const decides = buildingFoundationRecordOf(building)?.enabled !== false
  const floor = decides ? null : plateOver(nodes, levelId, plan)
  const builtRaised = !!floor && groundFloorConstruction(nodes, floor).foundationHeight > 1e-3
  const foundation: BuildingFoundation = floor
    ? { ...resolved, type: builtRaised ? 'raised' : 'slab', support: 'footing' }
    : resolved
  const floorUnderside = floor ? planeY + floor.elevation - floor.thickness : null
  const floorTopY = levelFloorWorldY(nodes, levelId) ?? planeY
  const site = siteOf(nodes, building)
  const world = (p: P): P => levelLocalToWorldXZ(building as BuildingNode, p[0], p[1])
  const gradeOf = (p: P) => {
    const [x, z] = world(p)
    return groundHeightAt(site, x, z)
  }
  const samples: P[] = plan.shape === 'pad' ? [plan.center, ...footingOutline(plan)] : []
  if (plan.shape === 'strip') {
    const count =
      Math.max(
        2,
        Math.ceil(
          Math.hypot(plan.end[0] - plan.start[0], plan.end[1] - plan.start[1]) / GRADE_STEP,
        ),
      ) + 1
    for (let k = 0; k < count; k++) {
      const t = k / (count - 1)
      samples.push([
        plan.start[0] + (plan.end[0] - plan.start[0]) * t,
        plan.start[1] + (plan.end[1] - plan.start[1]) * t,
      ])
    }
  }
  const gradeY = Math.min(...samples.map(gradeOf))

  const raised = foundation.type === 'raised'
  const piles = foundation.support === 'piles'
  const thickness = footing.thickness
  const depth = footing.depth ?? (raised || piles ? inches(foundation.footingDepthIn) : 0)
  const stemTopY = floorUnderside ?? floorTopY - inches(foundation.floorFramingDepthIn)
  const slabUnderside = floorUnderside ?? floorTopY - inches(foundation.slabThicknessIn)
  // Under the designed raised floor the ground is the crawl space's dug-out dirt where that is the
  // lower: a footing goes its depth under that, as the perimeter's does.
  const groundY =
    decides && raised
      ? Math.min(
          gradeY,
          stemTopY + inches(FOUNDATION_SILL_IN) - inches(foundation.crawlClearanceIn),
        )
      : gradeY
  const base = { levelId, material: 'concrete' as const }

  // The body as a run in the world plan: a strip end to end, a pad along its local z.
  const bodyRun = (along = plan.shape === 'pad' ? plan.length : 0) => {
    if (plan.shape === 'strip') return { from: world(plan.start), to: world(plan.end) }
    const { z } = padAxes(plan.rotation)
    const half = along / 2
    return {
      from: world([plan.center[0] - z[0] * half, plan.center[1] - z[1] * half]),
      to: world([plan.center[0] + z[0] * half, plan.center[1] + z[1] * half]),
    }
  }
  const pile = (at: P, topY: number): FoundationMember => {
    const [x, z] = world(at)
    return {
      ...base,
      kind: 'pile',
      from: [x, z],
      to: [x, z],
      width: inches(foundation.pileDiameterIn),
      bottomY: topY - inches(foundation.pileLengthIn),
      topY,
    }
  }

  const members: FoundationMember[] = []
  let width = plan.width
  let topY: number
  let bottomY: number
  if (piles) {
    topY = raised ? stemTopY : slabUnderside
    if (plan.shape === 'strip') {
      width = inches(foundation.gradeBeamWidthIn)
      bottomY = Math.min(topY - inches(foundation.gradeBeamDepthIn), groundY - depth)
      members.push({ ...base, kind: 'grade-beam', ...bodyRun(), width, bottomY, topY })
      const span: P = [plan.end[0] - plan.start[0], plan.end[1] - plan.start[1]]
      const bays = Math.max(
        1,
        Math.ceil(Math.hypot(span[0], span[1]) / inches(foundation.pileSpacingIn) - 1e-9),
      )
      for (let k = 0; k <= bays; k++)
        members.push(
          pile(
            [plan.start[0] + (span[0] * k) / bays, plan.start[1] + (span[1] * k) / bays],
            bottomY,
          ),
        )
    } else {
      bottomY = Math.min(topY - thickness, groundY - depth)
      members.push({ ...base, kind: 'footing', ...bodyRun(), width, bottomY, topY })
      members.push(pile(plan.center, bottomY))
    }
  } else if (raised) {
    topY = Math.min(groundY - depth + thickness, stemTopY - 0.01)
    bottomY = Math.min(groundY - depth, topY - thickness)
    members.push({ ...base, kind: 'footing', ...bodyRun(), width, bottomY, topY })
    if (stemTopY - topY > MIN_STEM_HEIGHT) {
      const stem = inches(foundation.stemThicknessIn)
      members.push({
        ...base,
        kind: 'stem',
        ...bodyRun(stem),
        width: stem,
        bottomY: topY,
        topY: stemTopY,
      })
    }
  } else {
    topY = slabUnderside
    bottomY = Math.min(topY - thickness, gradeY - depth)
    members.push({ ...base, kind: 'footing', ...bodyRun(), width, bottomY, topY })
  }

  const levelFrame = {
    origin: [building.position[0], planeY, building.position[2]] as [number, number, number],
    yaw: building.rotation?.[1] ?? 0,
  }
  return {
    levelId,
    levelFrame,
    foundation,
    members,
    gradeY: groundY,
    floorTopY,
    topY,
    bottomY,
    width,
    depth,
  }
}

/** The level's floor plate over a footing's centre (a strip's middle). */
function plateOver(nodes: Nodes, levelId: string, plan: FootingPlan): SlabNode | null {
  const at: P =
    plan.shape === 'pad'
      ? plan.center
      : [(plan.start[0] + plan.end[0]) / 2, (plan.start[1] + plan.end[1]) / 2]
  const level = nodes[levelId as AnyNodeId]
  if (level?.type !== 'level') return null
  for (const id of level.children) {
    const plate = nodes[id as AnyNodeId]
    if (
      plate?.type === 'slab' &&
      plate.plateRole === 'base' &&
      containsPoint([{ outer: plate.polygon, holes: plate.holes ?? [] }], at)
    )
      return plate
  }
  return null
}

/** IRC R403.1: a footing at least 12 in wide and 6 in thick. */
export const FOOTING_MINIMUM = { width: inches(12), thickness: inches(6) }

/** The level footings drawn from `levelId` go on: its building's lowest level. */
export function footingLevelOf(nodes: Nodes, levelId: string): LevelNode | null {
  const elevations = getLevelElevations(nodes)
  const buildingId = elevations.get(levelId)?.buildingId
  if (!buildingId) return null
  let lowest: LevelNode | null = null
  for (const node of Object.values(nodes)) {
    if (node.type !== 'level' || elevations.get(node.id)?.buildingId !== buildingId) continue
    if (!lowest || node.level < lowest.level) lowest = node
  }
  return lowest
}
