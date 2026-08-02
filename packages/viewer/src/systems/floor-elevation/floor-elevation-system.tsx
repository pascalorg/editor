import {
  type AnyNode,
  type AnyNodeId,
  getEffectiveNode,
  getFloorStackedPosition,
  type LiveTransform,
  nodeRegistry,
  sceneRegistry,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'

type PositionedNode = AnyNode & {
  position?: [number, number, number]
  rotation?: [number, number, number] | number
}

function withLiveTransform(node: AnyNode, liveTransform: LiveTransform | undefined): AnyNode {
  if (!liveTransform) return node

  const currentRotation = (node as PositionedNode).rotation
  const rotation = Array.isArray(currentRotation)
    ? ([currentRotation[0] ?? 0, liveTransform.rotation, currentRotation[2] ?? 0] as [
        number,
        number,
        number,
      ])
    : typeof currentRotation === 'number'
      ? liveTransform.rotation
      : currentRotation

  return {
    ...(node as Record<string, unknown>),
    position: liveTransform.position,
    ...(rotation !== undefined ? { rotation } : {}),
  } as AnyNode
}

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
 * their own work. Kinds with no geometry/system have no downstream dirty
 * consumer, so this system clears their dirty mark after applying the lift.
 */
export const FloorElevationSystem = () => {
  const dirtyNodes = useScene((s) => s.dirtyNodes)
  const clearDirty = useScene((s) => s.clearDirty)

  useFrame(() => {
    // Nodes with a live preview (override / transform) are reapplied EVERY
    // frame, not only while dirty: the React commit that rebinds the group's
    // base-Y position can land between frames, after the dirty mark was
    // already consumed by the priority-2 systems — without this the lift
    // vanishes until the next pointer tick re-dirties (visible Y blink
    // during group drags over elevated slabs).
    const overrides = useLiveNodeOverrides.getState().overrides
    const transforms = useLiveTransforms.getState().transforms
    if (dirtyNodes.size === 0 && overrides.size === 0 && transforms.size === 0) return
    const nodes = useScene.getState().nodes

    const applyLift = (id: AnyNodeId) => {
      const node = nodes[id]
      if (!node) return

      const def = nodeRegistry.get(node.type)
      const floorPlaced = def?.capabilities?.floorPlaced
      if (!floorPlaced) return

      const mesh = sceneRegistry.nodes.get(id) as THREE.Object3D | undefined
      if (!mesh) return

      const liveTransform = useLiveTransforms.getState().get(id)
      const effectiveNode = withLiveTransform(getEffectiveNode(node as AnyNode), liveTransform)
      const position = (effectiveNode as PositionedNode).position
      if (!position) return

      // This system is the single drag-time authority for floor-stack mesh Y:
      // tools publish base positions to live stores, renderers may
      // reconcile that base Y onto the group, then this presentation system
      // reapplies the resolver-derived visual Y before render. Because the
      // override/store position remains base-height, the slab lift is never
      // committed or applied twice.
      const resolverNodes =
        effectiveNode === node ? nodes : { ...nodes, [effectiveNode.id]: effectiveNode }
      const visualPosition = getFloorStackedPosition({
        node: effectiveNode,
        nodes: resolverNodes,
        position,
        // 3D drags publish the pointer-decided surface cap with their live
        // transform; honoring it here keeps this system's per-frame Y in
        // agreement with the tool's preview (no deck/floor flicker).
        maxElevation: liveTransform?.supportElevationCap,
      })
      mesh.position.y = visualPosition[1]

      if (!(def.geometry || def.system) && dirtyNodes.has(id)) {
        clearDirty(id)
      }
    }

    dirtyNodes.forEach((id) => {
      applyLift(id)
    })
    overrides.forEach((_values, id) => {
      if (!dirtyNodes.has(id as AnyNodeId)) applyLift(id as AnyNodeId)
    })
    transforms.forEach((_transform, id) => {
      if (!dirtyNodes.has(id as AnyNodeId) && !overrides.has(id)) applyLift(id as AnyNodeId)
    })
  }, 1)

  return null
}
