'use client'

import { getVariantData, treeSpecOf, treeVariantKey } from './geometry'
import { InstancedKindSystem } from './instanced'
import type { TreeNode } from './schema'

// Module-scope so identities stay stable (the system memoises on them).
const variantKeyOf = (node: TreeNode) => treeVariantKey(treeSpecOf(node))
const getVariant = (node: TreeNode) => getVariantData(treeSpecOf(node))

/**
 * Collective instanced renderer for every placed tree — contributed via
 * `def.system`. Buckets trees by their geometry variant and draws each variant
 * as one InstancedMesh per ez-tree sub-mesh, so a forest is a handful of draw
 * calls. Selection/outline come from the per-node proxy renderer.
 */
export default function TreesSystem() {
  return (
    <InstancedKindSystem<TreeNode>
      getVariant={getVariant}
      kind="trees:tree"
      variantKeyOf={variantKeyOf}
    />
  )
}
