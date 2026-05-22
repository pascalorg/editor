'use client'

import {
  type AnyNodeId,
  type DormerNode,
  getEffectiveDormerSurfaceMaterial,
  type RoofSegmentNode,
  useLiveNodeOverrides,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import {
  createMaterial,
  createMaterialFromPresetRef,
  useNodeEvents,
} from '@pascal-app/viewer'
import {
  buildDormerFallbackGeometry,
  DORMER_GABLE_MATERIAL_INDEX,
  generateDormerGeometry,
} from './csg-geometry'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import DormerWindowAssembly from './window-assembly'

// Three distinct default materials: wall, side, roof top.
// All three use FrontSide — chimney / skylight do the same, and
// DoubleSide on a MeshStandardMaterial inside the MRT scene pass
// generates a WebGPU pipeline whose fragment stage doesn't always
// declare an output for every MRT target, which the validator rejects
// with "target has no corresponding fragment stage output but
// writeMask is not zero".
const defaultWallMat = new THREE.MeshStandardMaterial({
  color: 0xff_ff_ff,
  roughness: 0.9,
  side: THREE.FrontSide,
})
const defaultSideMat = new THREE.MeshStandardMaterial({
  color: 0xff_ff_ff,
  roughness: 0.9,
  side: THREE.FrontSide,
})
const defaultRoofMat = new THREE.MeshStandardMaterial({
  color: 0xff_ff_ff,
  roughness: 0.85,
  side: THREE.FrontSide,
})

// Geometry slots produced by `generateDormerGeometry`:
//   0 = Wall          → wall material
//   1 = Deck (side)   → side material
//   2 = Interior      → wall material
//   3 = Roof shingle  → roof material
//   4 = Gable wall    → wall material  (DORMER_GABLE_MATERIAL_INDEX)
const defaultDormerMaterials: THREE.Material[] = [
  defaultWallMat,
  defaultSideMat,
  defaultWallMat,
  defaultRoofMat,
  defaultWallMat,
]

const DormerRenderer = ({ node: storeNode }: { node: DormerNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(storeNode.id, 'dormer', ref)
  const handlers = useNodeEvents(storeNode, 'dormer')

  // Live overrides so slider drag updates the dormer without committing
  // to the store. While any override is live we render the cheap
  // fallback silhouette — running the full CSG on every pointer move is
  // far too expensive (multiple boolean ops + ground subtract +
  // 32-segment arch curves). Commit clears the override and the real
  // CSG mesh kicks back in.
  const liveOverrides = useLiveNodeOverrides((state) => state.get(storeNode.id as AnyNodeId))
  const isLiveDrag = !!liveOverrides && Object.keys(liveOverrides).length > 0
  const node = useMemo(
    () =>
      liveOverrides ? ({ ...storeNode, ...liveOverrides } as DormerNode) : storeNode,
    [storeNode, liveOverrides],
  )

  const segment = useScene((state) =>
    node.roofSegmentId
      ? (state.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  const resolvedMaterials = useMemo(() => {
    const top = getEffectiveDormerSurfaceMaterial(node, 'top')
    const side = getEffectiveDormerSurfaceMaterial(node, 'side')
    const wall = getEffectiveDormerSurfaceMaterial(node, 'wall')

    const resolve = (spec: { material?: DormerNode['material']; materialPreset?: string }) => {
      if (spec.materialPreset) return createMaterialFromPresetRef(spec.materialPreset)
      if (spec.material) return createMaterial(spec.material)
      return null
    }

    const topMat = resolve(top)
    const sideMat = resolve(side)
    const wallMat = resolve(wall)

    if (!(topMat || sideMat || wallMat)) return null

    const w = wallMat ?? defaultWallMat
    const s = sideMat ?? defaultSideMat
    const t = topMat ?? defaultRoofMat
    return [w, s, w, t, w] as THREE.Material[]
  }, [
    node.material,
    node.materialPreset,
    node.topMaterial,
    node.topMaterialPreset,
    node.sideMaterial,
    node.sideMaterialPreset,
    node.wallMaterial,
    node.wallMaterialPreset,
  ])

  const material = resolvedMaterials ?? defaultDormerMaterials
  const frameSideMat = resolvedMaterials ? resolvedMaterials[1]! : defaultSideMat

  const geometry = useMemo(
    () => {
      if (!segment) return null
      if (isLiveDrag) return buildDormerFallbackGeometry(node)
      return generateDormerGeometry(node, segment)
    },
    [
      isLiveDrag,
      segment,
      node.id,
      node.roofType,
      node.width,
      node.depth,
      node.height,
      node.roofHeight,
      node.wallSkirtHeight,
      node.position[0],
      node.position[1],
      node.position[2],
      node.rotation,
      node.windowWidth,
      node.windowHeight,
      node.windowOffsetX,
      node.windowOffsetY,
      node.windowShape,
      node.windowArchHeight,
      node.windowCornerRadii[0],
      node.windowCornerRadii[1],
      node.windowCornerRadii[2],
      node.windowCornerRadii[3],
    ],
  )

  useEffect(() => () => geometry?.dispose(), [geometry])

  if (!(segment && geometry)) return null

  // Dormers are mounted inside `RoofRenderer`'s `roof-elements` group
  // (at the roof origin — NOT inside the host segment's transform), so
  // we apply the segment's own position + rotation here. Mirrors how
  // chimney / skylight render. The CSG geometry is built in
  // dormer-mesh-local with `dormer.position` + `dormer.rotation`
  // already accounted for by `segToMesh`, so we layer them as group
  // transforms here too.
  return (
    <group
      position={segment.position}
      ref={ref}
      rotation-y={segment.rotation ?? 0}
      visible={node.visible}
    >
      <group
        position={[node.position[0] ?? 0, node.position[1] ?? 0, node.position[2] ?? 0]}
      >
        <group rotation-y={node.rotation ?? 0} {...handlers}>
          <mesh
            castShadow
            geometry={geometry}
            material={material}
            name="dormer-body"
            receiveShadow
          />
          <DormerWindowAssembly
            frameMaterial={frameSideMat}
            node={node}
            segment={segment}
          />
        </group>
      </group>
    </group>
  )
}

// Re-export so consumers (e.g. tests) can reach the gable slot index
// without importing from `@pascal-app/viewer` directly.
export { DORMER_GABLE_MATERIAL_INDEX }

export default DormerRenderer
