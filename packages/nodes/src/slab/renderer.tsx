'use client'

import { getMaterialPresetByRef, type SlabNode, useRegistry, useScene } from '@pascal-app/core'
import {
  applyMaterialPresetToMaterials,
  createMaterial,
  DEFAULT_SLAB_MATERIAL,
  useNodeEvents,
} from '@pascal-app/viewer'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { Mesh } from 'three'
import * as THREE from 'three'

/**
 * Thin slab renderer. Mounts a placeholder mesh, registers it with
 * `sceneRegistry`, and marks the node dirty so `SlabSystem` fills the
 * geometry next frame.
 *
 * Behaviorally identical to the legacy `SlabRenderer` in
 * `@pascal-app/viewer/components/renderers/slab/slab-renderer.tsx` —
 * same placeholder geometry, same material cache, same render output.
 *
 * Material logic is preserved from legacy: slab can carry either a raw
 * `material` or a `materialPreset` (preset takes precedence; preset
 * apply mutates the cached material instance so async texture loads
 * still hit the rendered mesh on re-mount).
 *
 * No `def.geometry` yet — slab polygon geometry depends on holes +
 * triangulation that lives inside `SlabSystem`'s useFrame body. Future
 * milestone can extract a pure builder if useful, but the system is
 * already efficient (rebuilds only dirty nodes); no urgency.
 */
const slabMaterialCache = new Map<string, THREE.MeshStandardMaterial>()

function createEmptyGeometry() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
  return geometry
}

function getSlabMaterial(
  cacheKey: string,
  params: { material?: SlabNode['material']; materialPreset?: string },
) {
  const cached = slabMaterialCache.get(cacheKey)
  if (cached) return cached

  const preset = getMaterialPresetByRef(params.materialPreset)
  const slabMaterial = preset
    ? new THREE.MeshStandardMaterial()
    : params.material
      ? createMaterial(params.material).clone()
      : DEFAULT_SLAB_MATERIAL.clone()

  if (preset) {
    applyMaterialPresetToMaterials(slabMaterial, preset)
  }

  slabMaterial.transparent = false
  slabMaterial.opacity = 1
  slabMaterial.alphaMap = null
  slabMaterial.side = THREE.DoubleSide
  slabMaterial.depthWrite = true
  slabMaterial.needsUpdate = true

  slabMaterialCache.set(cacheKey, slabMaterial)
  return slabMaterial
}

const SlabRenderer = ({ node }: { node: SlabNode }) => {
  const ref = useRef<Mesh>(null!)
  const placeholderGeometry = useMemo(createEmptyGeometry, [])
  const handlers = useNodeEvents(node, 'slab')

  useRegistry(node.id, 'slab', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  useEffect(() => () => placeholderGeometry.dispose(), [placeholderGeometry])

  const material = useMemo(() => {
    const resolvedMaterial = node.material
    const resolvedMaterialPreset = node.materialPreset
    const cacheKey = JSON.stringify({
      material: resolvedMaterial ?? null,
      materialPreset: resolvedMaterialPreset ?? null,
    })

    return getSlabMaterial(cacheKey, {
      material: resolvedMaterial,
      materialPreset: resolvedMaterialPreset,
    })
  }, [
    node.material,
    node.material?.preset,
    node.material?.properties,
    node.material?.texture,
    node.materialPreset,
  ])

  return (
    <mesh
      castShadow
      geometry={placeholderGeometry}
      material={material}
      receiveShadow
      ref={ref}
      visible={node.visible}
      {...handlers}
    />
  )
}

export default SlabRenderer
