import { type SlabNode, useRegistry } from '@vesper/core'
import { memo, useRef } from 'react'
import type { Mesh } from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'

const SlabRendererInner = ({ node }: { node: SlabNode }) => {
  const ref = useRef<Mesh>(null!)

  useRegistry(node.id, 'slab', ref)

  const handlers = useNodeEvents(node, 'slab')

  return (
    <mesh castShadow receiveShadow ref={ref} {...handlers} visible={node.visible}>
      {/* SlabSystem will replace this geometry in the next frame */}
      <boxGeometry args={[0, 0, 0]} />
      <meshStandardMaterial color="#e5e5e5" />
    </mesh>
  )
}

export const SlabRenderer = memo(SlabRendererInner)
