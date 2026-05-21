'use client'

import {
  type AnyNodeId,
  type ChimneyNode,
  type RoofSegmentNode,
  useLiveNodeOverrides,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { createMaterial, createMaterialFromPresetRef, useNodeEvents } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { buildChimneyGeometry } from './geometry'
import { carveChimneyHoles } from './holes'
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
const ChimneyRenderer = ({ node: storeNode }: { node: ChimneyNode }) => {
  const ref = useRef<THREE.Group>(null!)
  useRegistry(storeNode.id, 'chimney', ref)
  const handlers = useNodeEvents(storeNode, 'chimney')

  // Merge in-flight slider drags from `useLiveNodeOverrides` so the mesh
  // updates while the user is still holding the slider. On release the
  // panel commits to the store and clears the override.
  const overrides = useLiveNodeOverrides((state) =>
    state.get(storeNode.id as AnyNodeId) as Partial<ChimneyNode> | undefined,
  )
  const node = useMemo<ChimneyNode>(
    () => (overrides ? { ...storeNode, ...overrides } : storeNode),
    [storeNode, overrides],
  )

  const segment = useScene((state) =>
    node.roofSegmentId
      ? (state.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  const geo = useMemo(() => {
    if (!segment) return null
    const raw = buildChimneyGeometry(node, segment)
    // Carve the smoke shaft (body cavity), cap holes, and hollow flue
    // bores. Matches the v1 roof-system visual.
    const carved = carveChimneyHoles(raw.body, raw.cap, raw.flues, node, segment)
    return { ...raw, body: carved.body, cap: carved.cap, flues: carved.flues }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    segment?.wallHeight,
    segment?.roofHeight,
    segment?.roofType,
    node.width,
    node.depth,
    node.heightAboveRidge,
    node.bodyShape,
    node.bodyHollowDepth,
    node.bodyHollowMargin,
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
    node.flueWallThickness,
    node.cricketStyle,
    node.cricketSide,
    node.cricketLength,
    node.cricketHeight,
    node.bandStyle,
    node.bandHeight,
    node.bandExtent,
    node.bandOffset,
    node.panelStyle,
    node.panelDepth,
    node.panelHeight,
    node.panelOffsetTop,
    node.panelMargin,
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
        geo.bands?.dispose()
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
  // Two-material array: index 0 = body/surface, index 1 = top. The
  // geometry buffers are partitioned in `holes.ts:partitionTopFaceGroups`
  // so the very top face of body/cap/flues lands in group 1 and picks up
  // the top material — matching the v1 roof-system visual.
  const surfaceArray = useMemo(
    () => [surfaceMaterial, capSurfaceMaterial],
    [surfaceMaterial, capSurfaceMaterial],
  )

  // Chimneys are mounted inside `RoofRenderer`'s `roof-elements` group,
  // which sits at the ROOF's origin — not inside the host segment's
  // transform. Apply the segment's own position/rotation here so a
  // chimney parented to segment N lands on segment N (and not on the
  // first segment) once the chimney's segment-local `node.position[0/2]`
  // is layered in by `geometry.ts`. Mirrors skylight's renderer.
  return (
    <group
      position={segment.position}
      ref={ref}
      rotation-y={segment.rotation}
      visible={node.visible}
      {...handlers}
    >
      <mesh
        castShadow
        geometry={trimmedBody ?? geo.body}
        material={surfaceArray}
        name="chimney-surface"
        receiveShadow
      />
      {geo.cap && (
        <mesh
          castShadow
          geometry={geo.cap}
          material={surfaceArray}
          name="chimney-surface"
          receiveShadow
        />
      )}
      {geo.flues && (
        <mesh
          castShadow
          geometry={geo.flues}
          material={surfaceArray}
          name="chimney-surface"
          receiveShadow
        />
      )}
      {geo.cricket && (
        <mesh
          castShadow
          geometry={geo.cricket}
          material={surfaceMaterial}
          name="chimney-surface"
          receiveShadow
        />
      )}
      {geo.bands && (
        <mesh
          castShadow
          geometry={geo.bands}
          material={surfaceMaterial}
          name="chimney-surface"
          receiveShadow
        />
      )}
    </group>
  )
}

export default ChimneyRenderer
