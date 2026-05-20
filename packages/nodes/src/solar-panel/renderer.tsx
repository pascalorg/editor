'use client'

import {
  type AnyNodeId,
  type RoofSegmentNode,
  type SolarPanelNode,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { createMaterial, createMaterialFromPresetRef, useNodeEvents } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import {
  buildSolarPanelGeometry,
  getAnalyticalNormal,
  getSurfaceY,
  surfaceQuatFromNormal,
} from './geometry'

const defaultFrameMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color(0.6, 0.6, 0.65),
  roughness: 0.4,
  metalness: 0.8,
})

const defaultPanelMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color(0.05, 0.05, 0.12),
  roughness: 0.18,
  metalness: 0.35,
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
const SolarPanelRenderer = ({ node }: { node: SolarPanelNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(node.id, 'solar-panel', ref)
  const handlers = useNodeEvents(node, 'solar-panel')

  const segment = useScene((state) =>
    node.roofSegmentId
      ? (state.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )
  const segmentLiveTransform = useLiveTransforms((state) =>
    node.roofSegmentId ? state.get(node.roofSegmentId as AnyNodeId) : undefined,
  )

  const segmentPosition = segmentLiveTransform?.position ?? segment?.position
  const segmentRotationY = segmentLiveTransform?.rotation ?? segment?.rotation ?? 0

  const geometry = useMemo(() => buildSolarPanelGeometry(node), [
    node.rows,
    node.columns,
    node.panelWidth,
    node.panelHeight,
    node.gapX,
    node.gapY,
    node.frameThickness,
    node.frameDepth,
    node.standoffHeight,
  ])

  useEffect(() => () => geometry?.dispose(), [geometry])

  const frameMaterial = useMemo(() => {
    if (node.material) return createMaterial(node.material)
    return createMaterialFromPresetRef(node.materialPreset) ?? defaultFrameMaterial
  }, [node.material, node.materialPreset])

  const panelMaterial = useMemo(() => {
    if (node.panelMaterial) return createMaterial(node.panelMaterial)
    return createMaterialFromPresetRef(node.panelMaterialPreset) ?? defaultPanelMaterial
  }, [node.panelMaterial, node.panelMaterialPreset])

  const surfaceQuat = useMemo(() => {
    if (!segment) return new THREE.Quaternion()
    const normal = node.surfaceNormal
      ? new THREE.Vector3(...node.surfaceNormal).normalize()
      : getAnalyticalNormal(node.position[0] ?? 0, node.position[2] ?? 0, segment)
    return surfaceQuatFromNormal(normal, new THREE.Quaternion())
  }, [segment, node.surfaceNormal, node.position[0], node.position[2]])

  if (!segment || !segmentPosition || !geometry) return null

  const surfaceY =
    (node.position[1] ?? 0) !== 0
      ? node.position[1]
      : getSurfaceY(node.position[0] ?? 0, node.position[2] ?? 0, segment)

  const tiltRad =
    node.mountingType === 'tilted' ? (node.tiltAngle * Math.PI) / 180 : 0

  return (
    <group position={segmentPosition} ref={ref} rotation-y={segmentRotationY} visible={node.visible}>
      <group position={[node.position[0] ?? 0, surfaceY, node.position[2] ?? 0]}>
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
