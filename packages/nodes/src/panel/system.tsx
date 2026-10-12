'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { subscribeWallRebuilds } from '@pascal-app/viewer'
import { useEffect } from 'react'

/**
 * A panel's depth comes from its wall's thickness, and nothing marks a wall's
 * children dirty when the wall changes — so a rebuilt wall rebuilds its panels.
 */
const PanelHostSystem = () => {
  useEffect(
    () =>
      subscribeWallRebuilds((wallId) => {
        const scene = useScene.getState()
        const wall = scene.nodes[wallId as AnyNodeId]
        if (wall?.type !== 'wall') return
        for (const childId of wall.children)
          if (scene.nodes[childId as AnyNodeId]?.type === 'panel')
            scene.markDirty(childId as AnyNodeId)
      }),
    [],
  )
  return null
}

export default PanelHostSystem
