import {
  type AnyNode,
  type AnyNodeId,
  getFloorPlacedElevation,
  nodeRegistry,
  resolveLevelId,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'

/**
 * Generic floor-elevation system.
 *
 * Walks `dirtyNodes` and, for any kind that declares
 * `capabilities.floorPlaced`, lifts the registered mesh's Y by whatever
 * slab the footprint overlaps. Items / shelves / etc. that sit directly
 * on a level pick this up automatically — no per-kind elevation logic.
 *
 * Skips nodes whose parent is not a level (items hosted on shelves /
 * tables inherit Y from the parent group), and respects
 * `floorPlaced.applies` so items with `asset.attachTo` (wall / ceiling
 * mounted) are left alone.
 *
 * Runs at priority 1 — before the priority-2 systems (`GeometrySystem`,
 * `ItemSystem`) so the dirty mark survives long enough for those to do
 * their own work. Doesn't clear dirty; the per-kind system (or the
 * generic geometry rebuild) is responsible for that.
 */
export const FloorElevationSystem = () => {
  const dirtyNodes = useScene((s) => s.dirtyNodes)

  useFrame(() => {
    if (dirtyNodes.size === 0) return
    const nodes = useScene.getState().nodes

    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (!node) return

      const def = nodeRegistry.get(node.type)
      const floorPlaced = def?.capabilities?.floorPlaced
      if (!floorPlaced) return

      if (floorPlaced.applies && !floorPlaced.applies(node as AnyNode)) return

      // Only nodes parented directly to a level get the lift. Children of
      // walls / ceilings / other items inherit Y from the parent group.
      const parentId = node.parentId as AnyNodeId | null
      const parent = parentId ? nodes[parentId] : null
      if (parent && parent.type !== 'level') return

      const mesh = sceneRegistry.nodes.get(id) as THREE.Object3D | undefined
      if (!mesh) return

      const position = (node as { position?: [number, number, number] }).position
      if (!position) return

      const levelId = resolveLevelId(node, nodes)
      if (!levelId) return

      const slabElevation = getFloorPlacedElevation({
        node: node as AnyNode,
        nodes,
        rotation: (node as { rotation?: number }).rotation,
        levelId,
        position,
      })
      mesh.position.y = slabElevation + position[1]
    })
  }, 1)

  return null
}
