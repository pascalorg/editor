import {
  type AnyNodeId,
  type ItemNode,
  sceneRegistry,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'

// ============================================================================
// ITEM SYSTEM
// ============================================================================

/**
 * Per-frame wall-side offset for items mounted to wall faces. The slab-
 * elevation lift for floor items lives in the generic
 * `<FloorElevationSystem>` and runs at priority 1 — it has already
 * landed `mesh.position.y` by the time this system clears the dirty
 * mark at priority 2.
 */
export const ItemSystem = () => {
  const dirtyNodes = useScene((state) => state.dirtyNodes)
  const clearDirty = useScene((state) => state.clearDirty)

  useFrame(() => {
    if (dirtyNodes.size === 0) return
    const nodes = useScene.getState().nodes

    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (node?.type !== 'item') return

      const item = node as ItemNode
      const mesh = sceneRegistry.nodes.get(id) as THREE.Object3D
      if (!mesh) return

      if (item.asset.attachTo === 'wall-side') {
        // Wall-attached item: offset Z by half the host wall's thickness.
        // Roof-segment wall faces share the convention — the face frame's
        // z = 0 is the wall mid-plane, so the same push lands the item on
        // the outer surface.
        const parent = item.parentId ? nodes[item.parentId as AnyNodeId] : undefined
        const thickness =
          parent?.type === 'wall'
            ? ((parent as WallNode).thickness ?? 0.1)
            : parent?.type === 'roof-segment'
              ? (parent.wallThickness ?? 0.1)
              : undefined
        if (thickness !== undefined) {
          const side = item.side === 'front' ? 1 : -1
          mesh.position.z = (thickness / 2) * side
        }
      }

      clearDirty(id as AnyNodeId)
    })
  }, 2)

  return null
}
