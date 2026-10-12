'use client'

import { useScene } from '@pascal-app/core'
import { useEffect } from 'react'
import { createSlabFeatureDependencyTracker } from '../slab-feature/runtime'
import { createSlabDependencyTracker } from './dependency-tracker'

const SlabSystems = () => {
  useEffect(() => {
    const changedSlabs = createSlabDependencyTracker(useScene.getState().nodes)
    const changedFeatures = createSlabFeatureDependencyTracker(useScene.getState().nodes)
    return useScene.subscribe((state, previous) => {
      if (state.nodes === previous.nodes) return
      for (const id of new Set([...changedSlabs(state.nodes), ...changedFeatures(state.nodes)]))
        state.markDirty(id)
    })
  }, [])

  return null
}

export default SlabSystems
