'use client'

import {
  type AnyNodeId,
  type DoorNode,
  type RoofSegmentNode,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer'
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

  // Roof-hosted doors mount under the roof's `roof-elements` group (roof
  // frame), so the host segment's transform is applied here — wall-hosted
  // doors get it for free from the wall mesh they're nested in.
  const segment = useScene((state) =>
    node.roofSegmentId
      ? (state.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )
  if (node.roofSegmentId && segment?.type !== 'roof-segment') return null

  const mesh = (
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

  if (!segment) return mesh
  return (
    <group position={segment.position} rotation-y={segment.rotation}>
      {mesh}
    </group>
  )
}

export default DoorRenderer
