import { useRegistry, type SlabNode } from '@pascal-app/core'
import { useRef } from 'react'
import type { Mesh } from 'three'

export const SlabRenderer = ({ node }: { node: SlabNode }) => {
  const ref = useRef<Mesh>(null!)

  useRegistry(node.id, 'slab', ref)

  return (
    <mesh ref={ref} castShadow receiveShadow>
      {/* SlabSystem will replace this geometry in the next frame */}
      <boxGeometry args={[0, 0, 0]} />
      <meshStandardMaterial color="#e5e5e5" />
    </mesh>
  )
}
