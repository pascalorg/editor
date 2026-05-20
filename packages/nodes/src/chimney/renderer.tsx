'use client'

import {
  type AnyNodeId,
  type ChimneyNode,
  type RoofSegmentNode,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { createMaterial, createMaterialFromPresetRef, useNodeEvents } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { buildChimneyGeometry } from './geometry'

const bodyMaterial = new THREE.MeshStandardMaterial({
  color: 0xb8_88_72,
  roughness: 0.85,
  metalness: 0,
})

const topMaterial = new THREE.MeshStandardMaterial({
  color: 0xa0_a0_a0,
  roughness: 0.75,
  metalness: 0,
})

/**
 * Chimney renderer. Reads the parent roof-segment so the body height
 * is derived from `segment.wallHeight + roofHeight + node.heightAboveRidge`.
 *
 * **Option C scope**: chimney is rendered as solid geometry that
 * intersects the roof at the deck line. The decorative CSG-driven
 * features (cap flue holes, body cavity, panels, bands) are not
 * rendered in this port — they remain as no-op fields in the schema
 * until the roof-segment Stage B migration introduces a `roofCutout`
 * capability the parent can read.
 */
const ChimneyRenderer = ({ node }: { node: ChimneyNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(node.id, 'chimney', ref)
  const handlers = useNodeEvents(node, 'chimney')

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

  const geo = useMemo(() => {
    if (!segment) return null
    return buildChimneyGeometry(node, segment)
  }, [
    segment?.wallHeight,
    segment?.roofHeight,
    segment?.roofType,
    node.width,
    node.depth,
    node.heightAboveRidge,
    node.bodyShape,
    node.shoulderStyle,
    node.shoulderHeight,
    node.shoulderExtent,
    node.cap,
    node.capShape,
    node.capOverhang,
    node.capThickness,
    node.flueCount,
    node.flueShape,
    node.flueHeight,
    node.flueDiameter,
    node.flueSpacing,
    node.cricketStyle,
    node.cricketSide,
    node.cricketLength,
    node.cricketHeight,
    node.position[0],
    node.position[2],
    node.rotation,
  ])

  useEffect(
    () => () => {
      if (geo) {
        geo.body.dispose()
        geo.cap?.dispose()
        geo.flues?.dispose()
        geo.cricket?.dispose()
      }
    },
    [geo],
  )

  const surfaceMaterial = useMemo(() => {
    if (node.material) return createMaterial(node.material)
    const preset = createMaterialFromPresetRef(node.materialPreset)
    return preset ?? bodyMaterial
  }, [node.material, node.materialPreset])

  const capSurfaceMaterial = useMemo(() => {
    if (node.topMaterial) return createMaterial(node.topMaterial)
    const preset = createMaterialFromPresetRef(node.topMaterialPreset)
    if (preset) return preset
    if (node.material) return createMaterial(node.material)
    const bodyPreset = createMaterialFromPresetRef(node.materialPreset)
    return bodyPreset ?? topMaterial
  }, [node.topMaterial, node.topMaterialPreset, node.material, node.materialPreset])

  if (!segment || !segmentPosition || !geo) return null

  return (
    <group position={segmentPosition} ref={ref} rotation-y={segmentRotationY} visible={node.visible}>
      <mesh
        castShadow
        geometry={geo.body}
        material={surfaceMaterial}
        name="chimney-body"
        receiveShadow
        {...handlers}
      />
      {geo.cap && (
        <mesh
          castShadow
          geometry={geo.cap}
          material={capSurfaceMaterial}
          name="chimney-cap"
          receiveShadow
        />
      )}
      {geo.flues && (
        <mesh
          castShadow
          geometry={geo.flues}
          material={surfaceMaterial}
          name="chimney-flues"
          receiveShadow
        />
      )}
      {geo.cricket && (
        <mesh
          castShadow
          geometry={geo.cricket}
          material={surfaceMaterial}
          name="chimney-cricket"
          receiveShadow
        />
      )}
    </group>
  )
}

export default ChimneyRenderer
