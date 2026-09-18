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
import { useEffect, useMemo } from 'react'
import { Euler, Matrix4, type Object3D, Quaternion, Vector3 } from 'three'

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

type MountedExitPose = {
  mesh: Object3D
  parent: Object3D
  position: Vector3
  quaternion: Quaternion
  scale: Vector3
  autoUpdate: boolean
}

function restoreMountedExitPose(saved: MountedExitPose) {
  saved.mesh.matrixAutoUpdate = saved.autoUpdate
  saved.mesh.scale.copy(saved.scale)
  if (!saved.mesh.parent || saved.mesh.parent === saved.parent) {
    saved.mesh.position.copy(saved.position)
    saved.mesh.quaternion.copy(saved.quaternion)
  }
  saved.mesh.updateMatrix()
  saved.mesh.updateMatrixWorld(true)
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
  const preview = useMemo(
    () => ({
      local: new Matrix4(),
      target: new Matrix4(),
      position: new Vector3(),
      rotation: new Euler(),
      quaternion: new Quaternion(),
      unit: new Vector3(1, 1, 1),
      saved: new Map<string, MountedExitPose>(),
    }),
    [],
  )
  useEffect(() => {
    const restore = (id: string) => {
      const saved = preview.saved.get(id)
      if (!saved) return
      restoreMountedExitPose(saved)
      preview.saved.delete(id)
    }
    const sync = () => {
      const { nodes } = useScene.getState()
      const overrides = useLiveNodeOverrides.getState().overrides
      for (const id of preview.saved.keys()) {
        const node = nodes[id as AnyNodeId]
        const patch = overrides.get(id)
        if (!node || !patch?.parentId || patch.parentId === node.parentId) restore(id)
      }
      for (const [id, patch] of overrides) {
        const node = nodes[id as AnyNodeId]
        if (!node || !patch.parentId || patch.parentId === node.parentId || preview.saved.has(id))
          continue
        const mesh = sceneRegistry.nodes.get(id as AnyNodeId)
        if (!mesh?.parent) continue
        preview.saved.set(id, {
          mesh,
          parent: mesh.parent,
          position: mesh.position.clone(),
          quaternion: mesh.quaternion.clone(),
          scale: mesh.scale.clone(),
          autoUpdate: mesh.matrixAutoUpdate,
        })
      }
    }
    const unsubscribe = useLiveNodeOverrides.subscribe(sync)
    return () => {
      unsubscribe()
      for (const id of preview.saved.keys()) restore(id)
    }
  }, [preview])

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

      const mesh = sceneRegistry.nodes.get(id) as Object3D | undefined
      if (!mesh) return

      const liveTransform = useLiveTransforms.getState().get(id)
      const effectiveNode = withLiveTransform(getEffectiveNode(node as AnyNode), liveTransform)
      const position = (effectiveNode as PositionedNode).position
      if (!position) return
      if (effectiveNode.parentId !== node.parentId) return

      if (!(def.geometry || def.system) && dirtyNodes.has(id)) {
        clearDirty(id)
      }

      // `applies === false` means the kind opts OUT of floor stacking for this
      // node: its Y belongs to a host frame (a wall/ceiling-mounted item, a
      // cabinet module inside a run, a wall duct terminal). `getFloorPlacedElevation`
      // already returns 0 for them, so the write below would degenerate to
      // copying `position[1]` into the mesh — and tools publish live transforms
      // in WORLD space, so during a drag that lifts the ghost off its host by
      // the host frame's own elevation.
      if (floorPlaced.applies && !floorPlaced.applies(effectiveNode)) return
      // Hosted meshes inherit elevation from their parent (and possibly a surface group).
      // Their live transform can be world-space, so it cannot replace the mesh's local Y.
      if (!effectiveNode.parentId || nodes[effectiveNode.parentId as AnyNodeId]?.type !== 'level')
        return

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

  // PostProcessing draws at priority 1 after this system; later callbacks would show one wrong frame per move.
  useFrame(() => {
    const nodes = useScene.getState().nodes
    for (const [id, patch] of useLiveNodeOverrides.getState().overrides) {
      const node = nodes[id as AnyNodeId]
      if (!node || !patch.parentId || patch.parentId === node.parentId) continue
      const effective = getEffectiveNode(node) as PositionedNode
      if (effective.parentId === node.parentId || !effective.position) continue
      if (!effective.parentId || nodes[effective.parentId as AnyNodeId]?.type !== 'level') continue
      const mesh = sceneRegistry.nodes.get(id as AnyNodeId)
      const level = sceneRegistry.nodes.get(effective.parentId as AnyNodeId)
      if (!mesh?.parent || !level) continue
      const previous = preview.saved.get(id)
      if (previous?.mesh !== mesh) {
        if (previous) restoreMountedExitPose(previous)
        preview.saved.set(id, {
          mesh,
          parent: mesh.parent,
          position: mesh.position.clone(),
          quaternion: mesh.quaternion.clone(),
          scale: mesh.scale.clone(),
          autoUpdate: mesh.matrixAutoUpdate,
        })
      }
      const position = getFloorStackedPosition({
        node: effective,
        nodes,
        position: effective.position,
      })
      const rotation =
        typeof effective.rotation === 'number'
          ? ([0, effective.rotation, 0] as const)
          : (effective.rotation ?? ([0, 0, 0] as const))
      level.updateWorldMatrix(true, false)
      mesh.parent.updateWorldMatrix(true, false)
      // The override's parent is logical; the mesh still inherits the mounted host and surface wrapper.
      preview.local
        .copy(mesh.parent.matrixWorld)
        .invert()
        .multiply(level.matrixWorld)
        .multiply(
          preview.target.compose(
            preview.position.fromArray(position),
            preview.quaternion.setFromEuler(
              preview.rotation.set(rotation[0], rotation[1], rotation[2]),
            ),
            preview.unit,
          ),
        )
      // Keep the full matrix: a rotated child beneath nonuniform scale can require shear.
      mesh.matrixAutoUpdate = false
      mesh.matrix.copy(preview.local)
      mesh.updateMatrixWorld(true)
    }
  }, 1)

  return null
}
