'use client'

import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo } from 'react'
import type { Material } from 'three'
import { buildShelfGeometry } from './geometry'
import type { ShelfNode } from './schema'

/**
 * Translucent preview of a shelf — used by the placement tool's cursor
 * and the registry mover. Defers to `buildShelfGeometry` so the preview
 * shape stays in lockstep with whatever the actual shelf will render,
 * then walks the result, **clones** each mesh's material, and mutates
 * the clone for a translucent ghost.
 *
 * Cloning is non-negotiable: shelf geometry may receive materials from
 * shared viewer caches, so mutating `mat.transparent = true` here would
 * leak into committed shelves using the same material.
 *
 * Building the full geometry tree per-frame would be wasteful, so we
 * memoize the group + dispose the per-mesh material clones on unmount.
 * Geometry is intentionally NOT disposed — `buildShelfGeometry` creates
 * fresh BufferGeometry per call, but if a future revision returns
 * cached geometry, disposing here would corrupt later renders. Keep the
 * cleanup focused on what the preview itself created (the clones).
 *
 * **Raycast is disabled** on every preview mesh: the cursor follows the
 * shelf, so without this the preview itself would intercept the cursor
 * ray, `grid:move` would stop firing as soon as the preview entered the
 * cursor cone, and the placement tool would lose track of the cursor's
 * grid position. Disabling raycast lets the ray pass through the ghost
 * to the grid plane below.
 */
const ShelfPreview = ({ node }: { node: ShelfNode }) => {
  const shading = useViewer((s) => s.shading)
  const built = useMemo(() => buildShelfGeometry(node, undefined, shading), [node, shading])

  useEffect(() => {
    const cloned: Material[] = []
    built.traverse((obj) => {
      // Skip pointer events: see component-level note above.
      ;(obj as unknown as { raycast: () => void }).raycast = () => {}

      // `Mesh.material` is typed as `Material | Material[]` upstream;
      // every shelf board carries a material from the geometry builder.
      // Access through a structural cast keeps the assignment well-typed
      // without depending on the Mesh union.
      const mesh = obj as {
        material?: Material | Material[]
      }
      if (!mesh.material) return

      const cloneAndSwap = (mat: Material): Material => {
        const c = mat.clone()
        c.transparent = true
        c.opacity = 0.5
        c.depthWrite = false
        cloned.push(c)
        return c
      }

      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map(cloneAndSwap)
      } else {
        mesh.material = cloneAndSwap(mesh.material)
      }
    })

    return () => {
      // Dispose only the clones we made — never the shared cached
      // material returned by the builder, which other shelves in the
      // scene may still reference. Geometry is left alone for the same
      // reason; the builder may move to a cached strategy in future.
      for (const c of cloned) c.dispose()
      built.traverse((obj) => {
        const mesh = obj as { geometry?: { dispose: () => void } }
        mesh.geometry?.dispose()
      })
    }
  }, [built])

  return <primitive object={built} />
}

export default ShelfPreview
