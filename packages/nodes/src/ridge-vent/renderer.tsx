'use client'

import {
  type AnyNodeId,
  type RidgeVentNode,
  type RoofSegmentNode,
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
import { buildRidgeVentGeometry } from './geometry'

// Single white fallback for every style. Paint customisation comes from
// `node.material` / `node.materialPreset` (default: `preset-white`); the
// fallback only fires for legacy nodes that pre-date the schema default
// and shouldn't punish them with style-specific grey/metal that diverges
// from the "default white" the inspector advertises.
const defaultMaterial = new THREE.MeshStandardMaterial({
  color: 0xff_ff_ff,
  roughness: 0.85,
  metalness: 0.1,
  side: THREE.DoubleSide,
})

/**
 * Ridge vent renderer. Sits along the ridge of a roof-segment — no
 * slope tilt is needed (the ridge IS the high line of the segment), so
 * the transform stack is simply
 *
 *   segment.position → segment.rotation (Y) → vent.position
 *     → vent.rotation (Y) → mesh
 *
 * Mirrors the box-vent renderer otherwise (segment lookup via
 * useScene, live-transform follow for parent drags). Style-specific
 * default materials let unpainted ridge vents read as their material
 * family (matte standard / shingled grey / brushed metal) before the
 * user opens the paint tray.
 */
const RidgeVentRenderer = ({ node }: { node: RidgeVentNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(node.id, 'ridge-vent', ref)
  const handlers = useNodeEvents(node, 'ridge-vent')
  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const colorPreset: ColorPreset = useViewer((s) => s.colorPreset)
  const sceneTheme = useViewer((s) => s.sceneTheme)

  const segment = useScene((state) =>
    node.roofSegmentId
      ? (state.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  const geometry = useMemo(
    () => buildRidgeVentGeometry(node),
    [node.length, node.width, node.height, node.style, node.endCaps],
  )

  useEffect(() => () => geometry.dispose(), [geometry])

  // The preset cache returns materials with `side: FrontSide` (that's
  // what the preset payload encodes). For a thin extruded ridge cap that
  // makes the underside disappear when the camera dips below the eaves
  // — so clone the resolved material and force `DoubleSide` locally
  // without mutating the shared cache entry.
  const material = useMemo(() => {
    // Untextured ridge vent (and textures-off mode) takes the themed
    // 'roof' role colour. Request DoubleSide directly so the cached role
    // material is the right side — no clone/mutation of a shared material.
    if (!textures || (!node.material && !node.materialPreset)) {
      return createSurfaceRoleMaterial('roof', colorPreset, THREE.DoubleSide, sceneTheme)
    }
    const base = node.material
      ? createMaterial(node.material, shading)
      : (createMaterialFromPresetRef(node.materialPreset, shading) ?? defaultMaterial)
    if (base.side === THREE.DoubleSide) return base
    const cloned = base.clone()
    cloned.side = THREE.DoubleSide
    return cloned
  }, [textures, colorPreset, sceneTheme, shading, node.material, node.materialPreset])

  if (!segment) return null

  // `node.position` is segment-local (placement / move tools resolve the
  // click via `segObj.worldToLocal`), but the renderer mounts in the
  // roof's `roof-elements` group — which only carries the roof's
  // transform, not the segment's. Replicate the segment's roof-local
  // transform here so segment-local coords land at the correct world
  // point on every segment. Without this wrapper, ridge vents placed on
  // a non-origin / rotated segment (e.g. the back slope of a gable, or
  // any face of a hip) appeared on the first segment instead — the
  // "same segment" duplication bug.
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
          name="ridge-vent-surface"
          receiveShadow
          {...handlers}
        />
      </group>
    </group>
  )
}

export default RidgeVentRenderer
