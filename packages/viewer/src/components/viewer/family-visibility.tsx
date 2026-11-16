'use client'

import { type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { createFamilyVisibility, xrayActive } from '../../lib/xray'
import useViewer from '../../store/use-viewer'

/** Native semantic roots, including roots mounted by lazy plugin renderers. */
export function LiveFamilyVisibility() {
  const scene = useThree((state) => state.scene)
  const invalidate = useThree((state) => state.invalidate)
  const visibility = useMemo(createFamilyVisibility, [])
  const wasActive = useRef(false)
  const update = useCallback(() => {
    const state = useViewer.getState()
    if (!xrayActive(state) && !wasActive.current) return
    wasActive.current = xrayActive(state)
    const owners = new Map([...sceneRegistry.nodes].map(([id, object]) => [object, id]))
    visibility.update(
      scene,
      (object) => {
        const id = owners.get(object)
        return id ? useScene.getState().nodes[id as AnyNodeId] : undefined
      },
      state,
    )
  }, [scene, visibility])
  useFrame(update, 0.9)
  useLayoutEffect(() => {
    const unsubscribe = useViewer.subscribe((state, previous) => {
      if (
        state.xrayFamily !== previous.xrayFamily ||
        state.walkthroughMode !== previous.walkthroughMode
      ) {
        update()
        invalidate()
      }
    })
    update()
    return () => {
      unsubscribe()
      visibility.clear()
    }
  }, [visibility, invalidate, update])
  return null
}
