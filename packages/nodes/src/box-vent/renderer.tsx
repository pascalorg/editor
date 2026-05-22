'use client'

import {
  type AnyNodeId,
  type BoxVentNode,
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
import { getAnalyticalNormal, surfaceQuatFromNormal } from '../solar-panel/geometry'
import { buildBoxVentGeometry } from './geometry'

const defaultMaterial = new THREE.MeshStandardMaterial({
  color: 0xff_ff_ff,
  roughness: 0.85,
  metalness: 0.1,
  side: THREE.DoubleSide,
})

/**
 * Box vent renderer. The vent is parented to a roof-segment in the scene
 * graph, but the registry-era roof-segment renderer doesn't auto-nest
 * children (it's a single mesh with placeholder geometry filled by
 * `RoofSystem`). So this renderer reads the parent segment directly and
 * reproduces the segment-local transform stack manually:
 *
 *   segment.position → segment.rotation (Y) → vent.position
 *     → slope tilt (X) → vent.rotation (Y) → mesh
 *
 * The slope tilt is derived from the segment's roof shape and the vent's
 * local Z — see `computeBoxVentSlopeTilt`. The +Z side of the segment is
 * the down-slope direction, so a positive Z lands on the lower half of
 * the pitch.
 *
 * Live segment drags are honoured by subscribing to `useLiveTransforms`
 * for the parent segment ID — during the segment's move, the override
 * carries the in-progress position/rotation and the vent follows
 * smoothly without waiting for a commit.
 */
const BoxVentRenderer = ({ node: storeNode }: { node: BoxVentNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(storeNode.id, 'box-vent', ref)
  const handlers = useNodeEvents(storeNode, 'box-vent')
  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const colorPreset: ColorPreset = useViewer((s) => s.colorPreset)
  const sceneTheme = useViewer((s) => s.sceneTheme)

  // Merge live overrides (panel slider drags) on top of the store node.
  // Sliders write here on every `onChange` and only flush to the scene
  // store on `onCommit`, so the mesh updates frame-by-frame without
  // polluting undo history or triggering a full store-driven re-render.
  const overrides = useLiveNodeOverrides(
    (s) => s.get(storeNode.id as AnyNodeId) as Partial<BoxVentNode> | undefined,
  )
  const node: BoxVentNode = overrides ? ({ ...storeNode, ...overrides } as BoxVentNode) : storeNode

  const segment = useScene((state) =>
    node.roofSegmentId
      ? (state.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  // Rebuild geometry whenever any shape-bearing field changes — that's
  // every parametric field, including the per-style ones. Listing them
  // explicitly keeps the dep array tight (vs. `[node]` which would
  // also fire on `name` / `visible` flips).
  const geometry = useMemo(
    () => buildBoxVentGeometry(node),
    [
      node.style,
      node.width,
      node.depth,
      node.height,
      node.hoodOverhang,
      node.topTaper,
      node.capHeight,
      node.capGap,
      node.domeCurvature,
      node.baseInset,
      node.baseHeight,
      node.cornerBevel,
    ],
  )

  useEffect(() => () => geometry.dispose(), [geometry])

  // Orient the vent to whatever roof face it sits on. The analytical
  // normal (shared with solar-panel + skylight) handles every roof type
  // — gable, shed, hip front, hip side — instead of the previous
  // X-tilt-from-Z-sign trick, which only worked on slopes whose dip
  // ran along segment-local Z.
  const surfaceQuat = useMemo(() => {
    if (!segment) return new THREE.Quaternion()
    const normal = getAnalyticalNormal(node.position[0] ?? 0, node.position[2] ?? 0, segment)
    return surfaceQuatFromNormal(normal, new THREE.Quaternion())
  }, [segment, node.position[0], node.position[2]])

  // Paint surface: explicit material wins, then preset, then the cached
  // default. Mirrors the slab / stair / wall pattern. Preset materials
  // come from the shared cache with `side: FrontSide`; clone + force
  // DoubleSide locally so back faces of the vent body / hood don't drop
  // out when the camera looks up at the eaves.
  const material = useMemo(() => {
    // Untextured box vent (and textures-off mode) takes the themed 'roof'
    // role colour. Request DoubleSide directly so the cached role material
    // is the right side — no clone/mutation of a shared material.
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

  // `node.position` is segment-local (the placement + move tools resolve
  // the click via `segObj.worldToLocal`). The vent is mounted in the
  // roof's `roof-elements` group, which carries only the roof transform
  // — so we replicate the segment's roof-local transform here to bridge
  // the two frames. Without this, segment-local coords would be rendered
  // *as if* they were roof-local; on gable / hip roofs (where every
  // segment shares the roof origin but differs by Y rotation), the vent
  // would land rotated away from the click — the "slight shift" between
  // ghost and committed mesh.
  const segPos = segment.position ?? [0, 0, 0]
  const segRotY = segment.rotation ?? 0

  return (
    <group position={segPos} rotation-y={segRotY}>
      <group
        position={[node.position[0] ?? 0, node.position[1] ?? 0, node.position[2] ?? 0]}
        ref={ref}
        visible={node.visible}
      >
        <group quaternion={surfaceQuat}>
          <group rotation-y={node.rotation ?? 0}>
            <mesh
              castShadow
              geometry={geometry}
              material={material}
              name="box-vent-surface"
              receiveShadow
              {...handlers}
            />
          </group>
        </group>
      </group>
    </group>
  )
}

export default BoxVentRenderer
