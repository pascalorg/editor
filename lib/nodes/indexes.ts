/**
 * Node Index Management
 *
 * Utilities for building and maintaining indexes for fast node lookups.
 * Indexes are rebuilt whenever the node tree is modified.
 */

import type { BaseNode } from './types'
import { traverseTree } from './utils'

// ============================================================================
// INDEX BUILDING
// ============================================================================

/**
 * Build minimal node index (just by ID)
 */
export function buildNodeIndex(nodes: BaseNode[]): Map<string, BaseNode> {
  const index = new Map<string, BaseNode>()

  for (const node of nodes) {
    index.set(node.id, node)

    traverseTree(node, ((child) => {
      index.set(child.id, child)
    }) as (node: BaseNode, parent: BaseNode | null, depth: number) => boolean | undefined)
  }

  return index
}
