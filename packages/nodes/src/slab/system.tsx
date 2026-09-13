'use client'

import { useScene } from '@pascal-app/core'
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

  return null
}

export default SlabSystems
