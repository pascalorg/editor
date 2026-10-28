import { nodeRegistry } from '../registry'
import type { AnyNode, AnyNodeId, BuildingNode, FoundationNode } from '../schema'
import { getLevelElevations } from '../services/storey'
import { buildingFoundationOf, isBuildingFoundationOn } from './building-foundation'
import { foundationOutlines } from './designed-foundation'
import { footingLevelOf } from './footing'
import {
  designedFoundationReport,
  enclosedFoundationWalls,
  type FoundationMember,
  genericFoundation,
} from './generic-foundation'
import { type Ring, union } from './polygon-boolean'

type Nodes = Record<AnyNodeId, AnyNode>
type P = [number, number]

/** What the level list's Foundation row says the building stands on. */
export type FoundationBadge = 'Slab' | 'Raised' | 'Piles' | 'Basement' | 'Off'

/**
 * The building's foundation as the editor's foundation view shows it: a view of the record and of
 * what the engine draws, never a stored level.
 */
export type FoundationView = {
  /**
   * The level the view selects: the one footings are drawn on (the building's lowest level), so
   * the plan draws them and the Footing tool draws there without changing level.
   */
  levelId: string | null
  /** The level whose walls the foundation runs under: the plan ghosts them over it. */
  wallLevelId: string | null
  badge: FoundationBadge
}

/**
 * Slab, Raised or Piles while the building's designed foundation is on (a building with no record
 * stands on the default slab), Basement while it stands on one; Off where its record is switched
 * off (the generic footing the engine derives from the walls is no foundation anyone chose).
 */
export function foundationBadge(nodes: Nodes, buildingId: string): FoundationBadge {
  const building = nodes[buildingId as AnyNodeId]
  if (building?.type !== 'building' || !isBuildingFoundationOn(building)) return 'Off'
  const foundation = buildingFoundationOf(nodes, buildingId)
  if (!foundation) return 'Off'
  if (designedFoundationReport(nodes, buildingId)?.basement) return 'Basement'
  if (foundation.support === 'piles') return 'Piles'
  return foundation.type === 'raised' ? 'Raised' : 'Slab'
}

/** The concrete the engine draws under the building (`genericFoundation`): designed, or generic. */
export function buildingFoundationMembers(nodes: Nodes, buildingId: string): FoundationMember[] {
  const elevations = getLevelElevations(nodes)
  return genericFoundation(nodes).filter(
    (member) => elevations.get(member.levelId)?.buildingId === buildingId,
  )
}

export function foundationViewOf(nodes: Nodes, buildingId: string): FoundationView {
  const building = nodes[buildingId as AnyNodeId]
  const badge = foundationBadge(nodes, buildingId)
  if (building?.type !== 'building') return { levelId: null, wallLevelId: null, badge }
  const report = designedFoundationReport(nodes, buildingId)
  const wallLevelId =
    report?.basement?.outlineLevelId ??
    report?.levelId ??
    buildingFoundationMembers(nodes, buildingId)[0]?.levelId ??
    null
  const anyLevel =
    wallLevelId ?? building.children.find((id) => nodes[id as AnyNodeId]?.type === 'level') ?? null
  const levelId = anyLevel ? (footingLevelOf(nodes, anyLevel)?.id ?? anyLevel) : null
  return { levelId, wallLevelId: wallLevelId ?? levelId, badge }
}

/** The building's drawn foundation outlines (`foundation` nodes on its levels). */
export function buildingFoundationNodes(nodes: Nodes, buildingId: string): FoundationNode[] {
  const elevations = getLevelElevations(nodes)
  return Object.values(nodes).filter(
    (node): node is FoundationNode =>
      node.type === 'foundation' &&
      !!node.parentId &&
      elevations.get(node.parentId)?.buildingId === buildingId,
  )
}

/**
 * The outlines a foundation traced from the building's walls has: the outside faces of each closed
 * loop of exterior walls on its lowest enclosed level, level-local, counter-clockwise. Empty where
 * the walls close no loop.
 */
export function traceFoundationOutlines(nodes: Nodes, buildingId: string): P[][] {
  const enclosed = enclosedFoundationWalls(nodes, buildingId)
  if (!enclosed) return []
  return foundationOutlines(enclosed.walls).map((outline) =>
    outline.edges.map((edge) => [edge.a[0], edge.a[1]] as P),
  )
}

const hiddenMemo = new WeakMap<object, Map<string, readonly string[]>>()

/**
 * What the foundation view hides of the building in 3D: everything on its levels (walls, floors,
 * roofs, ceilings, stairs, rooms, furniture, a plugin's nodes) but the footings, the drawn
 * foundation outlines, and a node that draws its level's foundation itself (a framing plugin's),
 * with what is under it. The levels stay: their groups carry the footings.
 */
export function foundationViewHiddenIds(nodes: Nodes, buildingId: string): readonly string[] {
  let byBuilding = hiddenMemo.get(nodes)
  const hit = byBuilding?.get(buildingId)
  if (hit) return hit
  const building = nodes[buildingId as AnyNodeId]
  const out: string[] = []
  if (building?.type === 'building') {
    const stack: string[] = []
    for (const id of building.children) {
      const level = nodes[id as AnyNodeId]
      if (level?.type === 'level') stack.push(...[...level.children].reverse())
    }
    const seen = new Set<string>()
    while (stack.length > 0) {
      const id = stack.pop() as string
      if (seen.has(id)) continue
      seen.add(id)
      const node = nodes[id as AnyNodeId]
      if (!node || node.type === 'footing' || node.type === 'foundation') continue
      if (nodeRegistry.get(node.type)?.capabilities?.drawsFoundation?.(node) === true) continue
      out.push(id)
      const children = (node as { children?: unknown }).children
      if (Array.isArray(children))
        for (let index = children.length - 1; index >= 0; index--)
          if (typeof children[index] === 'string') stack.push(children[index] as string)
    }
  }
  if (!byBuilding) {
    byBuilding = new Map()
    hiddenMemo.set(nodes, byBuilding)
  }
  byBuilding.set(buildingId, out)
  return out
}

/**
 * One kind of the foundation's concrete in the plan, building-local metres (the plan's frame): its
 * pieces merged, so no seams or overlaps show at the corners. `hidden` lines lie under concrete
 * above them (a slab's turned-down edge, a footing under its stem, a pile under its beam) and are
 * drawn dashed; `filled` concrete is what the plan cuts (the slab, a stem wall, a grade beam over
 * a crawl space). Piles are circles.
 */
export type FoundationPlanShape =
  | {
      kind: Exclude<FoundationMember['kind'], 'pile'>
      /** Closed rings, drawn as one shape (holes even-odd). */
      rings: P[][]
      hidden: boolean
      filled: boolean
    }
  | { kind: 'pile'; center: P; radius: number; hidden: true; filled: false }

/** Bottom to top as a plan draws them: the slab under its edge, the stems over their footings, piles on top. */
const PLAN_ORDER: Exclude<FoundationMember['kind'], 'pile'>[] = [
  'slab',
  'turndown',
  'footing',
  'grade-beam',
  'stem',
]

/** World plan to the building's own frame: the inverse of `levelLocalToWorldXZ`. */
function toBuildingLocal(building: BuildingNode, [x, z]: P): P {
  const angle = building.rotation?.[1] ?? 0
  const [px, , pz] = building.position ?? [0, 0, 0]
  const [dx, dz] = [x - px, z - pz]
  if (angle === 0) return [dx, dz]
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [cos * dx - sin * dz, sin * dx + cos * dz]
}

/** A run's footprint, world: `width` across its line, or its `section`'s reach across. */
function runFootprint(member: FoundationMember): P[] | null {
  const dx = member.to[0] - member.from[0]
  const dz = member.to[1] - member.from[1]
  const length = Math.hypot(dx, dz)
  if (length < 1e-9) return null
  // To the left of the run, as the section's `across` is measured.
  const [nx, nz] = [-dz / length, dx / length]
  const across = member.section?.map(([offset]) => offset) ?? [-member.width / 2, member.width / 2]
  const [low, high] = [Math.min(...across), Math.max(...across)]
  const at = ([x, z]: P, offset: number): P => [x + nx * offset, z + nz * offset]
  return [at(member.from, low), at(member.to, low), at(member.to, high), at(member.from, high)]
}

/** A ring as the clipper returns it, closed by repeating its first point: open it again. */
function openRing(ring: Ring): P[] {
  const points = ring.map(([x, z]) => [x, z] as P)
  const first = points[0]
  const last = points[points.length - 1]
  if (first && last && points.length > 1 && first[0] === last[0] && first[1] === last[1])
    points.pop()
  return points
}

/**
 * The foundation plan of the building: the concrete the engine draws under it, seen from above, in
 * the building's frame, bottom to top, each kind's pieces merged into one shape. Over a slab the
 * slab's outline is drawn and what it covers (its turned-down edge, a grade beam) shows only where
 * it ends inside it, dashed; without one, stems and grade beams are drawn whole and footings dashed
 * round them, as they are round a slab poured between stems (a garage's, a basement's).
 */
export function foundationPlan(nodes: Nodes, buildingId: string): FoundationPlanShape[] {
  const building = nodes[buildingId as AnyNodeId]
  if (building?.type !== 'building') return []
  const local = (point: P) => toBuildingLocal(building, point)
  const footprints = new Map<FoundationMember['kind'], Ring[]>()
  const piles: FoundationPlanShape[] = []
  for (const member of buildingFoundationMembers(nodes, buildingId)) {
    if (member.kind === 'pile') {
      piles.push({
        kind: 'pile',
        center: local(member.from),
        radius: member.width / 2,
        hidden: true,
        filled: false,
      })
      continue
    }
    const world = member.kind === 'slab' ? member.outline : runFootprint(member)
    if (!world || world.length < 3) continue
    const list = footprints.get(member.kind) ?? []
    list.push(world.map(local))
    footprints.set(member.kind, list)
  }
  // A slab between walls standing on stems (a garage's off a raised house, a basement's) covers
  // none of them: they stay whole, its door gaps showing as breaks in the curbs.
  const slabbed = footprints.has('slab') && !footprints.has('stem')
  const shapes: FoundationPlanShape[] = []
  for (const kind of PLAN_ORDER) {
    const rings = footprints.get(kind)
    if (!rings) continue
    const merged = union(rings)
    if (kind === 'slab') {
      shapes.push({
        kind,
        rings: merged.map((polygon) => openRing(polygon.outer)),
        hidden: false,
        filled: true,
      })
    } else if (slabbed) {
      // Under the slab its outside face is the slab's edge: only where it ends inside shows.
      const inner = merged.flatMap((polygon) => polygon.holes.map(openRing))
      if (inner.length > 0) shapes.push({ kind, rings: inner, hidden: true, filled: false })
    } else {
      const all = merged.flatMap((polygon) => [polygon.outer, ...polygon.holes].map(openRing))
      const hidden = kind === 'footing' || kind === 'turndown'
      shapes.push({ kind, rings: all, hidden, filled: !hidden })
    }
  }
  return [...shapes, ...piles]
}
