'use client'

import {
  type AnyNodeId,
  type RoofSegmentNode,
  type SkylightNode,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { createMaterial, createMaterialFromPresetRef, useNodeEvents } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import {
  buildSkylightGeometry,
  getAnalyticalNormal,
  getSurfaceY,
} from './geometry'
import { surfaceQuatFromNormal } from '../solar-panel/geometry'

const defaultFrameMaterial = new THREE.MeshStandardMaterial({
  color: 0xff_ff_ff,
  roughness: 0.3,
  metalness: 0.5,
})

const defaultGlassMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xdf_f7_ff,
  roughness: 0.05,
  metalness: 0,
  transparent: true,
  opacity: 0.35,
  transmission: 0.9,
  ior: 1.5,
  thickness: 0.018,
  side: THREE.DoubleSide,
})

/**
 * Skylight renderer — stub port. Mounts the frame + glass on the
 * roof surface with the segment-aware position/orientation stack
 * identical to solar-panel. Animation (operationState driving the
 * glass tilt or slide) is NOT applied in this port — see the
 * geometry file's note.
 */
const SkylightRenderer = ({ node }: { node: SkylightNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(node.id, 'skylight', ref)
  const handlers = useNodeEvents(node, 'skylight')

  const segment = useScene((state) =>
    node.roofSegmentId
      ? (state.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  const geo = useMemo(() => buildSkylightGeometry(node), [
    node.width,
    node.height,
    node.frameThickness,
    node.frameDepth,
    node.glassThickness,
    node.curb,
    node.curbHeight,
  ])

  useEffect(
    () => () => {
      geo.frame.dispose()
      geo.glass.dispose()
    },
    [geo],
  )

  const frameMaterial = useMemo(() => {
    if (node.material) return createMaterial(node.material)
    return createMaterialFromPresetRef(node.materialPreset) ?? defaultFrameMaterial
  }, [node.material, node.materialPreset])

  const glassMaterial = useMemo(() => {
    if (node.glassMaterial) return createMaterial(node.glassMaterial)
    return createMaterialFromPresetRef(node.glassMaterialPreset) ?? defaultGlassMaterial
  }, [node.glassMaterial, node.glassMaterialPreset])

  const surfaceQuat = useMemo(() => {
    if (!segment) return new THREE.Quaternion()
    const normal = node.surfaceNormal
      ? new THREE.Vector3(...node.surfaceNormal).normalize()
      : getAnalyticalNormal(node.position[0] ?? 0, node.position[2] ?? 0, segment)
    return surfaceQuatFromNormal(normal, new THREE.Quaternion())
  }, [segment, node.surfaceNormal, node.position[0], node.position[2]])

  if (!segment) return null

  const surfaceY =
    (node.position[1] ?? 0) !== 0
      ? node.position[1]
      : getSurfaceY(node.position[0] ?? 0, node.position[2] ?? 0, segment)

  return (
    <group
      position={[node.position[0] ?? 0, surfaceY, node.position[2] ?? 0]}
      ref={ref}
      visible={node.visible}
    >
      <group quaternion={surfaceQuat}>
        <group rotation-y={node.rotation ?? 0}>
          <mesh
            castShadow
            geometry={geo.frame}
            material={frameMaterial}
            name="skylight-frame"
            receiveShadow
            {...handlers}
          />
          <mesh
            geometry={geo.glass}
            material={glassMaterial}
            name="skylight-glass"
            receiveShadow
          />
        </group>
      </group>
    </group>
  )
}

export default SkylightRenderer
