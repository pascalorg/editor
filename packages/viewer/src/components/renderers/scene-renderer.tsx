'use client'

import { useScene } from '@pascal-app/core'
import { useMemo } from 'react'
import { ClippingGroup } from 'three/webgpu'
import { sceneClippingPlanes } from '../../lib/scene-clipping'
import { NodeRenderer } from './node-renderer'

export const SceneRenderer = () => {
  const rootNodes = useScene((state) => state.rootNodeIds)

  // The scene root is a ClippingGroup so an active section plane can cut every
  // rendered node. With no planes pushed the group is inert, so this costs
  // nothing until something cuts. Keeps the `scene-renderer` name the GLB
  // exporter and bake path look up.
  const root = useMemo(() => {
    const group = new ClippingGroup()
    group.name = 'scene-renderer'
    group.clippingPlanes = sceneClippingPlanes
    // Cut the shadow pass too, or a sliced-off roof keeps shadowing the
    // interior the cut was opened to reveal.
    group.clipShadows = true
    return group
  }, [])

  return (
    <primitive object={root}>
      {rootNodes.map((nodeId) => (
        <NodeRenderer key={nodeId} nodeId={nodeId} />
      ))}
    </primitive>
  )
}
