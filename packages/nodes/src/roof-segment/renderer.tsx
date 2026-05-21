'use client'

import {
  type AnyNodeId,
  type RoofNode,
  type RoofSegmentNode,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import {
  createMaterial,
  createMaterialFromPresetRef,
  getRoofMaterialArray,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { roofDebugMaterials, roofMaterials } from '../roof/roof-materials'

export const RoofSegmentRenderer = ({ node }: { node: RoofSegmentNode }) => {
  const ref = useRef<THREE.Mesh>(null!)
  const nodes = useScene((state) => state.nodes)

  useRegistry(node.id, 'roof-segment', ref)

  const handlers = useNodeEvents(node, 'roof-segment')
  const debugColors = useViewer((s) => s.debugColors)
  const parentNode = node.parentId
    ? (nodes[node.parentId as AnyNodeId] as RoofNode | undefined)
    : undefined
  const placeholderGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
    geometry.addGroup(0, 0, 0)
    geometry.addGroup(0, 0, 1)
    geometry.addGroup(0, 0, 2)
    geometry.addGroup(0, 0, 3)
    return geometry
  }, [])

  // Segment material precedence:
  //   1. Segment's own preset / material (set by per-segment paint, or by
  //      whole-roof "top" paint which fans the same preset down to every
  //      child segment via `buildRoofSurfaceMaterialUpdates`).
  //   2. Parent roof's resolved 4-slot array (covers the case where only
  //      the roof's top/edge/wall presets were set, not the segment's
  //      own fields — happens for older scenes or partial paints).
  //   3. Default `roofMaterials` (handled at the `material =` line below).
  // Without (1), painting a single segment writes its preset but the
  // renderer keeps reading the parent's (unset) array → mesh stays the
  // default grey even though the segment carries the preset string.
  const customMaterial = useMemo(() => {
    if (typeof node.materialPreset === 'string') {
      const resolved = createMaterialFromPresetRef(node.materialPreset)
      if (resolved) {
        // Splat the same shingle material across all 4 slots so every
        // CSG-mapped group shows the painted preset.
        return [resolved, resolved, resolved, resolved] as THREE.Material[]
      }
    }
    if (node.material !== undefined) {
      const resolved = createMaterial(node.material)
      return [resolved, resolved, resolved, resolved] as THREE.Material[]
    }
    return parentNode ? getRoofMaterialArray(parentNode) : null
  }, [
    node.material,
    node.materialPreset,
    parentNode,
  ])

  const material = debugColors ? roofDebugMaterials : customMaterial || roofMaterials

  useEffect(() => {
    return () => {
      placeholderGeometry.dispose()
    }
  }, [placeholderGeometry])

  return (
    <mesh
      geometry={placeholderGeometry}
      material={material}
      position={node.position}
      ref={ref}
      rotation-y={node.rotation}
      visible={node.visible}
      {...handlers}
    />
  )
}

export default RoofSegmentRenderer
