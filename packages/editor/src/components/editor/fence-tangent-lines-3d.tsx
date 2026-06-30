'use client'

import {
  type AnyNodeId,
  type FenceNode,
  getFenceControlHandle,
  isSplineFence,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { createPortal, useFrame } from '@react-three/fiber'
import { useMemo, useState } from 'react'
import { BufferGeometry, type Object3D, Vector3 } from 'three'
import { EDITOR_LAYER } from '../../lib/constants'

/**
 * Straight connecting line through each spline-fence control point joining its
 * two tangent handle ends (the classic pen-tool look). The handle *dots* are
 * registry tap-handles (see `fence/definition.ts`); this overlay only draws
 * the line between them, in both views' 3D scene.
 *
 * Must match the handle placement's arm scale so the line ends land exactly on
 * the dots. Portals into the fence's own Object3D so it inherits the same world
 * transform as the geometry (path coords are node-local plan meters), and reads
 * the live override so the line tracks an in-flight tangent / point drag.
 */

// Keep in sync with TANGENT_HANDLE_ARM_SCALE in fence/definition.ts.
const TANGENT_HANDLE_ARM_SCALE = 3
const LINE_LIFT_Y = 0.02

export function FenceTangentLines3D() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null

  const rawNode = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : null))
  const liveOverride = useLiveNodeOverrides((s) =>
    selectedId ? s.overrides.get(selectedId as AnyNodeId) : undefined,
  )
  const fence = useMemo<FenceNode | null>(() => {
    if (rawNode?.type !== 'fence') return null
    const merged = liveOverride ? ({ ...rawNode, ...liveOverride } as FenceNode) : rawNode
    return isSplineFence(merged) ? merged : null
  }, [rawNode, liveOverride])

  const [object, setObject] = useState<{ id: AnyNodeId; object: Object3D } | null>(null)
  const selectedObject = selectedId && object?.id === selectedId ? object.object : null

  useFrame(() => {
    if (!selectedId || selectedObject) return
    const next = sceneRegistry.nodes.get(selectedId)
    if (next) setObject({ id: selectedId as AnyNodeId, object: next })
  })

  const geometry = useMemo(() => {
    if (!fence?.path) return null
    const positions: Vector3[] = []
    for (let i = 0; i < fence.path.length; i += 1) {
      const point = fence.path[i]!
      const handle = getFenceControlHandle(fence.path, fence.tangents, i)
      const ax = handle.x * TANGENT_HANDLE_ARM_SCALE
      const az = handle.y * TANGENT_HANDLE_ARM_SCALE
      // One disjoint segment per point — `lineSegments` pairs vertices, so the
      // in/out ends connect through the point without joining across points.
      positions.push(new Vector3(point[0] - ax, LINE_LIFT_Y, point[1] - az))
      positions.push(new Vector3(point[0] + ax, LINE_LIFT_Y, point[1] + az))
    }
    return new BufferGeometry().setFromPoints(positions)
  }, [fence])

  if (!(fence && selectedObject && geometry)) return null

  return createPortal(
    <lineSegments frustumCulled={false} geometry={geometry} layers={EDITOR_LAYER} renderOrder={3}>
      <lineBasicNodeMaterial
        color="#8381ed"
        depthTest={false}
        depthWrite={false}
        opacity={0.85}
        transparent
      />
    </lineSegments>,
    selectedObject,
  )
}
