import { type SlabNode, useRegistry } from '@pascal-app/core'
import { useMemo, useRef } from 'react'
import type { Mesh } from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import {
  createMaterial,
  createMaterialFromPresetRef,
  DEFAULT_SLAB_MATERIAL,
} from '../../../lib/materials'

export const SlabRenderer = ({ node }: { node: SlabNode }) => {
  const ref = useRef<Mesh>(null!)

  useRegistry(node.id, 'slab', ref)

  const handlers = useNodeEvents(node, 'slab')

  const material = useMemo(() => {
    const presetMaterial = createMaterialFromPresetRef(node.materialPreset)
    if (presetMaterial) return presetMaterial
    const mat = node.material
    if (!mat) return DEFAULT_SLAB_MATERIAL
    return createMaterial(mat)
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
