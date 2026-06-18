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
import { getRoofDebugMaterials, getRoofMaterials } from '../roof/roof-materials'
import { createPlaceholderGeometry } from '../shared/placeholder-geometry'

export const RoofSegmentRenderer = ({ node }: { node: RoofSegmentNode }) => {
  const ref = useRef<THREE.Mesh>(null!)
  const nodes = useScene((state) => state.nodes)

  useRegistry(node.id, 'roof-segment', ref)

  const handlers = useNodeEvents(node, 'roof-segment')
  const debugColors = useViewer((s) => s.debugColors)
  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const colorPreset = useViewer((s) => s.colorPreset)
  const sceneTheme = useViewer((s) => s.sceneTheme)
  const parentNode = node.parentId
    ? (nodes[node.parentId as AnyNodeId] as RoofNode | undefined)
    : undefined
  // 4 groups map 1:1 to the roof's 4-material array (see getRoofMaterialArray).
  const placeholderGeometry = useMemo(() => createPlaceholderGeometry(4), [])

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps deliberately list the build inputs; depending on the whole object would rebuild on unrelated field changes.
  const customMaterial = useMemo(() => {
    const resolveSlot = (role: RoofSegmentSurfaceMaterialRole): THREE.Material | null => {
      const parentSpec = parentNode ? getEffectiveRoofSurfaceMaterial(parentNode, role) : undefined
      const spec = getEffectiveSegmentSurfaceMaterial(node, role, parentSpec)
      if (typeof spec.materialPreset === 'string') {
        const resolved = createMaterialFromPresetRef(spec.materialPreset, shading)
        if (resolved) return resolved
      }
      if (spec.material !== undefined) {
        return createMaterial(spec.material, shading)
      }
      return null
    }

    // Themed parent-roof array (per-role scene-theme colours) — used both as the
    // full fallback and to fill any individual untextured slot below.
    const themedArray = parentNode
      ? getRoofMaterialArray(parentNode, shading, textures, colorPreset, sceneTheme)
      : null

    const edge = resolveSlot('edge')
    const wall = resolveSlot('wall')
    const top = resolveSlot('top')

    if (!(edge || wall || top)) {
      return themedArray
    }

    // Some slots have explicit materials; fill the rest from the themed array so
    // an untextured slot still picks up the scene-theme role colour, not blank white.
    // Per-role only, then the themed parent slot — no cross-role fallback, so
    // painting one segment surface never bleeds onto its other surfaces.
    const slot = (i: number) => themedArray?.[i] ?? new THREE.MeshStandardMaterial()
    return [edge ?? slot(0), wall ?? slot(1), wall ?? slot(2), top ?? slot(3)] as THREE.Material[]
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
    shading,
    textures,
    colorPreset,
    sceneTheme,
  ])

  const material = debugColors
    ? getRoofDebugMaterials(shading)
    : customMaterial || getRoofMaterials(shading, textures, colorPreset)

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
