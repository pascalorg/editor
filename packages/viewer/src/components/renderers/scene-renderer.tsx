'use client'

import { useScene } from '@vesper/core'
import { memo } from 'react'
import { NodeRenderer } from './node-renderer'

const SceneRendererInner = () => {
  const rootNodes = useScene((state) => state.rootNodeIds)

  return (
    <group name="scene-renderer">
      {rootNodes.map((nodeId) => (
        <NodeRenderer key={nodeId} nodeId={nodeId} />
      ))}
    </group>
  )
}

export const SceneRenderer = memo(SceneRendererInner)
