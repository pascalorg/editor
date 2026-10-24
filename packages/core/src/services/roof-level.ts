import type { SceneNodes } from '../agent-operations/types'
import { getDefaultLevelName, getLevelDisplayName } from '../lib/level-name'
import { nodeRegistry } from '../registry'
import { queryNodes } from '../runtime/node-queries'
import { type AnyNode, LevelNode, type RoofNode } from '../schema'
import { getLevelElevations } from './storey'

/**
 * Roofs and levels, one rule for every path that writes a roof (the editor's roof tool, the
 * agents' create_roof, plugins): a roof lives on the level directly above the storey whose walls
 * carry it. Over a building's top storey that is the building's roof level, kept above every
 * storey, so exploded and solo level views lift the roof off the plan.
 */

type Nodes = Readonly<Record<string, AnyNode>>

/** What a storey holds and a roof level must not: its structure and rooms. */
const STOREY_CONTENT: ReadonlySet<string> = new Set([
  'wall',
  'zone',
  'slab',
  'ceiling',
  'item',
  'stair',
])

/**
 * Whether a node of this kind belongs on a storey, never on a roof level: a storey's structure and
 * rooms, and every kind that stands on a floor (`capabilities.floorPlaced`: cabinets, shelves,
 * columns, …).
 */
export const isStoreyContent = (
  type: string | undefined,
  metadata: Record<string, unknown> | undefined,
): boolean =>
  type !== undefined &&
  !(type === 'item' && (metadata?.role === 'roof' || metadata?.role === 'ceiling')) &&
  (STOREY_CONTENT.has(type) || nodeRegistry.get(type)?.capabilities?.floorPlaced !== undefined)

/** Retained roof geometry participates in level presentation without becoming parametric. */
export const isRoofGeometry = (node: AnyNode | undefined): boolean =>
  node?.type === 'roof' || (node?.type === 'item' && node.metadata?.role === 'roof')

/** Retained ceiling shells can lift with the roof while native room ceilings keep their hosts. */
export const isCeilingGeometry = (node: AnyNode | undefined): boolean =>
  node?.type === 'ceiling' || (node?.type === 'item' && node.metadata?.role === 'ceiling')

/** A level declared for its building's roofs (`metadata.role: 'roof'`). */
export function isRoofLevel(node: AnyNode | undefined): boolean {
  return node?.type === 'level' && node.metadata?.role === 'roof'
}

/** A level declared to carry structure, not rooms (`metadata.role: 'support'`). */
const isSupportLevel = (level: LevelNode) => level.metadata?.role === 'support'

const childrenOf = (nodes: Nodes, level: LevelNode) =>
  level.children.map((id) => nodes[id]).filter((child): child is AnyNode => child !== undefined)

/** A level holding roofs and nothing a storey holds, unless declared a support. */
const holdsOnlyRoofs = (nodes: Nodes, level: LevelNode) => {
  if (isSupportLevel(level)) return false
  const children = childrenOf(nodes, level)
  return (
    children.some(isRoofGeometry) &&
    !children.some((child) => isStoreyContent(child.type, child.metadata))
  )
}

/** A building's levels: those it lists, and those naming it as their parent. */
function levelsOf(nodes: Nodes, buildingId: string | null | undefined): LevelNode[] {
  const building = buildingId ? nodes[buildingId] : undefined
  const listed = new Set<string>(building?.type === 'building' ? building.children : [])
  return queryNodes<LevelNode>(nodes as SceneNodes, { type: 'level' }).filter(
    (node) => node.parentId === (buildingId ?? null) || listed.has(node.id),
  )
}

/**
 * A level that is its building's roof level: declared, whatever it holds (`verify_scene` reports a
 * declared one someone walled); or, in a building that declares none, a level holding roofs and
 * nothing a storey holds (a roof level written before levels declared it) with only such levels
 * above it. Never the lowest level, a carport's roof on its posts being its ground floor. A level
 * holding only roofs under a storey, or beside a declared roof level, is a storey still to be built
 * with a lower wing's roof on it: it takes walls. The one rule every reader of a level's role goes
 * by (`list_levels`, `verify_scene`, the agents' refusals, the editor's level stack and tools).
 */
export function servesAsRoofLevel(nodes: Nodes, level: LevelNode): boolean {
  if (isRoofLevel(level)) return true
  // What a level holds is read last: a storey's children are what concurrent edits add to.
  const stack = levelsOf(nodes, level.parentId)
  return (
    !stack.some(isRoofLevel) &&
    stack.some((other) => other.level < level.level) &&
    holdsOnlyRoofs(nodes, level) &&
    stack.every((other) => other.level <= level.level || holdsOnlyRoofs(nodes, other))
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
 * The storey under a roof level: the highest below it that holds something (levels still to be
 * built and support levels between are passed over), else the level directly below; the level
 * itself with none below.
 */
function storeyUnder(nodes: Nodes, level: LevelNode): string {
  const below = stackOf(nodes, level.id, 'below')
  return (
    below.find(
      (other) =>
        !servesAsRoofLevel(nodes, other) && !isSupportLevel(other) && other.children.length > 0,
    ) ??
    below[0] ??
    level
  ).id
}

/**
 * The storey a level stands for: for a level serving as a roof level, the storey it covers
 * (`storeyUnder`); else the level itself. Where storey content aimed at a roof level goes.
 */
export function storeyOf(nodes: Nodes, levelId: string): string {
  const level = nodes[levelId]
  return level?.type === 'level' && servesAsRoofLevel(nodes, level)
    ? storeyUnder(nodes, level)
    : levelId
}

/**
 * The storey a roof covers. On a roof level, the storey under it (`storeyUnder`). On a storey, the
 * storey below when the roof stands near its floor (a porch's or a lower wing's roof, seated on the
 * walls under it, as the rule places it); else the storey itself (a roof written on its own walls'
 * level, before roof levels). Null off a level.
 */
export function coveredStoreyId(nodes: Nodes, roof: RoofNode): string | null {
  const level = roof.parentId ? nodes[roof.parentId] : undefined
  if (level?.type !== 'level') return null
  if (servesAsRoofLevel(nodes, level)) return storeyUnder(nodes, level)
  const below = stackOf(nodes, level.id, 'below')
  if (!below.length) return level.id
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
 * The roof levels topping a building's stack (`servesAsRoofLevel`, which keeps an undeclared lowest
 * level a storey), bottom up: a building whose only level is declared the roof level has that one.
 */
function topRoofLevels(nodes: Nodes, buildingId: string): LevelNode[] {
  const levels = levelsOf(nodes, buildingId).sort((a, b) => a.level - b.level)
  let top = levels.length
  while (top > 0 && servesAsRoofLevel(nodes, levels[top - 1]!)) top--
  return levels.slice(top)
}

/**
 * Where a new top storey of `buildingId` goes: on top of its storeys, under the roof levels at the
 * top of its stack, which each move up one (`shift`), so the roof stays above every storey.
 */
export function storeyInsertIndex(
  nodes: Nodes,
  buildingId: string,
): { floorIndex: number; shift: { id: string; data: Pick<LevelNode, 'level'> }[] } {
  const roofLevels = topRoofLevels(nodes, buildingId)
  if (!roofLevels.length) {
    const levels = levelsOf(nodes, buildingId)
    return {
      floorIndex: levels.length ? Math.max(...levels.map((level) => level.level)) + 1 : 0,
      shift: [],
    }
  }
  return {
    floorIndex: roofLevels[0]!.level,
    shift: roofLevels.map((level) => ({ id: level.id, data: { level: level.level + 1 } })),
  }
}

/**
 * After a write that adds levels to `buildingId` (`before` to `after`), the floor indexes that keep
 * its roof levels above every other level: the ones topping its stack before, and a roof level the
 * write declares. An update per roof level that has to go up; none for a roof level in the middle
 * of a stack, which a write that does not touch it leaves where it is.
 */
export function liftRoofLevels(
  before: Nodes,
  after: Nodes,
  buildingId: string,
): { id: string; data: Pick<LevelNode, 'level'> }[] {
  const ids = new Set<string>(topRoofLevels(before, buildingId).map((level) => level.id))
  const levels = levelsOf(after, buildingId)
  for (const level of levels) if (!before[level.id] && isRoofLevel(level)) ids.add(level.id)
  const roofs = levels.filter((level) => ids.has(level.id)).sort((a, b) => a.level - b.level)
  const others = levels.filter((level) => !ids.has(level.id))
  if (!(roofs.length && others.length)) return []
  const top = Math.max(...others.map((level) => level.level))
  return roofs.flatMap((level, i) => {
    const floor = Math.max(level.level, top + 1 + i)
    return floor === level.level ? [] : [{ id: level.id, data: { level: floor } }]
  })
}

/**
 * New floor indexes (`floors`: level id to its index) that put a building's roof level under one of
 * its storeys it stood over: that pair, else null. Roles are read as the levels stand
 * (`servesAsRoofLevel`), so an order a legacy stack already had passes, and so does one among
 * storeys only. The one check every reorder goes by (the level selector, the chat's
 * `reorder_level`, the capture app's REST reorder, `apply_patch`).
 */
export function roofLevelOrderBreach(
  nodes: Nodes,
  floors: ReadonlyMap<string, number>,
): { roofId: string; storeyId: string } | null {
  const floorOf = (level: LevelNode) => floors.get(level.id) ?? level.level
  const buildings = new Set(
    [...floors.keys()].map((id) => nodes[id]).flatMap((node) => (node ? [node.parentId] : [])),
  )
  for (const buildingId of buildings) {
    const levels = levelsOf(nodes, buildingId)
    const roofs = levels.filter((level) => servesAsRoofLevel(nodes, level))
    for (const roof of roofs)
      for (const storey of levels.filter((level) => !roofs.includes(level)))
        if (roof.level > storey.level && floorOf(roof) < floorOf(storey))
          return { roofId: roof.id, storeyId: storey.id }
  }
  return null
}
