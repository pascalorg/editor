'use client'

import { type BuildingNode, useRegistry } from '@pascal-app/core'
import { NodeRenderer, useNodeEvents } from '@pascal-app/viewer'
import { useRef } from 'react'
import type { Group } from 'three'

export const BuildingRenderer = ({ node }: { node: BuildingNode }) => {
  const ref = useRef<Group>(null!)

  useRegistry(node.id, node.type, ref)
  const handlers = useNodeEvents(node, 'building')

  return (
    <group
      position={node.position}
      ref={ref}
      rotation={[node.rotation[0], node.rotation[1], node.rotation[2]]}
      {...handlers}
    >
      {(node.children ?? []).map((childId) => (
        <NodeRenderer key={childId} nodeId={childId} />
      ))}
    </group>
  )
}

export default BuildingRenderer
