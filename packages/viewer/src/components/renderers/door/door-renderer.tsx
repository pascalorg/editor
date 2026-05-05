import { type DoorNode, useRegistry, useScene } from '@pascal-app/core'
import { useLayoutEffect, useRef } from 'react'
import { MeshBasicMaterial, type Mesh } from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'

const doorHitboxMaterial = new MeshBasicMaterial({ visible: false })

export const DoorRenderer = ({ node }: { node: DoorNode }) => {
  const ref = useRef<Mesh>(null!)

  useRegistry(node.id, 'door', ref)
  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])
  const handlers = useNodeEvents(node, 'door')
  const isTransient = !!(node.metadata as Record<string, unknown> | null)?.isTransient

  return (
    <mesh
      castShadow
      material={doorHitboxMaterial}
      position={node.position}
      receiveShadow
      ref={ref}
      rotation={node.rotation}
      visible={node.visible}
      {...(isTransient ? {} : handlers)}
    >
      <boxGeometry args={[0, 0, 0]} />
    </mesh>
  )
}
