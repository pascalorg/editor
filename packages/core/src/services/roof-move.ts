import { applySceneChanges } from '../agent-operations/apply-changes'
import type { SceneChanges, SceneNodes } from '../agent-operations/types'
import { getLevelDisplayName } from '../lib/level-name'
import { queryNodes } from '../runtime/node-queries'
import {
  type AnyNode,
  type AnyNodeId,
  getActiveRoofHeight,
  type LevelNode,
  parseNode,
  type RoofNode,
  type RoofSegmentNode,
} from '../schema'
import { resolveRoofElevation, roofWallTop } from '../systems/roof/roof-elevation'
import { segmentBearing } from './roof-bearing'
import { coveredStoreyId, planRoofLevel, type RoofLevelPlan, servesAsRoofLevel } from './roof-level'
import { getLevelBelow, getLevelElevations, type LevelElevation } from './storey'

/**
 * Roofs on the storey whose walls carry them: the repair for those written there before the roof
 * level (or by a tool that ignored it), and the seat each writer runs on its own changes, so that
 * no write leaves one there.
 */

type Nodes = Readonly<Record<string, AnyNode>>
type LevelElevations = ReturnType<typeof getLevelElevations>

const segmentsOf = (nodes: Nodes, roof: RoofNode) =>
  roof.children
    .map((id) => nodes[id])
    .filter((child): child is RoofSegmentNode => child?.type === 'roof-segment')

/**
 * Where a roof's segments bear, from the floor of the level holding it (m): the lowest of them;
 * null with none.
 */
function roofBearing(nodes: Nodes, roof: RoofNode): number | null {
  const heights = segmentsOf(nodes, roof).map((segment) => roof.position[1] + segment.position[1])
  return heights.length ? Math.min(...heights) : null
}

/** How far from a storey's wall tops a roof bears and still stands on them; a porch's beam is lower. */
const ON_WALLS = 0.15

/** Whether a roof's footprint bears on the tops of `levelId`'s walls under it: the height it keeps over a storey. */
function bearsOn(nodes: Nodes, roof: RoofNode, levelId: string): boolean {
  const bearing = roofBearing(nodes, roof)
  const top = roofWallTop(roof, nodes, levelId)
  return bearing !== null && top !== null && Math.abs(bearing - top) <= ON_WALLS
}

/**
 * A roof held by the storey whose walls carry it (written there before the rule, or by a tool that
 * ignored it): it hides that storey's plan in solo and exploded views; the seat and
 * `planRoofsOffStorey` move it. Some segment bears on the storey's walls (`segmentBearing`: walls
 * along its edges, open air past them) and the roof follows walls, or a segment's base or eave
 * stands at the eave those walls need (knee walls on the plate, or the segment's own walls rising to
 * it). A lower wing's roof on the storey above is not one (its inner edge has rooms past it), nor a
 * porch or portico on posts (no wall along its outer edges), nor a roof on another roof.
 */
export function isRoofOnStoreyWalls(nodes: Nodes, roofId: string): boolean {
  const roof = nodes[roofId]
  const level = roof?.type === 'roof' ? nodes[roof.parentId ?? ''] : undefined
  if (
    roof?.type !== 'roof' ||
    level?.type !== 'level' ||
    servesAsRoofLevel(nodes, level) ||
    roof.support?.kind === 'roof'
  )
    return false
  return segmentsOf(nodes, roof).some((segment) => {
    const { need } = segmentBearing(nodes, segment.id, level.id)
    if (need === null) return false
    if (roof.support?.kind === 'walls') return true
    const base = roof.position[1] + segment.position[1]
    return [base, base + segment.wallHeight].some((y) => Math.abs(y - need) <= ON_WALLS)
  })
}

export type RoofMove = {
  plan: RoofLevelPlan
  changes: Required<Pick<SceneChanges, 'create' | 'update'>>
}

/**
 * `roofs`, held by `storeyId` on its walls, moved to the level the rule gives them, each container
 * dropped by the storey's offset so it stands where it stood. A roof that follows walls keeps
 * following where the follow there reads the storey's walls, at the height it gives; elsewhere (over
 * a support level or a level still to be built) it keeps its height instead.
 */
function planRoofMove(nodes: Nodes, storeyId: string, roofs: RoofNode[]): RoofMove {
  const segmentRise = (segment: RoofSegmentNode) =>
    (segment.wallHeight ?? 0) + getActiveRoofHeight(segment)
  const rise = Math.max(0, ...roofs.flatMap((roof) => segmentsOf(nodes, roof)).map(segmentRise))
  const planned = planRoofLevel(nodes, storeyId, rise)
  const made = planned.kind === 'roof' ? planned.create : null
  const declares = planned.kind === 'roof' ? planned.update : []
  const ids = roofs.map((roof) => roof.id)
  const move = (roof: RoofNode, y: number, support?: RoofNode['support']) => {
    const [x, , z] = roof.position
    const data: Partial<RoofNode> = { parentId: planned.levelId, position: [x, y, z] }
    if (support) data.support = support
    return { id: roof.id, data: data as Partial<AnyNode> }
  }
  const kept = roofs.map((roof) => roof.position[1] + planned.storeyOffset)
  // A level made for them lists its roofs from the start (updates land before creates, in the
  // store too).
  const placed = applySceneChanges(nodes, {
    create: made ? [{ node: { ...made, children: ids } as AnyNode }] : [],
    update: [...declares, ...roofs.map((roof, index) => move(roof, kept[index]!))],
  })
  // The follow reads the walls of the level holding a roof and of the one directly under it: over
  // a support level or a level still to be built it would not see the storey's.
  const followSeesStorey =
    getLevelBelow(planned.levelId, placed as Record<AnyNodeId, AnyNode>)?.id === storeyId
  const moves = roofs.map((roof, index) =>
    roof.support?.kind !== 'walls'
      ? move(roof, kept[index]!)
      : followSeesStorey
        ? move(roof, resolveRoofElevation(placed[roof.id] as RoofNode, placed))
        : move(roof, kept[index]!, { kind: 'level' }),
  )
  // A roof level made for them is as tall as they rise over its floor, the eaves' lift over the
  // storey included, as create_roof makes one.
  const level: LevelNode | null = made && {
    ...made,
    children: ids as LevelNode['children'],
    height: Math.max(
      0.2,
      ...roofs.flatMap((roof, index) =>
        segmentsOf(nodes, roof).map(
          (segment) =>
            (moves[index]!.data as RoofNode).position[1] +
            segment.position[1] +
            segmentRise(segment),
        ),
      ),
    ),
  }
  return {
    plan: planned.kind === 'roof' && level ? { ...planned, create: level } : planned,
    changes: {
      create: level ? [{ node: level as AnyNode, parentId: level.parentId ?? undefined }] : [],
      update: [...declares, ...moves],
    },
  }
}

/**
 * The repair for roofs written onto the storey whose walls carry them (`isRoofOnStoreyWalls`):
 * each goes to the level the rule gives it, standing where it stood (`planRoofMove`). Null when the
 * storey holds no such roof. Pure: one set of changes, so one undo step.
 */
export function planRoofsOffStorey(nodes: Nodes, storeyId: string): RoofMove | null {
  const storey = nodes[storeyId]
  if (storey?.type !== 'level') return null
  const roofs = storey.children
    .map((id) => nodes[id])
    .filter(
      (child): child is RoofNode => child?.type === 'roof' && isRoofOnStoreyWalls(nodes, child.id),
    )
  return roofs.length ? planRoofMove(nodes, storeyId, roofs) : null
}

/**
 * Whether a roof stands over the storey under the level holding it: on the roof level over it
 * (`coveredStoreyId`), or on the storey above bearing on its walls and not on its own level's (a
 * lower wing's roof, where the rule puts it).
 */
function standsOver(nodes: Nodes, roof: RoofNode, storeyId: string): boolean {
  const level = nodes[roof.parentId ?? '']
  if (level?.type !== 'level' || coveredStoreyId(nodes, roof) !== storeyId) return false
  return (
    servesAsRoofLevel(nodes, level) ||
    (bearsOn(nodes, roof, storeyId) && !bearsOn(nodes, roof, level.id))
  )
}

/** The levels between a storey and a level above it in their building's stack, bottom up. */
function levelsBetween(
  elevations: Map<string, LevelElevation>,
  storeyId: string,
  levelId: string,
): string {
  const lower = elevations.get(storeyId)
  const upper = elevations.get(levelId)
  if (!lower || !upper) return ''
  return [...elevations]
    .filter(
      ([, entry]) =>
        entry.buildingId === upper.buildingId &&
        entry.ordinal > lower.ordinal &&
        entry.ordinal < upper.ordinal,
    )
    .sort(([, a], [, b]) => a.ordinal - b.ordinal)
    .map(([id]) => id)
    .join()
}

/**
 * A roof on a level above the storey it covers (`coveredStoreyId`), at a height of its own
 * (`support` level, as the agents' and the auto roof's are, measured from that storey's floor),
 * keeps its height over that floor when its level rises or drops over the storey (the storey, or a
 * support level or a level still to be built between them, made taller or shorter), as it did when
 * it lived on the storey. The updates that keep it there from `before` to `after`; a roof moved in
 * between, or whose level stands over another storey or other levels now, is left where it is.
 */
export function roofsKeptOverStorey(
  before: Nodes,
  after: Nodes,
): { id: AnyNodeId; data: Pick<RoofNode, 'position'> }[] {
  // Read only once a roof stands over a storey: elevations read every level of the scene.
  let elevations: { was: LevelElevations; now: LevelElevations } | undefined
  const rise = (of: LevelElevations, levelId: string, storeyId: string) =>
    (of.get(levelId)?.baseY ?? 0) - (of.get(storeyId)?.baseY ?? 0)
  const updates: { id: AnyNodeId; data: Pick<RoofNode, 'position'> }[] = []
  for (const roof of queryNodes<RoofNode>(after as SceneNodes, { type: 'roof' })) {
    if (roof.support?.kind !== 'level' || !roof.parentId) continue
    const prior = before[roof.id]
    if (
      prior?.type !== 'roof' ||
      prior.parentId !== roof.parentId ||
      prior.position[1] !== roof.position[1]
    )
      continue
    const storeyId = coveredStoreyId(after, roof)
    if (!storeyId || storeyId === roof.parentId || coveredStoreyId(before, prior) !== storeyId)
      continue
    elevations ??= {
      was: getLevelElevations(before as Record<AnyNodeId, AnyNode>),
      now: getLevelElevations(after as Record<AnyNodeId, AnyNode>),
    }
    const { was, now } = elevations
    // A level put in, taken out or reordered between them: the roof moves with its level (#1039).
    const between = levelsBetween(now, storeyId, roof.parentId)
    if (between !== levelsBetween(was, storeyId, roof.parentId)) continue
    const drift = rise(now, roof.parentId, storeyId) - rise(was, roof.parentId, storeyId)
    if (Math.abs(drift) < 1e-6 || !standsOver(before, prior, storeyId)) continue
    // Over levels between, only a roof on the storey's walls stays on them: one a new level lifted
    // off them stays on top of that level.
    if (between && !bearsOn(before, prior, storeyId)) continue
    const [x, y, z] = roof.position
    updates.push({ id: roof.id, data: { position: [x, y - drift, z] } })
  }
  return updates
}

const r3 = (value: number) => Math.round(value * 1000) / 1000

/** Whether two node values are the same, key order aside (a graph of fresh objects matches the store's). */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every((key) =>
    same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  )
}

const PLACEMENT = ['parentId', 'position', 'rotation', 'support', 'children'] as const

/** Whether a write made a roof, or moved, turned or reshaped it: its placement or a segment differs. */
function touched(before: Nodes, after: Nodes, roof: RoofNode): boolean {
  const prior = before[roof.id]
  if (prior?.type !== 'roof') return true
  return (
    PLACEMENT.some((key) => !same(prior[key], roof[key])) ||
    roof.children.some((id) => !same(before[id], after[id]))
  )
}

export type RoofSeat = {
  changes: Required<Pick<SceneChanges, 'create' | 'update'>>
  /** One per roof seated, for the write's answer. */
  notes: string[]
}

/**
 * The seat over the scene a write produced, `after` as the store leaves it (creates parsed and
 * attached, reparents and cascades applied), for writers that hold the result. A roof the write
 * made, moved, turned or reshaped that stands on its storey's walls (`isRoofOnStoreyWalls`) goes to
 * the level the rule gives it, as the repair moves it; one already on the same storey's walls before
 * stays (an edit does not migrate a legacy roof; `verify_scene` reports it). Storey by storey, each
 * move planned on the scene with the earlier ones applied, so one write makes one roof level per
 * building. Null when no roof needs it.
 */
export function planRoofSeats(before: Nodes, after: Nodes): RoofSeat | null {
  const byStorey = new Map<string, RoofNode[]>()
  for (const node of queryNodes<RoofNode>(after as SceneNodes, { type: 'roof' })) {
    if (!node.parentId) continue
    if (!(touched(before, after, node) && isRoofOnStoreyWalls(after, node.id))) continue
    const prior = before[node.id]
    if (
      prior?.type === 'roof' &&
      prior.parentId === node.parentId &&
      isRoofOnStoreyWalls(before, node.id)
    )
      continue
    byStorey.set(node.parentId, [...(byStorey.get(node.parentId) ?? []), node])
  }
  if (!byStorey.size) return null
  let scene = after
  const create: RoofSeat['changes']['create'] = []
  const update: RoofSeat['changes']['update'] = []
  const notes: string[] = []
  for (const [storeyId, roofs] of byStorey) {
    const { plan, changes } = planRoofMove(
      scene,
      storeyId,
      roofs.map((roof) => scene[roof.id] as RoofNode),
    )
    scene = applySceneChanges(scene, changes)
    create.push(...changes.create)
    update.push(...changes.update)
    const storey = scene[storeyId] as LevelNode
    const target = scene[plan.levelId] as LevelNode
    const how =
      plan.kind !== 'roof'
        ? ''
        : plan.create
          ? ', a new Roof level'
          : plan.update.length
            ? ', declared the roof level'
            : ''
    for (const { id } of roofs)
      notes.push(
        `roof ${id} stands on ${getLevelDisplayName(storey)}'s walls, so it is on ${getLevelDisplayName(target)} (${plan.levelId}${how}) at y ${r3((scene[id] as RoofNode).position[1])}: a roof lives on the level above the walls that carry it.`,
      )
  }
  // A level an earlier move made lists what later moves put on it.
  for (const entry of create)
    entry.node = {
      ...entry.node,
      children: (scene[entry.node.id] as LevelNode).children,
    } as AnyNode
  return { changes: { create, update }, notes }
}

type CreateEntry = { node: AnyNode; parentId?: string }
type NodeChanges = {
  create?: readonly CreateEntry[]
  update?: readonly { id: string; data: Partial<AnyNode> }[]
  delete?: readonly string[]
}

/**
 * A write's changes with the roofs it puts on their walls' storey seated by the rule
 * (`planRoofSeats` over the scene they produce), and a note per roof. The seat is written into the
 * changes themselves, so the writer's one store call lands it: a created roof's entry takes its new
 * parent and height (its other fields kept) and leaves a created parent's `children`; an existing
 * roof's move and a level's declaration are updates; a new roof level is created right after its
 * building when the write creates the building, else first, listing its roofs, so a store creating
 * in order and one applying updates first both land it.
 */
export function seatRoofs<C extends NodeChanges>(
  nodes: Nodes,
  changes: C,
): { changes: C; notes: string[] } {
  const parsed = (changes.create ?? []).map(({ node, parentId }) => {
    const result = parseNode(node)
    return { node: result.success ? result.data : node, parentId }
  })
  const seat = planRoofSeats(
    nodes,
    applySceneChanges(nodes, {
      create: parsed,
      update: [...(changes.update ?? [])],
      delete: [...(changes.delete ?? [])],
    }),
  )
  if (!seat) return { changes, notes: [] }
  const written = new Map<string, Record<string, unknown>>(
    seat.changes.update.map(({ id, data }) => [id, data]),
  )
  const leaving = (childId: unknown, parentId: string) => {
    const to = written.get(childId as string)?.parentId
    return to !== undefined && to !== parentId
  }
  const create: CreateEntry[] = (changes.create ?? []).map((entry) => {
    const data = written.get(entry.node.id)
    const node: Record<string, unknown> = { ...(entry.node as Record<string, unknown>), ...data }
    const children = Array.isArray(node.children) ? (node.children as unknown[]) : null
    const kept = children?.filter((id) => !leaving(id, entry.node.id))
    return {
      ...entry,
      node: (kept && kept.length !== children?.length
        ? { ...node, children: kept }
        : node) as AnyNode,
      ...(data?.parentId ? { parentId: data.parentId as string } : {}),
    }
  })
  for (const entry of seat.changes.create) {
    const building = create.findIndex(({ node }) => node.id === entry.node.parentId)
    create.splice(building + 1, 0, entry)
  }
  const created = new Set<string>(create.map(({ node }) => node.id))
  return {
    changes: {
      ...changes,
      create,
      update: [
        ...(changes.update ?? []),
        ...seat.changes.update.filter(({ id }) => !created.has(id)),
      ],
    } as C,
    notes: seat.notes,
  }
}
