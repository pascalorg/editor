'use client'

import { getVariantData, treeSpecOf, treeVariantKey } from './geometry'
import { InstancedNodes } from './instanced'
import type { TreeNode } from './schema'

const variantKeyOf = (node: TreeNode) => treeVariantKey(treeSpecOf(node))
const getVariant = (node: TreeNode) => getVariantData(treeSpecOf(node))

/**
 * Collective renderer for the baked `/viewer` (`bakeReplaceRenderer`): one baked
 * level's trees, instanced in level-local space (the viewer portals this into
 * that level's `Object3D`). Same instancing as the editor `system`, so wind
 * phase varies per tree via `instanceIndex` and a forest is a few draw calls.
 */
export default function TreeReplaceInstances({ nodes }: { nodes: TreeNode[] }) {
  return (
    <InstancedNodes getVariant={getVariant} localSpace nodes={nodes} variantKeyOf={variantKeyOf} />
  )
}
