import { applySceneChanges } from '../agent-operations/apply-changes'
import type { SceneChanges } from '../agent-operations/types'
import {
  type AnyNode,
  type AnyNodeId,
  getActiveRoofHeight,
  type RoofNode,
  type RoofSegmentNode,
} from '../schema'
import { resolveRoofElevation, roofWallTop } from '../systems/roof/roof-elevation'
import { coveredStoreyId, planRoofLevel, type RoofLevelPlan, servesAsRoofLevel } from './roof-level'
import { getLevelBelow, getLevelElevations, type LevelElevation } from './storey'

/**
 * Roofs written onto the storey whose walls carry them, before the roof level (or by a tool that
 * ignored it), and their move to the level the rule gives them (`planRoofLevel`).
 */

type Nodes = Readonly<Record<string, AnyNode>>

/**
 * Where a roof's segments bear, from the floor of the level holding it (m): the lowest of them;
 * null with none.
 */
function roofBearing(nodes: Nodes, roof: RoofNode): number | null {
  const heights = roof.children
    .map((id) => nodes[id])
    .filter((child): child is RoofSegmentNode => child?.type === 'roof-segment')
    .map((segment) => roof.position[1] + segment.position[1])
  return heights.length ? Math.min(...heights) : null
}

/** How far from a storey's wall tops a roof bears and still stands on them; a porch's beam is lower. */
const ON_WALLS = 0.15

/** Whether a roof bears on the tops of `levelId`'s walls under it. */
function bearsOn(nodes: Nodes, roof: RoofNode, levelId: string): boolean {
  const bearing = roofBearing(nodes, roof)
  const top = roofWallTop(roof, nodes, levelId)
  return bearing !== null && top !== null && Math.abs(bearing - top) <= ON_WALLS
}

/**
 * A roof held by the storey whose walls it stands on (written there before the rule, or by a tool
 * that ignored it): it hides that storey's plan in solo and exploded views, and
 * `planRoofsOffStorey` moves it. A roof over the storey below (a lower wing's, where the rule puts
 * it), or bearing on something else (a porch's beam, its posts), is not one.
 */
export function isRoofOnStoreyWalls(nodes: Nodes, roofId: string): boolean {
  const roof = nodes[roofId]
  const level = roof?.type === 'roof' ? nodes[roof.parentId ?? ''] : undefined
  if (roof?.type !== 'roof' || level?.type !== 'level' || servesAsRoofLevel(nodes, level))
    return false
  return bearsOn(nodes, roof, level.id)
}

export type RoofMove = {
  plan: RoofLevelPlan
  changes: Required<Pick<SceneChanges, 'create' | 'update'>>
}

/**
 * The repair for roofs written onto the storey whose walls carry them (`isRoofOnStoreyWalls`):
 * each goes to the level the rule gives it, its container dropped by the storey's offset so it
 * stands where it stood. A roof that follows walls keeps following where the walls it finds there
 * seat it at the same height; where they would lift it, or it would not find the storey's, it keeps
 * its height instead. Null when the storey holds no such roof. Pure: one set of changes, so one
 * undo step.
 */
export function planRoofsOffStorey(nodes: Nodes, storeyId: string): RoofMove | null {
  const storey = nodes[storeyId]
  if (storey?.type !== 'level') return null
  const roofs = storey.children
    .map((id) => nodes[id])
    .filter(
      (child): child is RoofNode => child?.type === 'roof' && isRoofOnStoreyWalls(nodes, child.id),
    )
  if (!roofs.length) return null
  const segmentsOf = (roof: RoofNode) =>
    roof.children
      .map((id) => nodes[id])
      .filter((child): child is RoofSegmentNode => child?.type === 'roof-segment')
  const segmentRise = (segment: RoofSegmentNode) =>
    (segment.wallHeight ?? 0) + getActiveRoofHeight(segment)
  const rise = Math.max(0, ...roofs.flatMap(segmentsOf).map(segmentRise))
  const planned = planRoofLevel(nodes, storeyId, rise)
  const seats = roofs.map((roof) => roof.position[1] + planned.storeyOffset)
  // A roof level made for them is as tall as they rise over its floor, the eaves' lift over the
  // storey included, as create_roof makes one; it lists its roofs from the start (updates land
  // before creates, in the store too).
  const plan: RoofLevelPlan =
    planned.kind === 'roof' && planned.create
      ? {
          ...planned,
          create: {
            ...planned.create,
            children: roofs.map((roof) => roof.id),
            height: Math.max(
              0.2,
              ...roofs.flatMap((roof, index) =>
                segmentsOf(roof).map(
                  (segment) => (seats[index] ?? 0) + segment.position[1] + segmentRise(segment),
                ),
              ),
            ),
          },
        }
      : planned
  const create =
    plan.kind === 'roof' && plan.create
      ? [{ node: plan.create as AnyNode, parentId: plan.create.parentId ?? undefined }]
      : []
  const moves = roofs.map((roof, index) => {
    const [x, , z] = roof.position
    const data: Partial<RoofNode> = {
      parentId: plan.levelId,
      position: [x, seats[index] ?? roof.position[1], z],
    }
    return { id: roof.id, data }
  })
  const update: { id: string; data: Partial<AnyNode> }[] = [
    ...(plan.kind === 'roof' ? plan.update : []),
    ...moves,
  ]
  const moved = applySceneChanges(nodes, { create, update })
  // The follow reads the walls of the level holding a roof and of the one directly under it: over
  // a support level or a level still to be built it would not see the storey's.
  const followSeesStorey =
    getLevelBelow(plan.levelId, moved as Record<AnyNodeId, AnyNode>)?.id === storeyId
  for (const { id, data } of moves) {
    const roof = moved[id] as RoofNode
    if (
      roof.support?.kind === 'walls' &&
      (!followSeesStorey || Math.abs(resolveRoofElevation(roof, moved) - roof.position[1]) > 1e-4)
    )
      data.support = { kind: 'level' }
  }
  return { plan, changes: { create, update } }
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
  const was = getLevelElevations(before as Record<AnyNodeId, AnyNode>)
  const now = getLevelElevations(after as Record<AnyNodeId, AnyNode>)
  const rise = (elevations: typeof now, levelId: string, storeyId: string) =>
    (elevations.get(levelId)?.baseY ?? 0) - (elevations.get(storeyId)?.baseY ?? 0)
  const updates: { id: AnyNodeId; data: Pick<RoofNode, 'position'> }[] = []
  for (const roof of Object.values(after)) {
    if (roof.type !== 'roof' || roof.support?.kind !== 'level' || !roof.parentId) continue
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
