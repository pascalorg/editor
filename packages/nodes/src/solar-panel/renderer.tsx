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
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import {
  buildSolarPanelGeometry,
  getAnalyticalNormal,
  getDefaultPanelMaterial,
  getSurfaceY,
  surfaceQuatFromNormal,
} from './geometry'

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
 * Solar panel renderer. Reads the parent roof-segment so the panel's
 * Y can fall back to the analytical surface height when the schema's
 * `surfaceNormal` is absent (legacy nodes / simplified placement).
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

  const surfaceQuat = useMemo(() => {
    if (!segment) return new THREE.Quaternion()
    const normal = node.surfaceNormal
      ? new THREE.Vector3(...node.surfaceNormal).normalize()
      : getAnalyticalNormal(node.position[0] ?? 0, node.position[2] ?? 0, segment)
    return surfaceQuatFromNormal(normal, new THREE.Quaternion())
  }, [segment, node.surfaceNormal, node.position[0], node.position[2]])

  if (!segment || !geometry) return null

  const surfaceY =
    (node.position[1] ?? 0) !== 0
      ? node.position[1]
      : getSurfaceY(node.position[0] ?? 0, node.position[2] ?? 0, segment)

  const tiltRad = node.mountingType === 'tilted' ? (node.tiltAngle * Math.PI) / 180 : 0

  // Roof accessories are mounted under `<group name="roof-elements">`
  // in the roof renderer — that group has NO transform, so the segment
  // frame is NOT inherited from the React tree. Apply segment.position
  // and segment.rotation here, then the panel's segment-local offset,
  // then surface quat / yaw / tilt.
  return (
    <group position={segment.position} rotation-y={segment.rotation}>
      <group
        position={[node.position[0] ?? 0, surfaceY, node.position[2] ?? 0]}
        ref={ref}
        visible={node.visible}
      >
        <group quaternion={surfaceQuat}>
          <group rotation-y={node.rotation ?? 0}>
            <group rotation-x={tiltRad}>
              <mesh
                castShadow
                geometry={geometry}
                material={[frameMaterial, panelMaterial]}
                name="solar-panel-surface"
                receiveShadow
                {...handlers}
              />
            </group>
          </group>
        </group>
      </group>
    </group>
  )
}

export default SolarPanelRenderer
