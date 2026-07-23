'use client'

import {
  computeHeroFraming,
  createSnapshotPipeline,
  GRID_LAYER,
  heroCameraPose,
  temporarilyHideNodeTypes,
  useViewer,
} from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { PerspectiveCamera } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { EDITOR_LAYER } from '../../lib/constants'

export function BakeThumbnail({
  active,
  onComplete,
  onError,
}: {
  active: boolean
  onComplete: (blob: Blob, size: { w: number; h: number }) => void
  onError: (message: string) => void
}) {
  const renderer = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const doneRef = useRef(false)

  useEffect(() => {
    if (!(active && !doneRef.current)) return
    doneRef.current = true

    const run = async () => {
      const restoreNodeVisibility = temporarilyHideNodeTypes(['scan', 'guide', 'spawn'])
      let pipeline: Awaited<ReturnType<typeof createSnapshotPipeline>> = null

      try {
        const framing = computeHeroFraming()
        if (!framing) {
          onError('scene has no framable content')
          return
        }

        const { width, height } = renderer.domElement
        const aspect = width / height
        const camera = new PerspectiveCamera(60, aspect, 0.1, 1000)
        camera.layers.disable(EDITOR_LAYER)
        camera.layers.disable(GRID_LAYER)
        const pose = heroCameraPose({
          boxes: framing.boxes,
          aim: framing.aim,
          azimuthRad: framing.azimuthRad,
          aspect,
        })
        camera.position.set(pose.position[0], pose.position[1], pose.position[2])
        camera.lookAt(pose.target[0], pose.target[1], pose.target[2])
        camera.updateMatrixWorld()

        pipeline = await createSnapshotPipeline({
          renderer: renderer as unknown as WebGPURenderer,
          scene,
          camera,
        })
        if (!pipeline) {
          onError('thumbnail pipeline failed to build')
          return
        }

        pipeline.applyEnvironment({
          theme: useViewer.getState().sceneTheme,
          transparent: false,
          grade: true,
          edges: useViewer.getState().edges,
          camera,
        })
        const { blob, outW, outH } = await pipeline.capture({ captureMode: 'standard' })
        onComplete(blob, { w: outW, h: outH })
      } catch (error) {
        console.error(
          '[bake-thumbnail]',
          error instanceof Error ? (error.stack ?? error.message) : error,
        )
        onError(error instanceof Error ? error.message : String(error))
      } finally {
        pipeline?.dispose()
        restoreNodeVisibility()
      }
    }

    void run()
  }, [active, onComplete, onError, renderer, scene])

  return null
}
