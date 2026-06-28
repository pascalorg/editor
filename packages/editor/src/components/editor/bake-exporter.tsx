'use client'

import { useScene } from '@pascal-app/core'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { exportSceneToGlb } from '../../lib/glb-export'

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
        const sceneGroup = scene.getObjectByName('scene-renderer')
        if (!sceneGroup) throw new Error('scene-renderer group not found')
        const buffer = await exportSceneToGlb(sceneGroup, useScene.getState().nodes)
        onComplete(buffer)
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err))
      }
    }
    void run()
  }, [active, scene, onComplete, onError])
  return null
}
