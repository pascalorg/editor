'use client'

import { type DoorNode, useLiveNodeOverrides, useRegistry, useScene } from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer'
import { useLayoutEffect, useRef } from 'react'
import { type Mesh, MeshBasicMaterial } from 'three'
import { RoofFaceHostFrame } from '../shared/roof-face-host'

const doorHitboxMaterial = new MeshBasicMaterial({ visible: false })

export const DoorRenderer = ({ node }: { node: DoorNode }) => {
  const ref = useRef<Mesh>(null!)

  useRegistry(node.id, 'door', ref)
  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])
  const handlers = useNodeEvents(node, 'door')
  const liveVisible = useLiveNodeOverrides((s) => {
    const visible = s.get(node.id)?.visible
    return typeof visible === 'boolean' ? visible : undefined
  })
  const isTransient = !!(node.metadata as Record<string, unknown> | null)?.isTransient

  const mesh = (
    <mesh
      castShadow
      material={doorHitboxMaterial}
      position={node.position}
      receiveShadow
      ref={ref}
      rotation={node.rotation}
      visible={liveVisible ?? node.visible}
      {...(isTransient ? {} : handlers)}
    >
      <boxGeometry args={[0, 0, 0]} />
    </mesh>
  )

  if (!node.roofSegmentId) return mesh
  return (
    <RoofFaceHostFrame roofFace={node.roofFace} roofSegmentId={node.roofSegmentId}>
      {mesh}
    </RoofFaceHostFrame>
  )
}

export default DoorRenderer
