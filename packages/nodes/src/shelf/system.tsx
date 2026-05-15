import { type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { buildShelfGeometry } from './geometry'
import type { ShelfNode } from './schema'

/**
 * Imperative shelf system. Mirrors the pattern used by door/wall/item systems
 * (see `wiki/architecture/systems.md` and `renderers.md`): geometry generation
 * lives here, the renderer is a thin mount point.
 *
 * On every frame, walks `dirtyNodes`, finds the registered group for each
 * dirty shelf in `sceneRegistry`, swaps its children with the result of
 * `buildShelfGeometry(node)`, then clears the dirty flag. No React re-render
 * is involved in the rebuild, so parametric edits stay smooth even when the
 * inspector emits an `updateNode` every pointermove.
 */
export const ShelfSystem = () => {
  const dirtyNodes = useScene((s) => s.dirtyNodes)
  const clearDirty = useScene((s) => s.clearDirty)

  useFrame(() => {
    if (dirtyNodes.size === 0) return
    const nodes = useScene.getState().nodes

    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (!node || node.type !== 'shelf') return

      const group = sceneRegistry.nodes.get(id) as Group | undefined
      if (!group) return // mount hasn't run yet — keep dirty for next frame

      // Clear previous geometry. Disposing materials/geometries here keeps
      // long shelf-editing sessions from leaking GPU resources.
      for (const child of [...group.children]) {
        group.remove(child)
        if ('geometry' in child && (child as { geometry?: { dispose: () => void } }).geometry) {
          ;(child as { geometry: { dispose: () => void } }).geometry.dispose()
        }
        if ('material' in child) {
          const m = (child as { material: unknown }).material
          if (Array.isArray(m)) {
            for (const mat of m) (mat as { dispose: () => void }).dispose()
          } else if (m && typeof (m as { dispose?: () => void }).dispose === 'function') {
            ;(m as { dispose: () => void }).dispose()
          }
        }
      }

      const built = buildShelfGeometry(node as ShelfNode)
      for (const child of [...built.children]) {
        group.add(child)
      }

      clearDirty(id as AnyNodeId)
    })
  }, 2)

  return null
}

export default ShelfSystem
