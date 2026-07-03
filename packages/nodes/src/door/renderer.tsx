'use client'

import { type DoorNode, useRegistry, useScene } from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer/node-events'
import { useLayoutEffect, useRef } from 'react'
import { type Mesh, MeshBasicMaterial } from 'three'

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

export default DoorRenderer
