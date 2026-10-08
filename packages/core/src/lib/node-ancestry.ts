import type { AnyNode, AnyNodeId } from '../schema'

/**
 * True when making `newParentId` the parent of `nodeId` would close a loop in
 * the hierarchy — either because the proposed parent *is* the node, or because
 * the node is already one of its ancestors.
 *
 * The scene graph is a tree: every `parentId` walk has to terminate. Node
 * schemas cannot prove that (each one only sees itself), so every mutation
 * that moves a node has to check it here. A cycle is not a cosmetic problem —
 * `resolveLevelId` is run over every node by `initSpatialGridSync`, so a
 * persisted cycle hangs the tab on scene load.
 *
 * An already-corrupt parent chain above the proposed parent counts as a cycle
 * too: the `seen` set stops the walk and refuses the move rather than hanging
 * on the way to deciding.
 */
export function wouldCreateHierarchyCycle(
  nodeId: AnyNodeId,
  newParentId: AnyNodeId | null | undefined,
  nodes: Record<string, AnyNode>,
): boolean {
  if (!newParentId) return false
  if (newParentId === nodeId) return true
  const seen = new Set<string>()
  let currentId: string | null = newParentId
  while (currentId) {
    if (currentId === nodeId) return true
    if (seen.has(currentId)) return true
    seen.add(currentId)
    currentId = (nodes[currentId]?.parentId as string | null | undefined) ?? null
  }
  return false
}

export function resolveLevelId(node: AnyNode, nodes: Record<string, AnyNode>): string {
  // If the node itself is a level
  if (node.type === 'level') return node.id

  // Walk up the parent chain to find the level. Scenes saved before
  // hierarchy mutations rejected cycles (and imports, migrations and
  // plugins) can still carry a corrupt chain, so stop on a repeated id
  // instead of looping forever: this runs for every node on scene load.
  let current: AnyNode | undefined = node
  const seen = new Set<string>()

  while (current) {
    if (current.type === 'level') return current.id
    if (seen.has(current.id)) break
    seen.add(current.id)
    current = current.parentId ? nodes[current.parentId] : undefined
  }

  return 'default' // fallback for orphaned items
}

/**
 * Walks the parent chain of `nodeId` and returns the id of the first ancestor
 * whose `type` is `'level'`, or `null` when no level ancestor exists (orphaned
 * node, top-level building node, etc.). Unlike `resolveLevelId`, this variant:
 *
 * - accepts a node **id** rather than a resolved node, saving the caller a
 *   `nodes[id]` lookup when only the id is at hand.
 * - returns `null` instead of the `'default'` fallback, which lets callers
 *   distinguish "genuinely has no level" from "is a level".
 * - has a loop guard (16 iterations) so a corrupt parent-chain cycle cannot
 *   hang the frame loop.
 */
export function findLevelAncestorId(
  nodeId: AnyNodeId,
  nodes: Record<string, AnyNode>,
): string | null {
  let current: AnyNode | undefined = nodes[nodeId]
  let guard = 0
  while (current && guard < 16) {
    if (current.type === 'level') return current.id
    current = current.parentId ? nodes[current.parentId] : undefined
    guard += 1
  }
  return null
}

/**
 * Returns the building id that contains the given level, or `null` if
 * the level is unparented or no enclosing building exists.
 *
 * Most scenes record the relationship via `level.parentId →
 * building.id`, but older serialisations occasionally drop `parentId`
 * even though the building's `children` array still references the
 * level. The fallback scan covers that case.
 *
 * Used by `FloorplanRegistryLayer` to discover building-scoped kinds
 * (`def.floorplanScope === 'building'`) without hardcoding any kind
 * name in the editor layer.
 */
export function resolveBuildingForLevel(
  levelId: AnyNodeId,
  nodes: Record<AnyNodeId, AnyNode>,
): AnyNodeId | null {
  const level = nodes[levelId] as AnyNode | undefined
  if (!level) return null
  const directParent = (level as { parentId?: AnyNodeId | null }).parentId ?? null
  if (directParent) {
    const candidate = nodes[directParent]
    if (candidate?.type === 'building') return candidate.id as AnyNodeId
  }
  for (const candidate of Object.values(nodes)) {
    if (candidate?.type !== 'building') continue
    const children = (candidate as { children?: AnyNodeId[] }).children
    if (Array.isArray(children) && children.includes(levelId)) {
      return candidate.id as AnyNodeId
    }
  }
  return null
}
