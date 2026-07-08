'use client'

import { useEffect, useMemo } from 'react'
import type { Material } from 'three'
import { generateTree, treeSpecOf } from './geometry'
import type { TreeNode } from './schema'
import { naturalHeight } from './variant-utils'

/**
 * Translucent placement ghost — a single ez-tree (not instanced) scaled to the
 * node's height, following the cursor. Clones each material for the see-through
 * look and disables raycast so the ghost never intercepts the cursor ray (which
 * would freeze `grid:move`).
 */
export default function TreePreview({ node }: { node: TreeNode }) {
  const built = useMemo(() => {
    const tree = generateTree(treeSpecOf(node))
    tree.scale.setScalar(node.height / naturalHeight(tree))
    return tree
  }, [node])

  useEffect(() => {
    const cloned: Material[] = []
    built.traverse((obj) => {
      ;(obj as unknown as { raycast: () => void }).raycast = () => {}
      const mesh = obj as { material?: Material | Material[] }
      if (!mesh.material) return
      const ghost = (mat: Material): Material => {
        const c = mat.clone()
        c.transparent = true
        c.opacity = 0.5
        c.depthWrite = false
        cloned.push(c)
        return c
      }
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(ghost) : ghost(mesh.material)
    })
    return () => {
      for (const c of cloned) c.dispose()
    }
  }, [built])

  return <primitive object={built} />
}
