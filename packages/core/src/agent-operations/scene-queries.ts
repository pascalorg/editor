import type { AnyNode } from '../schema'
import type { SceneNodes } from './types'

export type LevelRole = 'occupied' | 'roof' | 'support'
export type ContentCounts = {
  walls: number
  zones: number
  doors: number
  windows: number
  items: number
  slabs: number
  ceilings: number
  roofs: number
  stairs: number
}

const metadataString = (node: AnyNode, key: string) => {
  const value = (node.metadata as Record<string, unknown> | undefined)?.[key]
  return typeof value === 'string' ? value : undefined
}

/** Every level, in floor order (ties by id). */
export function levelsOf(nodes: SceneNodes): (AnyNode & { type: 'level' })[] {
  return Object.values(nodes)
    .filter((node): node is AnyNode & { type: 'level' } => node.type === 'level')
    .sort((a, b) => a.level - b.level || a.id.localeCompare(b.id))
}

/** The level a node sits on, walking up its parents (a level resolves to itself). */
export function levelIdOf(nodes: SceneNodes, id: string): string | null {
  const seen = new Set<string>()
  let current: AnyNode | undefined = nodes[id]
  while (current && !seen.has(current.id)) {
    if (current.type === 'level') return current.id
    seen.add(current.id)
    current = current.parentId ? nodes[current.parentId] : undefined
  }
  return null
}

/** Everything under a node, at any depth, in the order the editor lists it; the node excluded. */
export function descendantsOf(nodes: SceneNodes, id: string): AnyNode[] {
  const found: AnyNode[] = []
  const seen = new Set<string>([id])
  const walk = (parentId: string) => {
    const node = nodes[parentId]
    if (!node || !('children' in node) || !Array.isArray(node.children)) return
    for (const child of node.children as string[]) {
      if (seen.has(child) || !nodes[child]) continue
      seen.add(child)
      found.push(nodes[child])
      walk(child)
    }
  }
  walk(id)
  return found
}

/** Everything on a level, at any depth, in the order the editor lists it. */
export const nodesOnLevel = (nodes: SceneNodes, levelId: string) => descendantsOf(nodes, levelId)

export function contentCounts(content: readonly AnyNode[]): ContentCounts {
  const count = (type: AnyNode['type']) => content.filter((node) => node.type === type).length
  return {
    walls: count('wall'),
    zones: count('zone'),
    doors: count('door'),
    windows: count('window'),
    items: count('item'),
    slabs: count('slab'),
    ceilings: count('ceiling'),
    roofs: count('roof'),
    stairs: count('stair'),
  }
}

/** A level is a storey unless it is declared (or found to be) only a roof or a support. */
export function classifyLevel(level: AnyNode, counts: ContentCounts): LevelRole {
  const declared = metadataString(level, 'role')
  if (declared === 'roof') return 'roof'
  if (declared === 'support') return 'support'
  const occupied =
    counts.walls +
    counts.zones +
    counts.doors +
    counts.windows +
    counts.items +
    counts.slabs +
    counts.ceilings +
    counts.stairs
  if (counts.roofs > 0 && occupied === 0) return 'roof'
  return 'occupied'
}

export function levelRole(nodes: SceneNodes, level: AnyNode) {
  const role = classifyLevel(level, contentCounts(nodesOnLevel(nodes, level.id)))
  return {
    role,
    metadataRole: metadataString(level, 'role') ?? null,
    referenceLevelId: metadataString(level, 'referenceLevelId') ?? null,
  }
}
