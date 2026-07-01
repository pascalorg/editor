'use client'

import { getVariantData, treeSpecOf } from './geometry'
import { KindStatic } from './instanced'
import type { TreeNode } from './schema'

const getVariant = (node: TreeNode) => getVariantData(treeSpecOf(node))

/**
 * Live static tree for the baked `/viewer` (`def.bakeReplaceRenderer`) — the
 * real ez-tree geometry with its wind materials, portaled into the tree's baked
 * level in place of the stripped static mesh. See plans → Part D.
 */
export default function TreeStaticRenderer({ node }: { node: TreeNode }) {
  return <KindStatic getVariant={getVariant} node={node} />
}
