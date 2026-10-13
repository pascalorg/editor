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
import { getLevelBelow, getLevelElevations } from './storey'

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
 * seat it at the same height; where they would lift it, it keeps its height instead. Null when the
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
  if (!roofs.length) return null
  const rise = Math.max(
    0,
    ...roofs
      .flatMap((roof) => roof.children.map((id) => nodes[id]))
      .filter((child): child is RoofSegmentNode => child?.type === 'roof-segment')
      .map((segment) => (segment.wallHeight ?? 0) + getActiveRoofHeight(segment)),
  )
  const plan = planRoofLevel(nodes, storeyId, rise)
  // Updates land before creates (in the store too): a new level lists its roofs from the start.
  const create =
    plan.kind === 'roof' && plan.create
      ? [
          {
            node: { ...plan.create, children: roofs.map((roof) => roof.id) } as AnyNode,
            parentId: plan.create.parentId ?? undefined,
          },
        ]
      : []
  const moves = roofs.map((roof) => {
    const [x, y, z] = roof.position
    const data: Partial<RoofNode> = {
      parentId: plan.levelId,
      position: [x, y + plan.storeyOffset, z],
    }
    return { id: roof.id, data }
  })
  const update: { id: string; data: Partial<AnyNode> }[] = [
    ...(plan.kind === 'roof' ? plan.update : []),
    ...moves,
  ]
  const moved = applySceneChanges(nodes, { create, update })
  for (const { id, data } of moves) {
    const roof = moved[id] as RoofNode
    if (
      roof.support?.kind === 'walls' &&
      Math.abs(resolveRoofElevation(roof, moved) - roof.position[1]) > 1e-4
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

/**
 * A roof on the level above the storey it covers, at a height of its own (`support` level, as the
 * agents' and the auto roof's are, measured from that storey's floor), keeps its height over that
 * floor when its level rises or drops over the storey (the storey made taller or shorter), as it
 * did when it lived on the storey. The updates that keep it there from `before` to `after`; a roof
 * moved in between, or whose level stands over another storey now, is left where it is.
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
    const storeyId = getLevelBelow(roof.parentId, after as Record<AnyNodeId, AnyNode>)?.id
    if (
      !storeyId ||
      getLevelBelow(roof.parentId, before as Record<AnyNodeId, AnyNode>)?.id !== storeyId
    )
      continue
    const drift = rise(now, roof.parentId, storeyId) - rise(was, roof.parentId, storeyId)
    if (Math.abs(drift) < 1e-6 || !standsOver(before, prior, storeyId)) continue
    const [x, y, z] = roof.position
    updates.push({ id: roof.id, data: { position: [x, y - drift, z] } })
  }
  return updates
}
