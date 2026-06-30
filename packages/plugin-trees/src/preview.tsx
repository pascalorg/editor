'use client'

import { useEffect, useMemo } from 'react'
import type { Material } from 'three'
import { buildTreeGeometry } from './geometry'
import type { TreeNode } from './schema'

/**
 * Translucent placement ghost. Defers to `buildTreeGeometry` so the preview is
 * always exactly what the commit will create, then clones each material for a
 * see-through look and disables raycast so the ghost never intercepts the
 * cursor ray (which would freeze `grid:move`). Same contract as the built-in
 * shelf preview.
 */
export default function TreePreview({ node }: { node: TreeNode }) {
  const built = useMemo(() => buildTreeGeometry(node), [node])

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
      built.traverse((obj) => {
        const mesh = obj as { geometry?: { dispose: () => void } }
        mesh.geometry?.dispose()
      })
    }
  }, [built])

  return <primitive object={built} />
}
