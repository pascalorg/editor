'use client'

import {
  type AnyNodeId,
  hasSegmentMaterialOverride,
  type RoofNode,
  type RoofSegmentNode,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { getRoofMaterialArray, NodeRenderer, useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'
import { getRoofDebugMaterials, getRoofMaterials } from './roof-materials'

export const RoofRenderer = ({ node }: { node: RoofNode }) => {
  const ref = useRef<THREE.Group>(null!)

  useRegistry(node.id, 'roof', ref)
  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'roof')
  const debugColors = useViewer((s) => s.debugColors)
  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const colorPreset = useViewer((s) => s.colorPreset)
  const sceneTheme = useViewer((s) => s.sceneTheme)

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

  // Segments that carry their own material/preset are rendered outside the
  // segments-wrapper so they stay visible after edit mode exits — the merged
  // shell skips them (see updateMergedRoofGeometry) to avoid overdraw.
  //
  // Two separate selectors: `useShallow` walks arrays element-wise but only
  // walks the *outer* keys of a returned object, so nested arrays inside an
  // object compare by reference and trigger an infinite re-render loop.
  const paintedSegmentIds = useScene(
    useShallow((state) => {
      const ids: AnyNodeId[] = []
      for (const segmentId of node.children ?? []) {
        const seg = state.nodes[segmentId as AnyNodeId] as RoofSegmentNode | undefined
        if (!seg) continue
        if (hasSegmentMaterialOverride(seg)) ids.push(segmentId as AnyNodeId)
      }
      return ids
    }),
  )
  const unpaintedSegmentIds = useScene(
    useShallow((state) => {
      const ids: AnyNodeId[] = []
      for (const segmentId of node.children ?? []) {
        const seg = state.nodes[segmentId as AnyNodeId] as RoofSegmentNode | undefined
        if (!seg) continue
        if (!hasSegmentMaterialOverride(seg)) ids.push(segmentId as AnyNodeId)
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

  const customMaterial = useMemo(
    () => getRoofMaterialArray(node, shading, textures, colorPreset, sceneTheme),
    [node, shading, textures, colorPreset, sceneTheme],
  )

  const material = debugColors
    ? getRoofDebugMaterials(shading)
    : customMaterial || getRoofMaterials(shading, textures, colorPreset)

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
        {unpaintedSegmentIds.map((childId) => (
          <NodeRenderer key={childId} nodeId={childId} />
        ))}
      </group>
      <group name="painted-segments">
        {paintedSegmentIds.map((childId) => (
          <NodeRenderer key={childId} nodeId={childId} />
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
