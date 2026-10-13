import { getDefaultLevelName, getLevelDisplayName } from '../lib/level-name'
import { type AnyNode, LevelNode, type RoofNode } from '../schema'
import { getLevelElevations } from './storey'

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

/** A level declared to carry structure, not rooms (`metadata.role: 'support'`). */
const isSupportLevel = (level: LevelNode) => level.metadata?.role === 'support'

const childrenOf = (nodes: Nodes, level: LevelNode) =>
  level.children.map((id) => nodes[id]).filter((child): child is AnyNode => child !== undefined)

/**
 * A level that is its building's roof level: declared, whatever it holds (`verify_scene` reports a
 * declared one someone walled), or, unless declared a support, holding roofs and nothing a storey
 * holds (a roof level written before levels declared it). The one rule every reader of a level's role goes by (`list_levels`,
 * `verify_scene`, the agents' refusals, the editor's level stack).
 */
export function servesAsRoofLevel(nodes: Nodes, level: LevelNode): boolean {
  if (isRoofLevel(level)) return true
  // A declared support level stays one, roofs on it or not.
  if (isSupportLevel(level)) return false
  const children = childrenOf(nodes, level)
  return (
    children.some((child) => child.type === 'roof') &&
    !children.some((child) => STOREY_CONTENT.has(child.type))
  )
}

const elevationsOf = (nodes: Nodes) =>
  getLevelElevations(nodes as Parameters<typeof getLevelElevations>[0])

/** The other levels of a level's building, in stack order, below it or above it. */
function stackOf(nodes: Nodes, levelId: string, side: 'below' | 'above'): LevelNode[] {
  const elevations = elevationsOf(nodes)
  const own = elevations.get(levelId)
  if (!own) return []
  return [...elevations]
    .filter(
      ([, entry]) =>
        entry.buildingId === own.buildingId &&
        (side === 'above' ? entry.ordinal > own.ordinal : entry.ordinal < own.ordinal),
    )
    .sort(([, a], [, b]) => (side === 'above' ? a.ordinal - b.ordinal : b.ordinal - a.ordinal))
    .map(([id]) => nodes[id])
    .filter((node): node is LevelNode => node?.type === 'level')
}

export type RoofLevelPlan =
  /** A storey stands above: it takes a roof over part of the storey below. */
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

/** How far `storeyId`'s floor sits from `levelId`'s (m): negative, the storey being below. */
function storeyOffsetTo(nodes: Nodes, storeyId: string, levelId: string): number {
  const elevations = elevationsOf(nodes)
  return (elevations.get(storeyId)?.baseY ?? 0) - (elevations.get(levelId)?.baseY ?? 0)
}

/** A level reused as the roof level, declared when it was not. */
function roofLevelPlan(nodes: Nodes, storeyId: string, level: LevelNode): RoofLevelPlan {
  return {
    kind: 'roof',
    levelId: level.id,
    storeyOffset: storeyOffsetTo(nodes, storeyId, level.id),
    create: null,
    update: isRoofLevel(level)
      ? []
      : [
          {
            id: level.id,
            data: {
              metadata: { ...level.metadata, role: 'roof' },
              // A name a person gave stays; an unnamed level would read as a floor.
              name:
                getLevelDisplayName(level) === getDefaultLevelName(level.level)
                  ? 'Roof'
                  : level.name,
            },
          },
        ],
  }
}

/**
 * The level that takes the roofs over `storeyId`'s walls, as the scene stands. With a storey built
 * above (anything on it), the storey directly above takes the roof over part of the one below: a
 * porch, a lower wing. Else the building's roof level, above every level still to be built and
 * every support level: the roof level there; the empty level directly above when it is the only
 * one; else none yet (`level` null). Reads only, so a panel can ask on every store change.
 */
export function roofLevelAbove(
  nodes: Nodes,
  storeyId: string,
): { kind: 'storey'; level: LevelNode } | { kind: 'roof'; level: LevelNode | null } {
  const above = stackOf(nodes, storeyId, 'above')
  const isPlain = (level: LevelNode) => !servesAsRoofLevel(nodes, level) && !isSupportLevel(level)
  // The roof stands on the storey directly above, an empty one still to be built included.
  if (above.some((level) => isPlain(level) && level.children.length > 0))
    return { kind: 'storey', level: above.find(isPlain)! }
  const top = above.filter((level) => !servesAsRoofLevel(nodes, level)).at(-1)
  const roofLevel = above.find(
    (level) => servesAsRoofLevel(nodes, level) && (!top || level.level > top.level),
  )
  if (roofLevel) return { kind: 'roof', level: roofLevel }
  if (above.length === 1 && isPlain(above[0]!)) return { kind: 'roof', level: above[0]! }
  return { kind: 'roof', level: null }
}

/**
 * Where a roof carried by `storeyId`'s walls lives (`roofLevelAbove`): the storey directly above,
 * or the building's roof level, declared if it was not, else a new "Roof" level `roofHeight` tall
 * (the roof's rise over its eaves) on top. Pure: the caller writes the plan in the same step as the
 * roof.
 */
export function planRoofLevel(nodes: Nodes, storeyId: string, roofHeight: number): RoofLevelPlan {
  const storey = nodes[storeyId]
  if (storey?.type !== 'level') throw Error(`${storeyId} is not a level`)
  const target = roofLevelAbove(nodes, storeyId)
  if (target.kind === 'storey')
    return {
      kind: 'storey',
      levelId: target.level.id,
      storeyOffset: storeyOffsetTo(nodes, storeyId, target.level.id),
    }
  if (target.level) return roofLevelPlan(nodes, storeyId, target.level)
  const top = stackOf(nodes, storeyId, 'above')
    .filter((level) => !servesAsRoofLevel(nodes, level))
    .at(-1)
  const level = LevelNode.parse({
    name: 'Roof',
    parentId: storey.parentId,
    level: (top ?? storey).level + 1,
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

/**
 * The storey a roof covers. On a roof level, the highest storey below it that holds something
 * (levels still to be built and support levels between are passed over), else the level directly
 * below. On a storey, the storey below when the roof stands near its floor (a porch's or a lower
 * wing's roof, seated on the walls under it, as the rule places it); else the storey itself (a roof
 * written on its own walls' level, before roof levels). Null off a level.
 */
export function coveredStoreyId(nodes: Nodes, roof: RoofNode): string | null {
  const level = roof.parentId ? nodes[roof.parentId] : undefined
  if (level?.type !== 'level') return null
  const below = stackOf(nodes, level.id, 'below')
  if (!below.length) return level.id
  if (servesAsRoofLevel(nodes, level))
    return (
      below.find(
        (other) =>
          !servesAsRoofLevel(nodes, other) && !isSupportLevel(other) && other.children.length > 0,
      ) ?? below[0]!
    ).id
  const height = elevationsOf(nodes).get(level.id)?.height ?? 0
  return roof.position[1] < height / 2 ? below[0]!.id : level.id
}

/** The roofs over a storey, wherever they stand (`coveredStoreyId`). */
export function roofsOver(nodes: Nodes, storeyId: string): RoofNode[] {
  return Object.values(nodes).filter(
    (node): node is RoofNode => node.type === 'roof' && coveredStoreyId(nodes, node) === storeyId,
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
  // The lowest level is always a storey: a carport's roof on its posts is its ground floor.
  let top = levels.length
  while (top > 1 && servesAsRoofLevel(nodes, levels[top - 1]!)) top--
  const roofLevels = levels.slice(top)
  if (!roofLevels.length)
    return { floorIndex: levels.length ? levels.at(-1)!.level + 1 : 0, shift: [] }
  return {
    floorIndex: roofLevels[0]!.level,
    shift: roofLevels.map((level) => ({ id: level.id, data: { level: level.level + 1 } })),
  }
}
