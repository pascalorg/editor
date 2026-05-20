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
      if (!node || node.type !== 'item') return

      const item = node as ItemNode
      const mesh = sceneRegistry.nodes.get(id) as THREE.Object3D
      if (!mesh) return

      if (item.asset.attachTo === 'wall-side') {
        // Wall-attached item: offset Z by half the parent wall's thickness
        const parentWall = item.parentId ? nodes[item.parentId as AnyNodeId] : undefined
        if (parentWall && parentWall.type === 'wall') {
          const wallThickness = (parentWall as WallNode).thickness ?? 0.1
          const side = item.side === 'front' ? 1 : -1
          mesh.position.z = (wallThickness / 2) * side
        }
      }

      clearDirty(id as AnyNodeId)
    })
  }, 2)

  return null
}
