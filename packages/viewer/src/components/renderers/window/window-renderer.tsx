import { useRegistry, type WindowNode } from '@pascal-app/core'
import { useRef } from 'react'
import type { Mesh } from 'three'

export const WindowRenderer = ({ node }: { node: WindowNode }) => {
  const ref = useRef<Mesh>(null!)

  useRegistry(node.id, 'window', ref)

  return (
    <mesh
      ref={ref}
      castShadow
      receiveShadow
      visible={node.visible}
      position={node.position}
      rotation={node.rotation}
    >
      {/* WindowSystem replaces this geometry each time the node is dirty */}
      <boxGeometry args={[0, 0, 0]} />
      <meshStandardMaterial color="#d1d5db" />
    </mesh>
  )
}
