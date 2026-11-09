'use client'

import { emitter, useScene } from '@pascal-app/core'
import { useEffect } from 'react'

export function useThumbnailAutosave({ sceneId, enabled }: { sceneId: string; enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return

    let armed = false
    let dirty = false
    let lastChange = 0
    const unsubscribe = useScene.subscribe((state, previous) => {
      if (state.nodes === previous.nodes) return
      // The first nodes swap hydrates the scene; it is not an edit.
      if (!armed) {
        armed = true
        return
      }
      dirty = true
      lastChange = Date.now()
    })

    const capture = () => {
      if (!dirty || document.visibilityState !== 'visible' || Date.now() - lastChange < 5000) return
      dirty = false
      emitter.emit('camera-controls:generate-thumbnail', { projectId: sceneId, snapLevels: true })
    }
    const interval = setInterval(capture, 30_000)
    document.addEventListener('visibilitychange', capture)
    return () => {
      unsubscribe()
      clearInterval(interval)
      document.removeEventListener('visibilitychange', capture)
    }
  }, [sceneId, enabled])
}
