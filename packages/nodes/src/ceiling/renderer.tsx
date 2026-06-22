'use client'

import {
  type CeilingNode,
  getMaterialPresetByRef,
  resolveMaterial,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import {
  createSurfaceRoleMaterial,
  NodeRenderer,
  resolveSurfaceColor,
  useViewer,
} from '@pascal-app/viewer'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { BackSide, type Mesh } from 'three/webgpu'
import { createPlaceholderGeometry } from '../shared/placeholder-geometry'
import { ceilingColorFromRef, getCeilingMaterials } from './materials'
import { CEILING_SLOT_DEFAULT_COLOR } from './slots'

function createEmptyGeometry() {
  return createPlaceholderGeometry()
}

export const CeilingRenderer = ({ node }: { node: CeilingNode }) => {
  const ref = useRef<Mesh>(null!)
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
  const ceilingY = (node.height ?? 2.5) - 0.01 + (liveTransform?.position[1] ?? 0)
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

  return (
    <mesh
      geometry={placeholderGeometry}
      material={materials.bottomMaterial}
      position={position}
      ref={ref}
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
