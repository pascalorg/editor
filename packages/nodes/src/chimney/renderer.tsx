'use client'

import {
  type AnyNodeId,
  type ChimneyNode,
  type RoofSegmentNode,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { createMaterial, createMaterialFromPresetRef, useNodeEvents } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { buildChimneyGeometry } from './geometry'
import { trimChimneyBodyAgainstRoof } from './roof-trim'

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

  // CSG-trim the body against the parent roof segment so the portion
  // passing through the wall and shingles is hidden. Runs once per
  // chimney/segment shape change. Returns the original body geometry
  // on any CSG failure (logged via console.error).
  const trimmedBody = useMemo(() => {
    if (!geo || !segment) return null
    return trimChimneyBodyAgainstRoof(geo.body, segment, node)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    geo,
    segment?.width,
    segment?.depth,
    segment?.wallHeight,
    segment?.roofHeight,
    segment?.roofType,
    segment?.wallThickness,
    segment?.deckThickness,
    segment?.overhang,
    segment?.shingleThickness,
  ])

  useEffect(
    () => () => {
      if (geo) {
        // The body may have been replaced by the trimmed version —
        // `trimChimneyBodyAgainstRoof` disposes the original on
        // success. Dispose `trimmedBody` if present, else the
        // original body.
        ;(trimmedBody ?? geo.body).dispose()
        geo.cap?.dispose()
        geo.flues?.dispose()
        geo.cricket?.dispose()
      }
    },
    [geo, trimmedBody],
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

  if (!segment || !geo) return null

  // The chimney's geometry bakes its baseY using segment.wallHeight inside
  // the builder, so the outer group only needs the segment-local X/Z
  // offset. Y stays at 0 here.
  return (
    <group position={[0, 0, 0]} ref={ref} visible={node.visible}>
      <mesh
        castShadow
        geometry={trimmedBody ?? geo.body}
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
