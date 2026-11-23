import type { AnyNode, AnyNodeId } from '../schema/types'
import { nodeRegistry } from './registry'

/**
 * Validate the proposed graph before a mutation publishes it, including affected hosts. A kind's
 * `validateRelations` (its schema's meta) receives the node, the graph after and the graph before,
 * so a host can refuse only what the mutation adds.
 */
export function validateNodeRelations(
  before: Record<AnyNodeId, AnyNode>,
  next: Record<AnyNodeId, AnyNode>,
  changedIds: Iterable<AnyNodeId>,
) {
  const affected = new Set(changedIds)
  for (const id of [...affected]) {
    for (const node of [before[id], next[id]]) {
      if (node?.parentId) affected.add(node.parentId as AnyNodeId)
      if (node && 'children' in node)
        for (const child of node.children as AnyNodeId[]) affected.add(child)
    }
  }
  for (const id of affected) {
    const node = next[id]
    if (!node) continue
    const validate = nodeRegistry.get(node.type)?.schema?.meta?.()?.validateRelations
    if (typeof validate === 'function') validate(node, next, before)
  }
}
