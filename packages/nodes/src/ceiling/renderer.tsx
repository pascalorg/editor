'use client'

import {
  type AnyNodeId,
  CEILING_DRAW_OFFSET,
  type CeilingNode,
  ceilingPaintRegions,
  getMaterialPresetByRef,
  type MaterialSchema,
  resolveCeilingHeight,
  resolveMaterial,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import {
  CEILING_REGION_MESH,
  type CeilingRegionMaterial,
  createSurfaceRoleMaterial,
  NodeRenderer,
  resolveSurfaceColor,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { BackSide, type Mesh } from 'three/webgpu'
import { createPlaceholderGeometry } from '../shared/placeholder-geometry'
import { ceilingColorFromRef, getCeilingMaterials } from './materials'
import { CEILING_SLOT_DEFAULT_COLOR } from './slots'

function createEmptyGeometry() {
  return createPlaceholderGeometry()
}

export const CeilingRenderer = ({ node }: { node: CeilingNode }) => {
  const ref = useRef<Mesh>(null!)
  const handlers = useNodeEvents(node, 'ceiling')
  const placeholderGeometry = useMemo(createEmptyGeometry, [])
  const gridPlaceholderGeometry = useMemo(createEmptyGeometry, [])

  useRegistry(node.id, 'ceiling', ref)
  // Build the real geometry on mount instead of relying on a child item to
  // mark us dirty (CeilingSystem only rebuilds dirty ceilings). Ceiling-hosted
  // items are async GLB loads, so without this the ceiling holds its
  // placeholder geometry until the first child finishes downloading — and a
  // childless ceiling would never build at all. Mirrors WallRenderer /
  // RoofRenderer.
  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])
  const textures = useViewer((s) => s.textures)
  const colorPreset = useViewer((s) => s.colorPreset)
  const sceneTheme = useViewer((s) => s.sceneTheme)
  // Subscribe to the scene-material library so editing a `scene:` material the
  // ceiling slot references re-tints it live.
  const sceneMaterials = useScene((s) => s.materials)
  const liveTransform = useLiveTransforms((s) => s.get(node.id))
  // Resolved height: explicit when stored, else the live level-top bound
  // (primitive selector, so follows-mode ceilings track level-height edits
  // and covering-slab changes without a node write).
  const resolvedHeight = useScene((s) => resolveCeilingHeight(node, s.nodes))
  const ceilingY = resolvedHeight - CEILING_DRAW_OFFSET + (liveTransform?.position[1] ?? 0)
  const position: [number, number, number] = [
    liveTransform?.position[0] ?? 0,
    ceilingY,
    liveTransform?.position[2] ?? 0,
  ]

  useEffect(
    () => () => {
      placeholderGeometry.dispose()
      gridPlaceholderGeometry.dispose()
    },
    [gridPlaceholderGeometry, placeholderGeometry],
  )

  const materials = useMemo(() => {
    // Textures-off mode takes the themed 'ceiling' role colour — the guaranteed
    // escape hatch, independent of any slot override. The bottom (seen from
    // inside the room, looking up) stays opaque so the ceiling reads as a solid
    // surface; the top keeps the transparent grid material so a top-down camera
    // can see through the ceiling whenever the `ceiling-grid` overlay is
    // revealed (placing a ceiling-hosted item, or selecting one of its
    // children). Without that the top mesh would ship an opaque surface-role
    // material and a top-down camera would lose everything under the ceiling.
    if (!textures) {
      const ceilingColor = resolveSurfaceColor('ceiling', colorPreset, sceneTheme)
      return {
        topMaterial: getCeilingMaterials(ceilingColor).topMaterial,
        bottomMaterial: createSurfaceRoleMaterial('ceiling', colorPreset, BackSide, sceneTheme),
      }
    }

    // Unified slot override — shared scene material or catalog `library:` finish
    // (resolved to its base colour; a ceiling renders flat-tinted, not mapped).
    const slotColor = ceilingColorFromRef(node.slots?.surface, sceneMaterials)
    if (slotColor) return getCeilingMaterials(slotColor)

    // Legacy inline material / preset (scenes painted before the slot model).
    if (node.materialPreset || node.material) {
      const preset = getMaterialPresetByRef(node.materialPreset)
      const props = preset?.mapProperties ?? resolveMaterial(node.material)
      return getCeilingMaterials(props.color || '#999999')
    }

    // Declared slot default.
    return getCeilingMaterials(CEILING_SLOT_DEFAULT_COLOR)
  }, [
    textures,
    colorPreset,
    sceneTheme,
    sceneMaterials,
    node.slots,
    node.materialPreset,
    node.material,
    node.material?.preset,
    node.material?.properties,
    node.material?.texture,
  ])

  // Painted parts draw with the same flat tint as the ceiling; the system builds
  // their meshes and asks this for the material.
  const regionMaterial = useCallback<CeilingRegionMaterial>(
    (finish) => {
      if (!textures) return materials.bottomMaterial
      const color =
        typeof finish === 'string'
          ? ceilingColorFromRef(finish, sceneMaterials)
          : finish
            ? resolveMaterial(finish as MaterialSchema).color
            : null
      return getCeilingMaterials(color || CEILING_SLOT_DEFAULT_COLOR).bottomMaterial
    },
    [textures, sceneMaterials, materials],
  )
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    mesh.userData.ceilingRegionMaterial = regionMaterial
    let repainted = false
    for (const child of mesh.children)
      if (child.name === CEILING_REGION_MESH) {
        ;(child as Mesh).material = regionMaterial(child.userData.finish)
        repainted = true
      }
    // A batched copy keeps the old material until the ceiling is rebuilt.
    if (repainted) useScene.getState().markDirty(node.id as AnyNodeId)
  }, [node.id, regionMaterial])
  // An automatic ceiling's regions live on its room: a repaint there rebuilds it.
  const regionsKey = useScene((s) => JSON.stringify(ceilingPaintRegions(node, s.nodes)))
  const builtRegionsKey = useRef(regionsKey)
  useEffect(() => {
    if (builtRegionsKey.current === regionsKey) return
    builtRegionsKey.current = regionsKey
    useScene.getState().markDirty(node.id as AnyNodeId)
  }, [node.id, regionsKey])

  return (
    <mesh
      geometry={placeholderGeometry}
      material={materials.bottomMaterial}
      position={position}
      ref={ref}
      visible={node.visible !== false}
      {...handlers}
    >
      <mesh
        geometry={gridPlaceholderGeometry}
        material={materials.topMaterial}
        name="ceiling-grid"
        scale={0}
        visible={false}
      />
      {(node.children ?? []).map((childId) => (
        <NodeRenderer key={childId} nodeId={childId} />
      ))}
    </mesh>
  )
}

export default CeilingRenderer
