'use client'

import {
  type AnyNodeId,
  type RidgeVentNode,
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
import { getSurfaceY } from '../shared/roof-surface'
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
const RidgeVentRenderer = ({ node: storeNode }: { node: RidgeVentNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(storeNode.id, 'ridge-vent', ref)
  const handlers = useNodeEvents(storeNode, 'ridge-vent')
  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const colorPreset: ColorPreset = useViewer((s) => s.colorPreset)
  const sceneTheme = useViewer((s) => s.sceneTheme)

  // Merge live drag overrides on top of the store node so handle drags
  // update the mesh in-flight without flushing to zustand on every frame.
  // Same pattern as box-vent / chimney / dormer — the override is set by
  // `NodeArrowHandles`' drag handler and cleared on commit.
  const overrides = useLiveNodeOverrides(
    (s) => s.get(storeNode.id as AnyNodeId) as Partial<RidgeVentNode> | undefined,
  )
  const node: RidgeVentNode = overrides
    ? ({ ...storeNode, ...overrides } as RidgeVentNode)
    : storeNode

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

  // Paint surface: FrontSide everywhere — DoubleSide on the role
  // material's NodeMaterial poisons the MRT scene pass (see `materials.ts`
  // line 77 / glazing fix 9400f1c5). Earlier this path forced DoubleSide
  // so the underside of the thin extruded ridge cap stayed visible from
  // below; that's now a known visual tradeoff — building the cap as a
  // closed solid in `geometry.ts` is the right fix if the underside-view
  // becomes noticeable.
  const material = useMemo(() => {
    if (!textures || (!node.material && !node.materialPreset)) {
      return createSurfaceRoleMaterial('roof', colorPreset, THREE.FrontSide, sceneTheme)
    }
    return node.material
      ? createMaterial(node.material, shading)
      : (createMaterialFromPresetRef(node.materialPreset, shading) ?? defaultMaterial)
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

  // Seat the vent on the ridge by DERIVING its Y from the segment's current
  // surface rather than the stored `position[1]`. The ridge height comes from
  // the segment's pitch (`getActiveRoofHeight`), so when the roof is lowered
  // the segment updates, this renderer re-runs, and the vent rides the ridge
  // down automatically — no stale floating cap. X/Z stay as authored (the vent
  // straddles the ridge line at localZ≈0).
  const ridgeY = getSurfaceY(node.position[0] ?? 0, node.position[2] ?? 0, segment)

  return (
    <group position={segPos} rotation-y={segRotY}>
      <group
        position={[node.position[0] ?? 0, ridgeY, node.position[2] ?? 0]}
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
