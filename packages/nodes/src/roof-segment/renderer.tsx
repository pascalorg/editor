'use client'

import {
  type AnyNodeId,
  getEffectiveRoofSurfaceMaterial,
  getEffectiveSegmentSurfaceMaterial,
  type RoofNode,
  type RoofSegmentNode,
  type RoofSegmentSurfaceMaterialRole,
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

  // Segment material precedence, per-role:
  //   1. Segment's role-specific override (topMaterial, edgeMaterial, wallMaterial).
  //   2. Segment's catch-all `material` (legacy single-slot paint).
  //   3. Parent roof's role-specific material.
  //   4. Parent roof's catch-all material.
  //   5. Default `roofMaterials` (handled at the `material =` line below).
  //
  // The 4-slot layout matches getRoofMaterialArray:
  //   slot 0 → 'edge'  (wall/trim & rake bands)
  //   slot 1 → 'wall'  (deck top & shingle eave bands)
  //   slot 2 → 'wall'  (interior)
  //   slot 3 → 'top'   (shingle / roof surface)
  const customMaterial = useMemo(() => {
    const resolveSlot = (role: RoofSegmentSurfaceMaterialRole): THREE.Material | null => {
      const parentSpec = parentNode ? getEffectiveRoofSurfaceMaterial(parentNode, role) : undefined
      const spec = getEffectiveSegmentSurfaceMaterial(node, role, parentSpec)
      if (typeof spec.materialPreset === 'string') {
        const resolved = createMaterialFromPresetRef(spec.materialPreset)
        if (resolved) return resolved
      }
      if (spec.material !== undefined) {
        return createMaterial(spec.material)
      }
      return null
    }

    const edge = resolveSlot('edge')
    const wall = resolveSlot('wall')
    const top = resolveSlot('top')

    if (!(edge || wall || top)) {
      // Nothing set anywhere — fall back to the parent roof's array (which
      // applies its own per-role resolution + defaults) or to null so the
      // renderer picks the package-level `roofMaterials` defaults.
      return parentNode ? getRoofMaterialArray(parentNode) : null
    }

    const fallback = () => new THREE.MeshStandardMaterial()
    return [
      edge ?? wall ?? top ?? fallback(),
      wall ?? edge ?? top ?? fallback(),
      wall ?? edge ?? top ?? fallback(),
      top ?? wall ?? edge ?? fallback(),
    ] as THREE.Material[]
  }, [
    node.material,
    node.materialPreset,
    node.topMaterial,
    node.topMaterialPreset,
    node.edgeMaterial,
    node.edgeMaterialPreset,
    node.wallMaterial,
    node.wallMaterialPreset,
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
