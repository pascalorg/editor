'use client'

import { isDeckSlab, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { createSlabDependencyTracker } from './dependency-tracker'

const SlabSystems = () => {
  useEffect(() => {
    const changedSlabs = createSlabDependencyTracker(useScene.getState().nodes)
    return useScene.subscribe((state, previous) => {
      if (state.nodes === previous.nodes) return
      for (const id of changedSlabs(state.nodes)) state.markDirty(id)
    })
  }, [])

  // "Framing only" hides the shell, a deck's boards and frame with it, and draws the frame on its
  // own: a deck rebuilds when it flips, so no batched copy of it stays drawn over the frame.
  useEffect(
    () =>
      useViewer.subscribe((state, previous) => {
        if (state.framingOnly === previous.framingOnly) return
        const scene = useScene.getState()
        for (const node of Object.values(scene.nodes))
          if (node.type === 'slab' && isDeckSlab(node, (id) => scene.nodes[id]))
            scene.markDirty(node.id)
      }),
    [],
  )

  return null
}

export default SlabSystems
