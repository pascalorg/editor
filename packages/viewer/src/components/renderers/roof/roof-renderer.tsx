import { type RoofNode, useRegistry } from '@pascal-app/core'
import { useRef } from 'react'
import type { Mesh } from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'

export const RoofRenderer = ({ node }: { node: RoofNode }) => {
  const ref = useRef<Mesh>(null!)

  useRegistry(node.id, 'roof', ref)

  const handlers = useNodeEvents(node, 'roof')

  return (
    <mesh
      ref={ref}
      castShadow
      receiveShadow
      position={node.position}
      rotation-y={node.rotation}
      {...handlers}
    >
      {/* RoofSystem will replace this geometry in the next frame */}
      <boxGeometry args={[0, 0, 0]} />
      <meshStandardMaterial color="white" />
    </mesh>
  )
}
