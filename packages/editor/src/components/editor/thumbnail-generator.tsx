'use client'

import { emitter, sceneRegistry, useScene } from '@vesper/core'
import { snapLevelsToTruePositions } from '@vesper/viewer'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { EDITOR_LAYER } from '../../lib/constants'

const THUMBNAIL_WIDTH = 1920
const THUMBNAIL_HEIGHT = 1080
const AUTO_SAVE_DELAY = 10_000

interface ThumbnailGeneratorProps {
  onThumbnailCapture?: (blob: Blob) => void
}

export const ThumbnailGenerator = ({ onThumbnailCapture }: ThumbnailGeneratorProps) => {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const isGenerating = useRef(false)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingAutoRef = useRef(false)
  const onThumbnailCaptureRef = useRef(onThumbnailCapture)

  useEffect(() => {
    onThumbnailCaptureRef.current = onThumbnailCapture
  }, [onThumbnailCapture])

  const generate = useCallback(async () => {
    if (isGenerating.current) return
    if (!onThumbnailCaptureRef.current) return

    isGenerating.current = true

    try {
      const thumbnailCamera = new THREE.PerspectiveCamera(
        60,
        THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT,
        0.1,
        1000,
      )

      const nodes = useScene.getState().nodes
      const siteNode = Object.values(nodes).find((n) => n.type === 'site')

      if (siteNode?.camera) {
        const { position, target } = siteNode.camera
        thumbnailCamera.position.set(position[0], position[1], position[2])
        thumbnailCamera.lookAt(target[0], target[1], target[2])
      } else {
        thumbnailCamera.position.set(8, 8, 8)
        thumbnailCamera.lookAt(0, 0, 0)
      }
      thumbnailCamera.layers.disable(EDITOR_LAYER)

      const { width, height } = gl.domElement
      thumbnailCamera.aspect = width / height
      thumbnailCamera.updateProjectionMatrix()

      const restoreLevels = snapLevelsToTruePositions()

      const visibilitySnapshot = new Map<string, boolean>()
      for (const type of ['scan', 'guide'] as const) {
        sceneRegistry.byType[type].forEach((id) => {
          const obj = sceneRegistry.nodes.get(id)
          if (obj) {
            visibilitySnapshot.set(id, obj.visible)
            obj.visible = false
          }
        })
      }

      gl.render(scene, thumbnailCamera)

      restoreLevels()
      visibilitySnapshot.forEach((wasVisible, id) => {
        const obj = sceneRegistry.nodes.get(id)
        if (obj) obj.visible = wasVisible
      })

      const srcAspect = width / height
      const dstAspect = THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT
      let sx = 0,
        sy = 0,
        sWidth = width,
        sHeight = height
      if (srcAspect > dstAspect) {
        sWidth = Math.round(height * dstAspect)
        sx = Math.round((width - sWidth) / 2)
      } else if (srcAspect < dstAspect) {
        sHeight = Math.round(width / dstAspect)
        sy = Math.round((height - sHeight) / 2)
      }

      const offscreen = document.createElement('canvas')
      offscreen.width = THUMBNAIL_WIDTH
      offscreen.height = THUMBNAIL_HEIGHT
      const ctx = offscreen.getContext('2d')!
      ctx.drawImage(gl.domElement, sx, sy, sWidth, sHeight, 0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT)

      offscreen.toBlob((blob) => {
        if (blob) {
          onThumbnailCaptureRef.current?.(blob)
        } else {
          console.error('❌ Failed to create blob from canvas')
        }
        isGenerating.current = false
      }, 'image/png')
    } catch (error) {
      console.error('❌ Failed to generate thumbnail:', error)
      isGenerating.current = false
    }
  }, [gl, scene])

  // Manual trigger via emitter
  useEffect(() => {
    const handleGenerateThumbnail = async () => {
      await generate()
    }

    emitter.on('camera-controls:generate-thumbnail', handleGenerateThumbnail)
    return () => emitter.off('camera-controls:generate-thumbnail', handleGenerateThumbnail)
  }, [generate])

  // Auto-trigger: debounced on scene changes, deferred if tab is hidden
  useEffect(() => {
    if (!onThumbnailCapture) return

    const triggerNow = () => generate()

    const scheduleOrDefer = () => {
      if (document.visibilityState === 'visible') {
        triggerNow()
      } else {
        pendingAutoRef.current = true
      }
    }

    const onSceneChange = () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = setTimeout(scheduleOrDefer, AUTO_SAVE_DELAY)
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && pendingAutoRef.current) {
        pendingAutoRef.current = false
        triggerNow()
      }
    }

    const unsubscribe = useScene.subscribe((state, prevState) => {
      if (state.nodes !== prevState.nodes) onSceneChange()
    })

    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [onThumbnailCapture, generate])

  return null
}
