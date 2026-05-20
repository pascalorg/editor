'use client'

import { type LevelNode, useRegistry } from '@pascal-app/core'
import { NodeRenderer, useNodeEvents } from '@pascal-app/viewer'
import { useRef } from 'react'
import type { Group } from 'three'

export const LevelRenderer = ({ node }: { node: LevelNode }) => {
  const ref = useRef<Group>(null!)

  useRegistry(node.id, node.type, ref)
  const handlers = useNodeEvents(node, 'level')

  return (
    <group ref={ref} {...handlers}>
      {node.children.map((childId) => (
        <NodeRenderer key={childId} nodeId={childId} />
      ))}
    </group>
  )
}

export default LevelRenderer
