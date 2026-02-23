import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import { sceneRegistry } from '../../hooks/scene-registry/scene-registry'
import { spatialGridManager } from '../../hooks/spatial-grid/spatial-grid-manager'
import { resolveLevelId } from '../../hooks/spatial-grid/spatial-grid-sync'
import { getScaledDimensions, type AnyNodeId, type ItemNode, type WallNode } from '../../schema'
import useScene from '../../store/use-scene'

// ============================================================================
// ITEM SYSTEM
// ============================================================================

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
          mesh.position.z = (wallThickness / 2) * side;
        }
      } else if (!item.asset.attachTo) {
        // If parented to another item (surface placement), R3F handles positioning via the hierarchy
        const parentNode = item.parentId ? nodes[item.parentId as AnyNodeId] : undefined
        if (parentNode?.type !== 'item') {
          // Floor item: elevate by slab height (using full footprint overlap)
          const levelId = resolveLevelId(item, nodes)
          const slabElevation = spatialGridManager.getSlabElevationForItem(
            levelId,
            item.position,
            getScaledDimensions(item),
            item.rotation,
          )
          mesh.position.y = slabElevation + item.position[1]
        }
      }

      clearDirty(id as AnyNodeId)
    }, 2)
  })

  return null
}
