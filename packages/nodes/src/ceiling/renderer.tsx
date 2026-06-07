'use client'

import {
  type CeilingNode,
  getMaterialPresetByRef,
  resolveMaterial,
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
import { float, mix, positionWorld, smoothstep } from 'three/tsl'
import { BackSide, FrontSide, type Mesh, MeshBasicNodeMaterial } from 'three/webgpu'
import { createPlaceholderGeometry } from '../shared/placeholder-geometry'

function createEmptyGeometry() {
  return createPlaceholderGeometry()
}

const gridScale = 5
const gridX = positionWorld.x.mul(gridScale).fract()
const gridY = positionWorld.z.mul(gridScale).fract()
const lineWidth = 0.05
const lineX = smoothstep(lineWidth, 0, gridX).add(smoothstep(1.0 - lineWidth, 1.0, gridX))
const lineY = smoothstep(lineWidth, 0, gridY).add(smoothstep(1.0 - lineWidth, 1.0, gridY))
const gridPattern = lineX.max(lineY)
const gridOpacity = mix(float(0.2), float(0.6), gridPattern)

function createCeilingMaterials(color = '#999999') {
  const topMaterial = new MeshBasicNodeMaterial({
    color,
    transparent: true,
    depthWrite: false,
    side: FrontSide,
  })
  topMaterial.opacityNode = gridOpacity

  const bottomMaterial = new MeshBasicNodeMaterial({
    color,
    transparent: true,
    side: BackSide,
  })

  return { topMaterial, bottomMaterial }
}

const ceilingMaterialCache = new Map<string, ReturnType<typeof createCeilingMaterials>>()

function getCeilingMaterials(color = '#999999') {
  const cacheKey = color
  const cached = ceilingMaterialCache.get(cacheKey)
  if (cached) return cached

  const materials = createCeilingMaterials(color)
  ceilingMaterialCache.set(cacheKey, materials)
  return materials
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

  useEffect(
    () => () => {
      placeholderGeometry.dispose()
      gridPlaceholderGeometry.dispose()
    },
    [gridPlaceholderGeometry, placeholderGeometry],
  )

  const materials = useMemo(() => {
    // Untextured ceilings (and everything in textures-off mode) take the themed
    // 'ceiling' role colour; only an explicit preset/material keeps a texture.
    const hasExplicit = Boolean(node.materialPreset || node.material)
    if (!textures || !hasExplicit) {
      // Bottom (seen from inside the room, looking up) stays opaque so the
      // ceiling reads as a solid surface. Top uses the transparent
      // grid-pattern material so the ceiling stays see-through whenever
      // the editor reveals the `ceiling-grid` overlay (placing a
      // ceiling-hosted item, or selecting one of its children — e.g.
      // after committing a placement). Without this the top mesh shipped
      // an opaque surface-role material, so a top-down camera lost view
      // of everything under the ceiling once the overlay turned on.
      const ceilingColor = resolveSurfaceColor('ceiling', colorPreset, sceneTheme)
      return {
        topMaterial: getCeilingMaterials(ceilingColor).topMaterial,
        bottomMaterial: createSurfaceRoleMaterial('ceiling', colorPreset, BackSide, sceneTheme),
      }
    }

    const preset = getMaterialPresetByRef(node.materialPreset)
    const props = preset?.mapProperties ?? resolveMaterial(node.material)
    const color = props.color || '#999999'
    return getCeilingMaterials(color)
  }, [
    textures,
    colorPreset,
    sceneTheme,
    node.materialPreset,
    node.material,
    node.material?.preset,
    node.material?.properties,
    node.material?.texture,
  ])

  return (
    <mesh geometry={placeholderGeometry} material={materials.bottomMaterial} ref={ref}>
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
