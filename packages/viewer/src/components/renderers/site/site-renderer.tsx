import { type SiteNode, useRegistry } from '@pascal-app/core'
import { useRef } from 'react'
import type { Group } from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { NodeRenderer } from '../node-renderer'

export const SiteRenderer = ({ node }: { node: SiteNode }) => {
  const ref = useRef<Group>(null!)

  useRegistry(node.id, node.type, ref)
  const handlers = useNodeEvents(node, 'site')

  return (
    <group ref={ref} {...handlers}>
      {node.children.map((child) => (
        <NodeRenderer key={child.id} nodeId={child.id} />
      ))}
    </group>
  )
}
