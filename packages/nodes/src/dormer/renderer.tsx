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
  type ColorPreset,
  createMaterial,
  createMaterialFromPresetRef,
  createSurfaceRoleMaterial,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useSegmentTrimClippedGeometry } from '../shared/use-segment-trim-clip'
import {
  buildDormerFallbackGeometry,
  DORMER_GABLE_MATERIAL_INDEX,
  generateDormerGeometry,
} from './csg-geometry'
import DormerWindowAssembly from './window-assembly'

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
    () => (liveOverrides ? ({ ...storeNode, ...liveOverrides } as DormerNode) : storeNode),
    [storeNode, liveOverrides],
  )

  const segment = useScene((state) =>
    node.roofSegmentId
      ? (state.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const colorPreset: ColorPreset = useViewer((s) => s.colorPreset)
  const sceneTheme = useViewer((s) => s.sceneTheme)

  // Geometry material slots: 0=Wall, 1=Deck/side, 2=Interior, 3=Roof
  // shingle, 4=Gable wall. Walls take the 'wall' role, the deck side and
  // shingle take 'roof'. When textures are off, every slot snaps to its
  // role colour regardless of explicit paint (the render-modes invariant).
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps deliberately list the build inputs; depending on the whole object would rebuild on unrelated field changes.
  const material = useMemo(() => {
    const wallRole = () => createSurfaceRoleMaterial('wall', colorPreset, undefined, sceneTheme)
    const roofRole = () => createSurfaceRoleMaterial('roof', colorPreset, undefined, sceneTheme)

    const top = getEffectiveDormerSurfaceMaterial(node, 'top')
    const side = getEffectiveDormerSurfaceMaterial(node, 'side')
    const wall = getEffectiveDormerSurfaceMaterial(node, 'wall')

    const resolve = (
      spec: { material?: DormerNode['material']; materialPreset?: string },
      role: () => THREE.Material,
    ) => {
      if (!textures) return role()
      if (spec.materialPreset)
        return createMaterialFromPresetRef(spec.materialPreset, shading) ?? role()
      if (spec.material) return createMaterial(spec.material, shading)
      return role()
    }

    const w = resolve(wall, wallRole)
    const s = resolve(side, roofRole)
    const t = resolve(top, roofRole)
    return [w, s, w, t, w] as THREE.Material[]
  }, [
    textures,
    colorPreset,
    sceneTheme,
    shading,
    node.material,
    node.materialPreset,
    node.topMaterial,
    node.topMaterialPreset,
    node.sideMaterial,
    node.sideMaterialPreset,
    node.wallMaterial,
    node.wallMaterialPreset,
  ])

  // The window frame bars / sill take the 'joinery' role when untextured;
  // otherwise the deck-side material (slot 1) drives the frame look.
  const frameSideMat = useMemo(() => {
    if (!textures) return createSurfaceRoleMaterial('joinery', colorPreset, undefined, sceneTheme)
    return material[1]!
  }, [textures, colorPreset, sceneTheme, material])

  // Dormer window glass has no per-node material — it always takes the
  // themed 'glazing' role (semi-transparent) in both texture modes.
  const glassMat = useMemo(
    () => createSurfaceRoleMaterial('glazing', colorPreset, undefined, sceneTheme),
    [colorPreset, sceneTheme],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps deliberately list the build inputs; depending on the whole object would rebuild on unrelated field changes.
  const geometry = useMemo(() => {
    if (!segment) return null
    if (isLiveDrag) return buildDormerFallbackGeometry(node)
    return generateDormerGeometry(node, segment)
  }, [
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
  ])

  useEffect(() => () => geometry?.dispose(), [geometry])

  // Map dormer-local geometry into the host segment's local frame (where the
  // trim cut prisms live) — same pose the inner mesh group is mounted with.
  const localToSegment = useMemo(
    () =>
      new THREE.Matrix4().compose(
        new THREE.Vector3(node.position[0] ?? 0, node.position[1] ?? 0, node.position[2] ?? 0),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), node.rotation ?? 0),
        new THREE.Vector3(1, 1, 1),
      ),
    [node.position[0], node.position[1], node.position[2], node.rotation],
  )
  const clippedGeometry = useSegmentTrimClippedGeometry(geometry, segment, localToSegment)

  if (!(segment && geometry)) return null

  // Dormers are mounted inside `RoofRenderer`'s `roof-elements` group
  // (at the roof origin — NOT inside the host segment's transform), so
  // we apply the segment's own position + rotation here. Mirrors how
  // chimney / skylight render. The CSG geometry is built in
  // dormer-mesh-local with `dormer.position` + `dormer.rotation`
  // already accounted for by `segToMesh`, so we layer them as group
  // transforms here too.
  //
  // The registered ref sits on the inner group that applies the
  // dormer's own position + rotation so the registered Object3D's
  // local frame is *dormer-local* — that's what `NodeArrowHandles`
  // reads to place its chevrons. Mirrors chimney's structure.
  return (
    <group
      position={segment.position}
      rotation-y={segment.rotation ?? 0}
      visible={node.visible}
      {...handlers}
    >
      <group
        position={[node.position[0] ?? 0, node.position[1] ?? 0, node.position[2] ?? 0]}
        ref={ref}
        rotation-y={node.rotation ?? 0}
      >
        <mesh
          castShadow
          geometry={clippedGeometry ?? geometry}
          material={material}
          name="dormer-body"
          receiveShadow
        />
        <DormerWindowAssembly
          dormerToSegment={localToSegment}
          frameMaterial={frameSideMat}
          glassMaterial={glassMat}
          node={node}
          segment={segment}
        />
      </group>
    </group>
  )
}

// Re-export so consumers (e.g. tests) can reach the gable slot index
// without importing from `@pascal-app/viewer` directly.
export { DORMER_GABLE_MATERIAL_INDEX }

export default DormerRenderer
