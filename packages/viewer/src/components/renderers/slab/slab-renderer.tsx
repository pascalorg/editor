import { type SlabNode, useRegistry } from '@pascal-app/core'
import { useMemo, useRef } from 'react'
import type { Mesh } from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { createMaterial, DEFAULT_SLAB_MATERIAL } from '../../../lib/materials'

export const SlabRenderer = ({ node }: { node: SlabNode }) => {
  const ref = useRef<Mesh>(null!)

  useRegistry(node.id, 'slab', ref)

  const handlers = useNodeEvents(node, 'slab')

  const material = useMemo(() => {
    const mat = node.material
    if (!mat) return DEFAULT_SLAB_MATERIAL
    return createMaterial(mat)
  }, [node.material, node.material?.preset, node.material?.properties, node.material?.texture])

  return (
    <mesh castShadow receiveShadow ref={ref} {...handlers} visible={node.visible} material={material}>
      <boxGeometry args={[0, 0, 0]} />
    </mesh>
  )
}
