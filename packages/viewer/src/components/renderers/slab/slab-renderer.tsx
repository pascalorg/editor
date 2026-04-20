import { getMaterialPresetByRef, type SlabNode, useRegistry } from '@pascal-app/core'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Mesh } from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import {
  applyMaterialPresetToMaterials,
  createMaterial,
  DEFAULT_SLAB_MATERIAL,
} from '../../../lib/materials'

export const SlabRenderer = ({ node }: { node: SlabNode }) => {
  const ref = useRef<Mesh>(null!)

  useRegistry(node.id, 'slab', ref)

  const handlers = useNodeEvents(node, 'slab')

  const material = useMemo(() => {
    const preset = getMaterialPresetByRef(node.materialPreset)
    const slabMaterial = preset
      ? new THREE.MeshStandardMaterial()
      : node.material
        ? createMaterial(node.material).clone()
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

    return slabMaterial
  }, [
    node.material,
    node.material?.preset,
    node.material?.properties,
    node.material?.texture,
    node.materialPreset,
  ])

  useEffect(() => {
    return () => {
      material.dispose()
    }
  }, [material])

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
