'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type LeanToExtensionNode,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { NodeRenderer, useNodeEvents } from '@pascal-app/viewer'
import { useLayoutEffect, useRef } from 'react'
import type { Group } from 'three'
import { resolveLeanToParentPose } from './layout'

const LeanToExtensionRenderer = ({ node }: { node: LeanToExtensionNode }) => {
  const ref = useRef<Group>(null!)
  const handlers = useNodeEvents(node, 'lean-to-extension')
  const liveTransform = useLiveTransforms((state) => state.get(node.id as AnyNodeId))
  const liveOverride = useLiveNodeOverrides((state) => state.overrides.get(node.id))
  const parent = useScene((state) =>
    node.parentId ? state.nodes[node.parentId as AnyNodeId] : undefined,
  )

  useRegistry(node.id, node.type, ref)
  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id as AnyNodeId)
  }, [node.id])

  const overridePosition = liveOverride?.position as [number, number, number] | undefined
  const overrideRotation = liveOverride?.rotation as [number, number, number] | undefined
  const effectiveNode: LeanToExtensionNode = {
    ...node,
    position: liveTransform?.position ?? overridePosition ?? node.position,
    rotation: [
      overrideRotation?.[0] ?? node.rotation[0],
      liveTransform?.rotation ?? overrideRotation?.[1] ?? node.rotation[1],
      overrideRotation?.[2] ?? node.rotation[2],
    ],
  }
  const pose =
    parent?.type === 'wall'
      ? resolveLeanToParentPose(parent as WallNode, effectiveNode)
      : { position: effectiveNode.position, rotationY: effectiveNode.rotation[1] }

  return (
    <group
      position={pose.position}
      ref={ref}
      rotation={[effectiveNode.rotation[0], pose.rotationY, effectiveNode.rotation[2]]}
      visible={effectiveNode.visible !== false}
      {...handlers}
    >
      {effectiveNode.children.map((childId) => (
        <NodeRenderer key={`${node.id}:${childId}`} nodeId={childId as AnyNode['id']} />
      ))}
    </group>
  )
}

export default LeanToExtensionRenderer
