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
  const liveOverrides = useLiveNodeOverrides((s) => s.get(node.id))
  const renderNode = liveOverrides ? ({ ...node, ...liveOverrides } as DoorNode) : node
  const isTransient = !!(node.metadata as Record<string, unknown> | null)?.isTransient

  const mesh = (
    <mesh
      castShadow
      material={doorHitboxMaterial}
      position={renderNode.position}
      receiveShadow
      ref={ref}
      rotation={renderNode.rotation}
      visible={renderNode.visible}
      {...(isTransient ? {} : handlers)}
    >
      <boxGeometry args={[0, 0, 0]} />
    </mesh>
  )

  if (!renderNode.roofSegmentId) return mesh
  return (
    <RoofFaceHostFrame roofFace={renderNode.roofFace} roofSegmentId={renderNode.roofSegmentId}>
      {mesh}
    </RoofFaceHostFrame>
  )
}

export default DoorRenderer
