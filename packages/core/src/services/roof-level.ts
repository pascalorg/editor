import { applySceneChanges } from '../agent-operations/apply-changes'
import type { SceneChanges } from '../agent-operations/types'
import { getDefaultLevelName, getLevelDisplayName } from '../lib/level-name'
import {
  type AnyNode,
  type AnyNodeId,
  getActiveRoofHeight,
  LevelNode,
  type RoofNode,
  type RoofSegmentNode,
} from '../schema'
import { resolveRoofElevation } from '../systems/roof/roof-elevation'
import { getLevelAbove, getLevelBelow, getLevelElevations } from './storey'

/**
 * Roofs and levels, one rule for every path that writes a roof (the editor's roof tool, the
 * agents' create_roof, plugins): a roof lives on the level directly above the storey whose walls
 * carry it. Over a building's top storey that is the building's roof level, kept above every
 * storey, so exploded and solo level views lift the roof off the plan.
 */

type Nodes = Readonly<Record<string, AnyNode>>

/** What a storey holds and a roof level must not. */
const STOREY_CONTENT: ReadonlySet<string> = new Set([
  'wall',
  'zone',
  'slab',
  'ceiling',
  'item',
  'stair',
])

/** A level declared for its building's roofs (`metadata.role: 'roof'`). */
export function isRoofLevel(node: AnyNode | undefined): boolean {
  return node?.type === 'level' && node.metadata?.role === 'roof'
}

const childrenOf = (nodes: Nodes, level: LevelNode) =>
  level.children.map((id) => nodes[id]).filter((child): child is AnyNode => child !== undefined)

const roofsOn = (nodes: Nodes, level: LevelNode) =>
  childrenOf(nodes, level).filter((child): child is RoofNode => child.type === 'roof')

/**
 * A level that is its building's roof level: declared, or holding roofs (a roof level written
 * before levels declared it), and holding nothing a storey holds: a declared level someone walled
 * is a storey.
 */
function servesAsRoofLevel(nodes: Nodes, level: LevelNode): boolean {
  const children = childrenOf(nodes, level)
  return (
    (isRoofLevel(level) || children.some((child) => child.type === 'roof')) &&
    !children.some((child) => STOREY_CONTENT.has(child.type))
  )
}

const levelAbove = (nodes: Nodes, levelId: string) =>
  getLevelAbove(levelId, nodes as Parameters<typeof getLevelAbove>[1])

/** How far `storeyId`'s floor sits from `levelId`'s (m): negative, the storey being below. */
function storeyOffsetTo(nodes: Nodes, storeyId: string, levelId: string): number {
  const elevations = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)
  return (elevations.get(storeyId)?.baseY ?? 0) - (elevations.get(levelId)?.baseY ?? 0)
}

export type RoofLevelPlan =
  /** A storey stands directly above: it takes a roof over part of the storey below. */
  (
    | { kind: 'storey'; levelId: string }
    /** The building's roof level, `create`d first when it has none, `update`d when undeclared. */
    | {
        kind: 'roof'
        levelId: string
        create: LevelNode | null
        update: { id: string; data: Partial<LevelNode> }[]
      }
  ) & {
    /**
     * The storey's floor from the target level's, once the plan is written (m, negative): a roof
     * measured from the storey's floor sits its container this high on the target level.
     */
    storeyOffset: number
  }

/**
 * Where a roof carried by `storeyId`'s walls lives. Directly above the storey stands either a
 * storey (the roof covers part of the storey below it: a porch, a lower wing) or the building's
 * roof level: the level there when it serves as one, or is empty and the top of the stack, declared
 * if it was not; else a new "Roof" level `roofHeight` tall (the roof's rise over its eaves). An
 * empty level with another above it is a storey not built yet, never a roof level under a floor.
 * Pure: the caller writes the plan in the same step as the roof.
 */
export function planRoofLevel(nodes: Nodes, storeyId: string, roofHeight: number): RoofLevelPlan {
  const storey = nodes[storeyId]
  if (storey?.type !== 'level') throw Error(`${storeyId} is not a level`)
  const above = levelAbove(nodes, storeyId)
  if (
    above &&
    !servesAsRoofLevel(nodes, above) &&
    (above.children.length > 0 || levelAbove(nodes, above.id))
  )
    return {
      kind: 'storey',
      levelId: above.id,
      storeyOffset: storeyOffsetTo(nodes, storeyId, above.id),
    }
  if (above)
    return {
      kind: 'roof',
      levelId: above.id,
      storeyOffset: storeyOffsetTo(nodes, storeyId, above.id),
      create: null,
      update: isRoofLevel(above)
        ? []
        : [
            {
              id: above.id,
              data: {
                metadata: { ...above.metadata, role: 'roof' },
                // A name a person gave stays; an unnamed level would read as a floor.
                name:
                  getLevelDisplayName(above) === getDefaultLevelName(above.level)
                    ? 'Roof'
                    : above.name,
              },
            },
          ],
    }
  const level = LevelNode.parse({
    name: 'Roof',
    parentId: storey.parentId,
    level: storey.level + 1,
    height: Math.max(roofHeight, 0.2),
    children: [],
    metadata: { role: 'roof' },
  })
  return {
    kind: 'roof',
    levelId: level.id,
    storeyOffset: storeyOffsetTo({ ...nodes, [level.id]: level }, storeyId, level.id),
    create: level,
    update: [],
  }
}

/** The roofs over a storey: on the storey itself, and on the roof level directly above it. */
export function roofsOver(nodes: Nodes, storeyId: string): RoofNode[] {
  const storey = nodes[storeyId]
  if (storey?.type !== 'level') return []
  const above = levelAbove(nodes, storeyId)
  return [storey, ...(above && servesAsRoofLevel(nodes, above) ? [above] : [])].flatMap((level) =>
    roofsOn(nodes, level),
  )
}

/**
 * The storey a roof covers, the one whose walls carry it: the level holding the roof, or the storey
 * directly under the roof level holding it.
 */
export function storeyCoveredBy(nodes: Nodes, roofId: string): LevelNode | null {
  const level = nodes[nodes[roofId]?.parentId ?? '']
  if (level?.type !== 'level') return null
  return servesAsRoofLevel(nodes, level)
    ? getLevelBelow(level.id, nodes as Record<AnyNodeId, AnyNode>)
    : level
}

export type RoofMove = {
  plan: RoofLevelPlan
  changes: Required<Pick<SceneChanges, 'create' | 'update'>>
}

/**
 * The repair for roofs written onto the storey whose walls carry them (before the rule, or by a
 * tool that ignored it): every roof on `storeyId` goes to the level the rule gives it, its
 * container dropped by the storey's offset so it stands where it stood. A roof that follows walls
 * keeps following where the walls it finds there seat it at the same height; where they would lift
 * it (an upper storey's walls under a lower wing's roof), it keeps its height instead. Null when
 * the storey holds no walls or no roofs. Pure: one set of changes, so one undo step.
 */
export function planRoofsOffStorey(nodes: Nodes, storeyId: string): RoofMove | null {
  const storey = nodes[storeyId]
  if (storey?.type !== 'level') return null
  const roofs = roofsOn(nodes, storey)
  if (!(roofs.length && childrenOf(nodes, storey).some((child) => child.type === 'wall')))
    return null
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
 * Where a new top storey of `buildingId` goes: on top of its storeys, under the roof levels at the
 * top of its stack, which each move up one (`shift`), so the roof stays above every storey.
 */
export function storeyInsertIndex(
  nodes: Nodes,
  buildingId: string,
): { floorIndex: number; shift: { id: string; data: Pick<LevelNode, 'level'> }[] } {
  const building = nodes[buildingId]
  const levels = Object.values(nodes)
    .filter(
      (node): node is LevelNode =>
        node.type === 'level' &&
        (node.parentId === buildingId ||
          (building?.type === 'building' && building.children.includes(node.id))),
    )
    .sort((a, b) => a.level - b.level)
  let top = levels.length
  while (top > 0 && servesAsRoofLevel(nodes, levels[top - 1]!)) top--
  const roofLevels = levels.slice(top)
  if (!roofLevels.length)
    return { floorIndex: levels.length ? levels.at(-1)!.level + 1 : 0, shift: [] }
  return {
    floorIndex: roofLevels[0]!.level,
    shift: roofLevels.map((level) => ({ id: level.id, data: { level: level.level + 1 } })),
  }
}
