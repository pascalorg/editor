import { getDefaultLevelName, getLevelDisplayName } from '../lib/level-name'
import { type AnyNode, LevelNode, type RoofNode } from '../schema'
import { getLevelAbove } from './storey'

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
 * A level that is its building's roof level: declared, or holding roofs and nothing a storey holds
 * (a roof level written before levels declared it).
 */
function servesAsRoofLevel(nodes: Nodes, level: LevelNode): boolean {
  if (isRoofLevel(level)) return true
  const children = childrenOf(nodes, level)
  return (
    children.some((child) => child.type === 'roof') &&
    !children.some((child) => STOREY_CONTENT.has(child.type))
  )
}

const levelAbove = (nodes: Nodes, levelId: string) =>
  getLevelAbove(levelId, nodes as Parameters<typeof getLevelAbove>[1])

export type RoofLevelPlan =
  /** A storey stands directly above: it takes a roof over part of the storey below. */
  | { kind: 'storey'; levelId: string }
  /** The building's roof level, `create`d first when it has none, `update`d when undeclared. */
  | {
      kind: 'roof'
      levelId: string
      create: LevelNode | null
      update: { id: string; data: Partial<LevelNode> }[]
    }

/**
 * Where a roof carried by `storeyId`'s walls lives. Directly above the storey stands either a
 * storey (the roof covers part of the storey below it: a porch, a lower wing) or the building's
 * roof level: the level there when it serves as one, or is empty, declared if it was not; else a
 * new "Roof" level `roofHeight` tall (the roof's rise over its eaves). Pure: the caller writes the
 * plan in the same step as the roof.
 */
export function planRoofLevel(nodes: Nodes, storeyId: string, roofHeight: number): RoofLevelPlan {
  const storey = nodes[storeyId]
  if (storey?.type !== 'level') throw Error(`${storeyId} is not a level`)
  const above = levelAbove(nodes, storeyId)
  if (above && !servesAsRoofLevel(nodes, above) && above.children.length > 0)
    return { kind: 'storey', levelId: above.id }
  if (above)
    return {
      kind: 'roof',
      levelId: above.id,
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
  return { kind: 'roof', levelId: level.id, create: level, update: [] }
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
