import { type SlabNode, useRegistry } from '@pascal-app/core'
import { useRef } from 'react'
import type { Mesh } from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'

export const SlabRenderer = ({ node }: { node: SlabNode }) => {
  const ref = useRef<Mesh>(null!)

  useRegistry(node.id, 'slab', ref)

  const handlers = useNodeEvents(node, 'slab')

  return (
    <mesh ref={ref} castShadow receiveShadow {...handlers}>
      {/* SlabSystem will replace this geometry in the next frame */}
      <boxGeometry args={[0, 0, 0]} />
      <meshStandardMaterial color="#e5e5e5" />
    </mesh>
  )
}
