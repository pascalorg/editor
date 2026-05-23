'use client'

import {
  type AnyNodeId,
  type ChimneyNode,
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
  getRoofSegmentBrushes,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { buildChimneyGeometry } from './geometry'
import { carveChimneyHoles } from './holes'
import { trimChimneyBodyAgainstRoof } from './roof-trim'

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
  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const colorPreset: ColorPreset = useViewer((s) => s.colorPreset)
  const sceneTheme = useViewer((s) => s.sceneTheme)

  // Merge in-flight slider drags from `useLiveNodeOverrides` so the mesh
  // updates while the user is still holding the slider. On release the
  // panel commits to the store and clears the override.
  const overrides = useLiveNodeOverrides(
    (state) => state.get(storeNode.id as AnyNodeId) as Partial<ChimneyNode> | undefined,
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

  // Geometry + carved CSG depend on the chimney's full schema and the
  // host segment's shape. Both come in as memoised references — `node`
  // only re-references when the store node or a live-override actually
  // changes, `segment` only when the segment's own data changes — so a
  // two-entry dep array is equivalent to enumerating every field, and
  // adding a new schema field doesn't risk stale geometry from a
  // forgotten dep.
  const geo = useMemo(() => {
    if (!segment) return null
    const raw = buildChimneyGeometry(node, segment)
    // Carve the smoke shaft (body cavity), cap holes, and hollow flue
    // bores. Matches the v1 roof-system visual.
    const carved = carveChimneyHoles(raw.body, raw.cap, raw.flues, node, segment)
    return { ...raw, body: carved.body, cap: carved.cap, flues: carved.flues }
  }, [node, segment])

  // Segment brushes for the body trim. Building these is non-trivial
  // (4 CSG-ready Brush instances per segment), so memoise by the shape
  // fields that drive their geometry. A chimney slider drag changes
  // `node.*` but not these, so the cached brushes survive the drag —
  // previously each frame rebuilt all four.
  const segmentBrushes = useMemo(
    () => (segment ? getRoofSegmentBrushes(segment) : null),
    [
      segment?.roofType,
      segment?.width,
      segment?.depth,
      segment?.wallHeight,
      segment?.pitch,
      segment?.wallThickness,
      segment?.deckThickness,
      segment?.overhang,
      segment?.shingleThickness,
    ],
  )
  useEffect(
    () => () => {
      if (segmentBrushes) {
        segmentBrushes.deckSlab.geometry.dispose()
        segmentBrushes.shinSlab.geometry.dispose()
        segmentBrushes.wallBrush.geometry.dispose()
        segmentBrushes.innerBrush.geometry.dispose()
      }
    },
    [segmentBrushes],
  )

  // CSG-trim the body against the parent roof segment so the portion
  // passing through the wall and shingles is hidden. Returns the
  // original body geometry on any CSG failure (logged via console.error).
  const trimmedBody = useMemo(() => {
    if (!geo || !segment || !segmentBrushes) return null
    return trimChimneyBodyAgainstRoof(geo.body, segment, node, segmentBrushes)
  }, [geo, segment, node, segmentBrushes])

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

  // Per-instance fallback materials. Were previously module-scoped
  // singletons shared across every chimney — a paint-mode or debug
  // system that mutates `surfaceMaterial` would have flipped the look
  // of every unpainted chimney on the scene. Owning them here also
  // lets us dispose them on unmount.
  const fallbackBodyMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xb8_88_72,
        roughness: 0.85,
        metalness: 0,
      }),
    [],
  )
  const fallbackTopMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xa0_a0_a0,
        roughness: 0.75,
        metalness: 0,
      }),
    [],
  )
  useEffect(
    () => () => {
      fallbackBodyMaterial.dispose()
      fallbackTopMaterial.dispose()
    },
    [fallbackBodyMaterial, fallbackTopMaterial],
  )

  const surfaceMaterial = useMemo(() => {
    // Untextured chimney body (and everything in textures-off mode) takes
    // the themed 'wall' role colour; only an explicit preset/material keeps
    // its texture when textures are on.
    if (!textures || (!node.material && !node.materialPreset)) {
      return createSurfaceRoleMaterial('wall', colorPreset, undefined, sceneTheme)
    }
    if (node.material) return createMaterial(node.material, shading)
    return createMaterialFromPresetRef(node.materialPreset, shading) ?? fallbackBodyMaterial
  }, [
    textures,
    colorPreset,
    sceneTheme,
    shading,
    node.material,
    node.materialPreset,
    fallbackBodyMaterial,
  ])

  const capSurfaceMaterial = useMemo(() => {
    // Cap/crown is the chimney's roof-facing surface → 'roof' role when
    // untextured (or textures off). Otherwise resolve the explicit cap
    // material, then fall back to the body material.
    if (
      !textures ||
      (!node.topMaterial && !node.topMaterialPreset && !node.material && !node.materialPreset)
    ) {
      return createSurfaceRoleMaterial('roof', colorPreset, undefined, sceneTheme)
    }
    if (node.topMaterial) return createMaterial(node.topMaterial, shading)
    const preset = createMaterialFromPresetRef(node.topMaterialPreset, shading)
    if (preset) return preset
    if (node.material) return createMaterial(node.material, shading)
    return createMaterialFromPresetRef(node.materialPreset, shading) ?? fallbackTopMaterial
  }, [
    textures,
    colorPreset,
    sceneTheme,
    shading,
    node.topMaterial,
    node.topMaterialPreset,
    node.material,
    node.materialPreset,
    fallbackTopMaterial,
  ])

  // Two-material array: index 0 = body/surface, index 1 = top. The
  // geometry buffers are partitioned in `holes.ts:partitionTopFaceGroups`
  // so the very top face of body/cap/flues lands in group 1 and picks up
  // the top material — matching the v1 roof-system visual.
  // Must be declared above the early-return below: hooks can't be
  // called conditionally without changing the hook-call order between
  // renders.
  const surfaceArray = useMemo(
    () => [surfaceMaterial, capSurfaceMaterial],
    [surfaceMaterial, capSurfaceMaterial],
  )

  if (!segment || !geo) return null

  // The chimney's geometry bakes its baseY using segment.wallHeight inside
  // the builder, so the outer group only needs the segment-local X/Z
  // offset. Y stays at 0 here.

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
        name="chimney-body"
        receiveShadow
      />
      {geo.cap && (
        <mesh
          castShadow
          geometry={geo.cap}
          material={surfaceArray}
          name="chimney-cap"
          receiveShadow
        />
      )}
      {geo.flues && (
        <mesh
          castShadow
          geometry={geo.flues}
          material={surfaceArray}
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
      {geo.bands && (
        <mesh
          castShadow
          geometry={geo.bands}
          material={surfaceMaterial}
          name="chimney-bands"
          receiveShadow
        />
      )}
    </group>
  )
}

export default ChimneyRenderer
