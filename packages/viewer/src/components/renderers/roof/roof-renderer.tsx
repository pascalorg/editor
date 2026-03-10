import { type RoofNode, useRegistry } from '@pascal-app/core'
import { useRef } from 'react'
import type { Group } from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { NodeRenderer } from '../node-renderer'

export const RoofRenderer = ({ node }: { node: RoofNode }) => {
  const ref = useRef<Group>(null!)

  useRegistry(node.id, 'roof', ref)

  const handlers = useNodeEvents(node, 'roof')

  return (
    <group
      ref={ref}
      position={node.position}
      rotation-y={node.rotation}
      visible={node.visible}
      {...handlers}
    >
      {(node.children ?? []).map((childId) => (
        <NodeRenderer key={childId} nodeId={childId} />
      ))}
    </group>
  )
}
