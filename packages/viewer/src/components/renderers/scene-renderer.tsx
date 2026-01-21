'use client'

import { useScene } from '@pascal-app/core'
import { NodeRenderer } from './node-renderer'

export const SceneRenderer = () => {
  const rootNodes = useScene((state) => state.rootNodeIds)

  return rootNodes.map((nodeId) => <NodeRenderer key={nodeId} nodeId={nodeId} />)
}
