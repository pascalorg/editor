'use client'

import { useScene } from '@pascal-app/core'
import { LiveFamilyVisibility } from '../viewer/family-visibility'
import { SectionGroup } from '../viewer/section-group'
import { NodeRenderer } from './node-renderer'

export const SceneRenderer = () => {
  const rootNodes = useScene((state) => state.rootNodeIds)

  return (
    <SectionGroup name="scene-renderer">
      <LiveFamilyVisibility />
      {rootNodes.map((nodeId) => (
        <NodeRenderer key={nodeId} nodeId={nodeId} />
      ))}
    </SectionGroup>
  )
}
