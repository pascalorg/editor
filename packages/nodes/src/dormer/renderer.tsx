'use client'

import {
  type AnyNodeId,
  type DormerNode,
  getEffectiveDormerSurfaceMaterial,
  type RoofSegmentNode,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { createMaterial, createMaterialFromPresetRef, useNodeEvents } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import {
  getAnalyticalNormal,
  getSurfaceY,
  surfaceQuatFromNormal,
} from '../solar-panel/geometry'
import { buildDormerGeometry } from './geometry'

const defaultWallMaterial = new THREE.MeshStandardMaterial({
  color: 0xff_ff_ff,
  roughness: 0.9,
  side: THREE.DoubleSide,
})

const defaultRoofMaterial = new THREE.MeshStandardMaterial({
  color: 0xc0_8a_6a,
  roughness: 0.85,
  side: THREE.DoubleSide,
})

/**
 * Dormer renderer — stub port. Mounts a house silhouette (box body +
 * triangular roof) on the roof surface, with the segment-aware
 * transform stack identical to solar-panel / skylight. Per-surface
 * paints (`material` / `topMaterial` / `sideMaterial` / `wallMaterial`)
 * resolve via the shared `getEffectiveDormerSurfaceMaterial` helper
 * exported from core.
 */
const DormerRenderer = ({ node }: { node: DormerNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(node.id, 'dormer', ref)
  const handlers = useNodeEvents(node, 'dormer')

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

  const geo = useMemo(() => buildDormerGeometry(node), [
    node.width,
    node.depth,
    node.height,
    node.roofHeight,
    node.roofType,
  ])

  useEffect(
    () => () => {
      geo.body.dispose()
      geo.roof.dispose()
    },
    [geo],
  )

  const wallMaterial = useMemo(() => {
    const spec = getEffectiveDormerSurfaceMaterial(node, 'wall')
    if (spec.material) return createMaterial(spec.material)
    return createMaterialFromPresetRef(spec.materialPreset) ?? defaultWallMaterial
  }, [
    node.material,
    node.materialPreset,
    node.wallMaterial,
    node.wallMaterialPreset,
    node.sideMaterial,
    node.sideMaterialPreset,
  ])

  const roofMaterial = useMemo(() => {
    const spec = getEffectiveDormerSurfaceMaterial(node, 'top')
    if (spec.material) return createMaterial(spec.material)
    return createMaterialFromPresetRef(spec.materialPreset) ?? defaultRoofMaterial
  }, [node.material, node.materialPreset, node.topMaterial, node.topMaterialPreset])

  const surfaceQuat = useMemo(() => {
    if (!segment) return new THREE.Quaternion()
    const normal = node.surfaceNormal
      ? new THREE.Vector3(...node.surfaceNormal).normalize()
      : getAnalyticalNormal(node.position[0] ?? 0, node.position[2] ?? 0, segment)
    return surfaceQuatFromNormal(normal, new THREE.Quaternion())
  }, [segment, node.surfaceNormal, node.position[0], node.position[2]])

  if (!segment || !segmentPosition) return null

  const surfaceY =
    (node.position[1] ?? 0) !== 0
      ? node.position[1]
      : getSurfaceY(node.position[0] ?? 0, node.position[2] ?? 0, segment)

  return (
    <group position={segmentPosition} ref={ref} rotation-y={segmentRotationY} visible={node.visible}>
      <group position={[node.position[0] ?? 0, surfaceY, node.position[2] ?? 0]}>
        <group quaternion={surfaceQuat}>
          <group rotation-y={node.rotation ?? 0}>
            <mesh
              castShadow
              geometry={geo.body}
              material={wallMaterial}
              name="dormer-body"
              receiveShadow
              {...handlers}
            />
            <mesh
              castShadow
              geometry={geo.roof}
              material={roofMaterial}
              name="dormer-roof"
              receiveShadow
            />
          </group>
        </group>
      </group>
    </group>
  )
}

export default DormerRenderer
