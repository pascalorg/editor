import { getMaterialPresetByRef, type SlabNode, useRegistry } from '@pascal-app/core'
import { useMemo, useRef } from 'react'
import type { Mesh } from 'three'
import * as THREE from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import {
  applyMaterialPresetToMaterials,
  createMaterial,
  DEFAULT_SLAB_MATERIAL,
} from '../../../lib/materials'

const slabMaterialCache = new Map<string, THREE.MeshStandardMaterial>()

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
    // Apply the preset to the slab-owned material so async texture loads update
    // the instance we actually render after refresh as well.
    applyMaterialPresetToMaterials(slabMaterial, preset)
  }

  // Slabs participate in the WebGPU MRT scene pass. Keeping them opaque avoids
  // pipeline variants that can fail when geometry is regenerated while a
  // transparent/custom material is attached.
  slabMaterial.transparent = false
  slabMaterial.opacity = 1
  slabMaterial.alphaMap = null
  slabMaterial.side = THREE.DoubleSide
  slabMaterial.depthWrite = true
  slabMaterial.needsUpdate = true

  slabMaterialCache.set(cacheKey, slabMaterial)
  return slabMaterial
}

export const SlabRenderer = ({ node }: { node: SlabNode }) => {
  const ref = useRef<Mesh>(null!)

  useRegistry(node.id, 'slab', ref)

  const handlers = useNodeEvents(node, 'slab')

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
      receiveShadow
      ref={ref}
      {...handlers}
      material={material}
      visible={node.visible}
    >
      <boxGeometry args={[0, 0, 0]} />
    </mesh>
  )
}
