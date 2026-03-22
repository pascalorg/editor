import { useRegistry, type WindowNode } from '@vesper/core'
import { useRef } from 'react'
import type { Mesh } from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'

export const WindowRenderer = ({ node }: { node: WindowNode }) => {
  const ref = useRef<Mesh>(null!)

  useRegistry(node.id, 'window', ref)
  const handlers = useNodeEvents(node, 'window')
  const isTransient = !!(node.metadata as Record<string, unknown> | null)?.isTransient

  return (
    <mesh
      castShadow
      position={node.position}
      receiveShadow
      ref={ref}
      rotation={node.rotation}
      visible={node.visible}
      {...(isTransient ? {} : handlers)}
    >
      {/* WindowSystem replaces this geometry each time the node is dirty */}
      <boxGeometry args={[0, 0, 0]} />
      <meshStandardMaterial color="#d1d5db" />
    </mesh>
  )
}
