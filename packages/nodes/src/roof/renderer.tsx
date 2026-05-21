'use client'

import {
  type AnyNodeId,
  type RoofNode,
  type RoofSegmentNode,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { getRoofMaterialArray, NodeRenderer, useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'
import { roofDebugMaterials, roofMaterials } from './roof-materials'

export const RoofRenderer = ({ node }: { node: RoofNode }) => {
  const ref = useRef<THREE.Group>(null!)

  useRegistry(node.id, 'roof', ref)
  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'roof')
  const debugColors = useViewer((s) => s.debugColors)

  // Collect roof element IDs (chimneys, skylights, etc.) hosted by any segment.
  // Rendered outside segments-wrapper (invisible during normal mode) so elements
  // stay visible at all times.
  const roofElementIds = useScene(
    useShallow((state) => {
      const ids: AnyNodeId[] = []
      for (const segmentId of node.children ?? []) {
        const seg = state.nodes[segmentId as AnyNodeId] as RoofSegmentNode | undefined
        if (!seg) continue
        for (const childId of seg.children ?? []) ids.push(childId as AnyNodeId)
      }
      return ids
    }),
  )

  const placeholderGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
    geometry.addGroup(0, 0, 0)
    geometry.addGroup(0, 0, 1)
    geometry.addGroup(0, 0, 2)
    geometry.addGroup(0, 0, 3)
    return geometry
  }, [])

  const segments = useScene(
    useShallow((state) =>
      (node.children ?? [])
        .map((id) => state.nodes[id as AnyNodeId] as RoofSegmentNode | undefined)
        .filter((seg): seg is RoofSegmentNode => Boolean(seg)),
    ),
  )

  const customMaterial = useMemo(() => getRoofMaterialArray(node, segments), [node, segments])

  const material = debugColors ? roofDebugMaterials : customMaterial || roofMaterials

  useEffect(() => {
    return () => {
      placeholderGeometry.dispose()
    }
  }, [placeholderGeometry])

  return (
    <group
      position={node.position}
      ref={ref}
      rotation-y={node.rotation}
      visible={node.visible}
      {...handlers}
    >
      <mesh
        castShadow
        geometry={placeholderGeometry}
        material={material}
        name="merged-roof"
        receiveShadow
      />
      <group name="segments-wrapper" visible={false}>
        {(node.children ?? []).map((childId) => (
          <NodeRenderer key={childId} nodeId={childId as AnyNodeId} />
        ))}
      </group>
      <group name="roof-elements">
        {roofElementIds.map((childId) => (
          <NodeRenderer key={childId} nodeId={childId} />
        ))}
      </group>
    </group>
  )
}

export default RoofRenderer
