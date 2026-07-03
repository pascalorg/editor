'use client'

import { getVariantData, treeSpecOf } from './geometry'
import { KindProxy } from './instanced'
import type { TreeNode } from './schema'

const getVariant = (node: TreeNode) => getVariantData(treeSpecOf(node))
const colliderRadius = (node: TreeNode) => Math.max(0.4, (node.height ?? 5) * 0.18)

/**
 * Per-node selection proxy for the instanced trees — a thin binding of the
 * generic {@link KindProxy} to this kind's geometry + collider size.
 */
export default function TreeProxyRenderer({ node }: { node: TreeNode }) {
  return <KindProxy colliderRadius={colliderRadius} getVariant={getVariant} node={node} />
}
