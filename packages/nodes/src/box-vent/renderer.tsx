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
import { getAnalyticalNormal, surfaceQuatFromNormal } from '../shared/roof-surface'
import { useSegmentTrimClippedGeometry } from '../shared/use-segment-trim-clip'
import { buildBoxVentGeometry } from './geometry'

const defaultMaterial = new THREE.MeshStandardMaterial({
  color: 0xff_ff_ff,
  roughness: 0.85,
  metalness: 0.1,
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps deliberately list the build inputs; depending on the whole object would rebuild on unrelated field changes.
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
  // default. FrontSide everywhere — DoubleSide on the role material's
  // NodeMaterial poisons the MRT scene pass (see `materials.ts` line 77 /
  // glazing fix 9400f1c5). Earlier this path forced DoubleSide so back
  // faces of the vent body / hood wouldn't drop out when looking up at the
  // eaves; that's now a known visual tradeoff — a closed-solid extrude in
  // `geometry.ts` is the right fix if undersides become noticeable.
  const material = useMemo(() => {
    if (!textures || (!node.material && !node.materialPreset)) {
      return createSurfaceRoleMaterial('roof', colorPreset, THREE.FrontSide, sceneTheme)
    }
    return node.material
      ? createMaterial(node.material, shading)
      : (createMaterialFromPresetRef(node.materialPreset, shading) ?? defaultMaterial)
  }, [textures, colorPreset, sceneTheme, shading, node.material, node.materialPreset])

  // Compose slope tilt + yaw onto a single quaternion so the registered
  // ref's local frame is vent-mesh-local. `NodeArrowHandles` reads this
  // frame to place its chevrons; collapsing the nested-group stack onto
  // the registered group lets handles use vent-local coords directly,
  // without per-arrow tilt compensation. Mirrors solar-panel's renderer.
  const yAxis = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const composedQuat = useMemo(() => {
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(yAxis, node.rotation ?? 0)
    return new THREE.Quaternion().copy(surfaceQuat).multiply(yawQuat)
  }, [surfaceQuat, node.rotation, yAxis])

  // Map vent-local geometry into the host segment's local frame (the frame the
  // trim cut prisms live in) — same pose the inner mesh group is mounted with.
  const localToSegment = useMemo(
    () =>
      new THREE.Matrix4().compose(
        new THREE.Vector3(node.position[0] ?? 0, node.position[1] ?? 0, node.position[2] ?? 0),
        composedQuat,
        new THREE.Vector3(1, 1, 1),
      ),
    [node.position[0], node.position[1], node.position[2], composedQuat],
  )
  const clippedGeometry = useSegmentTrimClippedGeometry(geometry, segment, localToSegment)

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
        quaternion={composedQuat}
        ref={ref}
        visible={node.visible}
      >
        <mesh
          castShadow
          geometry={clippedGeometry ?? geometry}
          material={material}
          name="box-vent-surface"
          receiveShadow
          {...handlers}
        />
      </group>
    </group>
  )
}

export default BoxVentRenderer
