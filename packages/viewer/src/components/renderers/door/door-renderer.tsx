import { useRegistry, type DoorNode } from '@pascal-app/core'
import { useRef } from 'react'
import type { Mesh } from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'

export const DoorRenderer = ({ node }: { node: DoorNode }) => {
  const ref = useRef<Mesh>(null!)

  useRegistry(node.id, 'door', ref)
  const handlers = useNodeEvents(node, 'door')

  return (
    <mesh
      ref={ref}
      castShadow
      receiveShadow
      visible={node.visible}
      position={node.position}
      rotation={node.rotation}
      {...handlers}
    >
      {/* DoorSystem replaces this geometry each time the node is dirty */}
      <boxGeometry args={[0, 0, 0]} />
      <meshStandardMaterial color="#d1d5db" />
    </mesh>
  )
}
