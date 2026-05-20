'use client'

import {
  type AnyNodeId,
  type RidgeVentNode,
  type RoofSegmentNode,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { createMaterial, createMaterialFromPresetRef, useNodeEvents } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { buildRidgeVentGeometry } from './geometry'

const standardMaterial = new THREE.MeshStandardMaterial({
  color: 0xff_ff_ff,
  roughness: 0.85,
  metalness: 0.1,
  side: THREE.DoubleSide,
})

const shingledMaterial = new THREE.MeshStandardMaterial({
  color: 0x55_55_55,
  roughness: 0.92,
  metalness: 0.0,
  side: THREE.DoubleSide,
})

const metalMaterial = new THREE.MeshStandardMaterial({
  color: 0xa8_a8_a8,
  roughness: 0.35,
  metalness: 0.75,
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

  const geometry = useMemo(() => buildRidgeVentGeometry(node), [
    node.length,
    node.width,
    node.height,
    node.style,
    node.endCaps,
  ])

  useEffect(() => () => geometry.dispose(), [geometry])

  const material = useMemo(() => {
    if (node.material) return createMaterial(node.material)
    const preset = createMaterialFromPresetRef(node.materialPreset)
    if (preset) return preset
    return node.style === 'metal'
      ? metalMaterial
      : node.style === 'shingled'
        ? shingledMaterial
        : standardMaterial
  }, [node.material, node.materialPreset, node.style])

  if (!segment || !segmentPosition) return null

  return (
    <group position={segmentPosition} ref={ref} rotation-y={segmentRotationY} visible={node.visible}>
      <group
        position={[node.position[0] ?? 0, node.position[1] ?? 0, node.position[2] ?? 0]}
        rotation-y={node.rotation ?? 0}
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
