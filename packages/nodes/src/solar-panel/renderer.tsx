'use client'

import {
  type AnyNodeId,
  type RoofSegmentNode,
  type SolarPanelNode,
  useLiveNodeOverrides,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import {
  type ColorPreset,
  createMaterial,
  createMaterialFromPresetRef,
  createSurfaceRoleMaterial,
  getRoofOuterSurfaceFrameAtPoint,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { surfaceQuatFromNormal } from '../shared/roof-surface'
import { useSegmentTrimClippedGeometry } from '../shared/use-segment-trim-clip'
import { buildSolarPanelGeometry, getDefaultPanelMaterial } from './geometry'

// Module-scope scratch vectors and quaternions for composing the panel's
// local orientation each render — surfaceQuat · Y(rotation) · X(tilt).
// Reused so we don't allocate four objects per frame.
const yAxis = new THREE.Vector3(0, 1, 0)
const xAxis = new THREE.Vector3(1, 0, 0)
const panelYawQuat = new THREE.Quaternion()
const panelTiltQuat = new THREE.Quaternion()

// MeshStandardNodeMaterial: WebGPU-native so it integrates correctly with
// the MRT pass (normal + roughness attachments). The legacy WebGL
// MeshStandardMaterial triggers "Color target has no corresponding fragment
// stage output / writeMask not zero" when the renderer switches pipelines
// during a segment-reparent re-render.
const defaultFrameMaterial = new MeshStandardNodeMaterial({
  color: new THREE.Color(0.6, 0.6, 0.65),
  roughness: 0.4,
  metalness: 0.8,
})

/**
 * Solar panel renderer. The panel's Y and surface tilt are derived
 * live from the parent roof-segment's finished (deck + shingle) surface
 * on every render via `getRoofOuterSurfaceFrameAtPoint` — the same
 * authoritative helper skylights use. Deriving rather than reading the
 * stored `position[1]`/`surfaceNormal` snapshot is what lets the panel
 * re-seat and re-tilt automatically when the roof's wall height or
 * pitch changes; a cached snapshot would leave it floating or buried.
 *
 * The segment's live overrides are merged too, so the panel tracks the
 * surface continuously during a wall-height/pitch drag, not just after
 * the value commits to the scene store.
 *
 * The surface orientation is applied as a quaternion on an inner
 * group computed once per render (not per frame). This matches the
 * static-transform pattern used by the other roof accessories and
 * gives up the legacy `useFrame` quaternion smoothing — segment yaw
 * changes still propagate immediately through the outer `rotation-y`
 * binding.
 */
const SolarPanelRenderer = ({ node: storeNode }: { node: SolarPanelNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(storeNode.id, 'solar-panel', ref)
  const handlers = useNodeEvents(storeNode, 'solar-panel')
  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const colorPreset: ColorPreset = useViewer((s) => s.colorPreset)
  const sceneTheme = useViewer((s) => s.sceneTheme)

  // Merge live overrides written by slider drags so the mesh updates in
  // real time before the value is committed to the scene store.
  const overrides = useLiveNodeOverrides(
    (s) => s.get(storeNode.id) as Partial<SolarPanelNode> | undefined,
  )
  const node = overrides ? ({ ...storeNode, ...overrides } as SolarPanelNode) : storeNode

  const segment = useScene((state) =>
    node.roofSegmentId
      ? (state.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  // Merge the segment's live overrides (written by wall-height / pitch
  // slider drags before they commit) so the panel re-seats and re-tilts
  // in real time as the roof changes, mirroring the gutter's eave-snap.
  const segmentOverrides = useLiveNodeOverrides((s) =>
    node.roofSegmentId
      ? (s.get(node.roofSegmentId as AnyNodeId) as Partial<RoofSegmentNode> | undefined)
      : undefined,
  )
  const effectiveSegment: RoofSegmentNode | undefined = segment
    ? segmentOverrides
      ? ({ ...segment, ...segmentOverrides } as RoofSegmentNode)
      : segment
    : undefined

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps deliberately list the build inputs; depending on the whole object would rebuild on unrelated field changes.
  const geometry = useMemo(
    () => buildSolarPanelGeometry(node),
    [
      node.rows,
      node.columns,
      node.panelWidth,
      node.panelHeight,
      node.gapX,
      node.gapY,
      node.frameThickness,
      node.frameDepth,
      node.standoffHeight,
    ],
  )

  useEffect(() => () => geometry?.dispose(), [geometry])

  // Only the structural frame/mount surface is themed (→ 'roof'). The
  // panel/cell face below is intentionally dark + product-specific and is
  // left untouched in both texture modes.
  const frameMaterial = useMemo(() => {
    if (!textures || (!node.material && !node.materialPreset)) {
      return createSurfaceRoleMaterial('roof', colorPreset, undefined, sceneTheme)
    }
    if (node.material) return createMaterial(node.material, shading)
    return createMaterialFromPresetRef(node.materialPreset, shading) ?? defaultFrameMaterial
  }, [textures, colorPreset, sceneTheme, shading, node.material, node.materialPreset])

  const panelMaterial = useMemo(() => {
    if (node.panelMaterial) return createMaterial(node.panelMaterial, shading)
    return (
      createMaterialFromPresetRef(node.panelMaterialPreset, shading) ?? getDefaultPanelMaterial()
    )
  }, [shading, node.panelMaterial, node.panelMaterialPreset])

  // Finished-surface frame (deck + shingle top) at the panel's local
  // X/Z, recomputed from the live segment each render — both the Y and
  // the tilt normal flow from here, so a wall-height or pitch change
  // re-seats and re-orients the panel automatically. `segmentOverrides`
  // is in the deps so a live drag re-derives the frame mid-drag.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps deliberately list the build inputs; depending on the whole object would rebuild on unrelated field changes.
  const surfaceFrame = useMemo(() => {
    if (!effectiveSegment) {
      return { point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0) }
    }
    return getRoofOuterSurfaceFrameAtPoint(
      effectiveSegment,
      node.position[0] ?? 0,
      node.position[2] ?? 0,
    )
  }, [segment, segmentOverrides, node.position[0], node.position[2]])

  const surfaceQuat = useMemo(
    () => surfaceQuatFromNormal(surfaceFrame.normal, new THREE.Quaternion()),
    [surfaceFrame.normal],
  )

  // Map panel-local geometry into the host segment's local frame (where the
  // trim cut prisms live). Recompose the same pose the inner mesh group is
  // mounted with (position [x, surfaceY, z] + surfaceQuat·yaw·tilt) so the clip
  // matches the rendered placement exactly. Computed before the early return so
  // the hook order stays stable.
  const localToSegment = useMemo(() => {
    const surfaceY = surfaceFrame.point.y
    const tiltRad = node.mountingType === 'tilted' ? (node.tiltAngle * Math.PI) / 180 : 0
    const quat = new THREE.Quaternion()
      .copy(surfaceQuat)
      .multiply(new THREE.Quaternion().setFromAxisAngle(yAxis, node.rotation ?? 0))
      .multiply(new THREE.Quaternion().setFromAxisAngle(xAxis, tiltRad))
    return new THREE.Matrix4().compose(
      new THREE.Vector3(node.position[0] ?? 0, surfaceY, node.position[2] ?? 0),
      quat,
      new THREE.Vector3(1, 1, 1),
    )
  }, [
    surfaceFrame.point.y,
    surfaceQuat,
    node.mountingType,
    node.tiltAngle,
    node.rotation,
    node.position[0],
    node.position[2],
  ])
  const clippedGeometry = useSegmentTrimClippedGeometry(geometry, effectiveSegment, localToSegment)

  if (!effectiveSegment || !geometry) return null

  const surfaceY = surfaceFrame.point.y

  const tiltRad = node.mountingType === 'tilted' ? (node.tiltAngle * Math.PI) / 180 : 0

  // Compose surfaceQuat · Y(rotation) · X(tilt) into a single quaternion
  // so the registered group below carries the panel's complete local pose
  // (position + orientation) as its own *local* matrix. Registry handles
  // (`portal: 'grandparent'`) read this Object3D's local position +
  // quaternion to ride the panel; splitting the rotation across nested
  // groups would leave the registered group with only the position and
  // an identity quaternion, so the arrows would land on the segment-flat
  // axes instead of on the tilted panel.
  const composedQuat = new THREE.Quaternion()
    .copy(surfaceQuat)
    .multiply(panelYawQuat.setFromAxisAngle(yAxis, node.rotation ?? 0))
    .multiply(panelTiltQuat.setFromAxisAngle(xAxis, tiltRad))

  // Roof accessories are mounted under `<group name="roof-elements">`
  // in the roof renderer — that group has NO transform, so the segment
  // frame is NOT inherited from the React tree. Apply segment.position
  // and segment.rotation here, then the panel's segment-local offset +
  // composed orientation on a single registered group.
  return (
    <group position={effectiveSegment.position} rotation-y={effectiveSegment.rotation}>
      <group
        position={[node.position[0] ?? 0, surfaceY, node.position[2] ?? 0]}
        quaternion={composedQuat}
        ref={ref}
        visible={node.visible}
      >
        <mesh
          castShadow
          geometry={clippedGeometry ?? geometry}
          material={[frameMaterial, panelMaterial]}
          name="solar-panel-surface"
          receiveShadow
          {...handlers}
        />
      </group>
    </group>
  )
}

export default SolarPanelRenderer
