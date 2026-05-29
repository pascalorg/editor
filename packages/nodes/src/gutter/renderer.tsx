'use client'

import {
  type AnyNodeId,
  type GutterNode,
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
import { buildGutterGeometry } from './geometry'

const defaultMaterial = new THREE.MeshStandardMaterial({
  color: 0xff_ff_ff,
  roughness: 0.7,
  metalness: 0.25,
})

/**
 * Gutter renderer. Mounts at the eave of the host roof-segment — the
 * gutter hangs level off the eave line (gravity wins; no slope tilt).
 * Transform stack:
 *
 *   segment.position → segment.rotation (Y) → gutter.position
 *     → gutter.rotation (Y) → mesh
 *
 * The registered ref sits on the inner group that applies position +
 * rotation, so `NodeArrowHandles` reads gutter-mesh-local coords for
 * its chevron placements (same pattern as ridge-vent).
 *
 * `useLiveNodeOverrides` merges in-flight handle drags onto the store
 * node so the mesh tracks the drag without flushing zustand each
 * frame.
 */
const GutterRenderer = ({ node: storeNode }: { node: GutterNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(storeNode.id, 'gutter', ref)
  const handlers = useNodeEvents(storeNode, 'gutter')
  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const colorPreset: ColorPreset = useViewer((s) => s.colorPreset)
  const sceneTheme = useViewer((s) => s.sceneTheme)

  const overrides = useLiveNodeOverrides(
    (s) => s.get(storeNode.id as AnyNodeId) as Partial<GutterNode> | undefined,
  )
  const node: GutterNode = overrides
    ? ({ ...storeNode, ...overrides } as GutterNode)
    : storeNode

  const segment = useScene((state) =>
    node.roofSegmentId
      ? (state.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  const geometry = useMemo(
    () => buildGutterGeometry(node),
    [node.length, node.size, node.thickness, node.profile],
  )
  useEffect(() => () => geometry.dispose(), [geometry])

  // Paint surface: explicit material wins, then preset, then the cached
  // default. FrontSide everywhere — DoubleSide on any NodeMaterial inside
  // the MRT scenePass compiles a back-face shader variant that doesn't
  // declare outputs for every MRT target and poisons the render context
  // (see `materials.ts` line 77, and the glazing FrontSide fix in
  // 9400f1c5). The U-channel cross-section in `geometry.ts` is traced as
  // a single closed polygon around the material — both the exterior shell
  // and the interior trough walls are part of the same outward-wound
  // boundary, so ExtrudeGeometry produces outward-facing normals on every
  // visible face. FrontSide is therefore sufficient and DoubleSide is not
  // needed.
  const material = useMemo(() => {
    if (!textures || (!node.material && !node.materialPreset)) {
      return createSurfaceRoleMaterial('roof', colorPreset, THREE.FrontSide, sceneTheme)
    }
    return node.material
      ? createMaterial(node.material, shading)
      : (createMaterialFromPresetRef(node.materialPreset, shading) ?? defaultMaterial)
  }, [textures, colorPreset, sceneTheme, shading, node.material, node.materialPreset])

  if (!segment) return null

  // `node.position` is segment-local — the placement tool resolves the
  // eave click via `segObj.worldToLocal`. The renderer mounts under
  // `roof-elements` (only the roof transform inherited), so we
  // re-apply the segment's roof-local transform here. Mirrors the
  // ridge-vent / box-vent pattern; without this gutters on rotated
  // segments would land on the first segment instead.
  const segPos = segment.position ?? [0, 0, 0]
  const segRotY = segment.rotation ?? 0

  return (
    <group position={segPos} rotation-y={segRotY}>
      <group
        position={[node.position[0] ?? 0, node.position[1] ?? 0, node.position[2] ?? 0]}
        ref={ref}
        rotation-y={node.rotation ?? 0}
        visible={node.visible}
      >
        <mesh
          castShadow
          geometry={geometry}
          material={material}
          name="gutter-surface"
          receiveShadow
          {...handlers}
        />
      </group>
    </group>
  )
}

export default GutterRenderer
