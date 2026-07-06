'use client'

import { useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { exportSceneToGlb } from '../../lib/glb-export'

/** Resolve after the next couple of animation frames, giving React/R3F time to
 * commit and mount export-only geometry (e.g. instanced kinds' real meshes)
 * before the exporter clones the scene graph. */
function nextFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

export function BakeExporter({
  active,
  onComplete,
  onError,
}: {
  active: boolean
  onComplete: (buffer: ArrayBuffer) => void
  onError: (message: string) => void
}) {
  const scene = useThree((s) => s.scene)
  const doneRef = useRef(false)
  useEffect(() => {
    if (!(active && !doneRef.current)) return
    doneRef.current = true
    const run = async () => {
      try {
        // Signal export so instanced kinds (trees/flowers/grass) swap their
        // invisible proxy for real, exportable geometry, then wait for the
        // commit before cloning the scene graph.
        useViewer.getState().setExporting(true)
        await nextFrames()
        const sceneGroup = scene.getObjectByName('scene-renderer')
        if (!sceneGroup) throw new Error('scene-renderer group not found')
        const buffer = await exportSceneToGlb(sceneGroup, useScene.getState().nodes)
        onComplete(buffer)
      } catch (err) {
        // The bake worker relays page console output into the job's error
        // trail; the message alone rarely localises an exporter crash, so
        // surface the full stack here.
        console.error('[bake-exporter]', err instanceof Error ? (err.stack ?? err.message) : err)
        onError(err instanceof Error ? err.message : String(err))
      } finally {
        useViewer.getState().setExporting(false)
      }
    }
    void run()
  }, [active, scene, onComplete, onError])
  return null
}
