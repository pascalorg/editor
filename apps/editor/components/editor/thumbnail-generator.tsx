'use client'

import { emitter, useScene } from '@pascal-app/core'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { uploadProjectThumbnail } from '@/features/community/lib/projects/actions'
import { useProjectStore } from '@/features/community/lib/projects/store'

const THUMBNAIL_WIDTH = 1920
const THUMBNAIL_HEIGHT = 1080
const AUTO_SAVE_DELAY = 10_000

interface ThumbnailGeneratorProps {
  projectId?: string
}

export const ThumbnailGenerator = ({ projectId: propProjectId }: ThumbnailGeneratorProps) => {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const isGenerating = useRef(false)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingAutoRef = useRef(false)

  const generate = useCallback(async (projectId: string) => {
    if (isGenerating.current) {
      console.log('⏸️ Thumbnail generation already in progress')
      return
    }

    isGenerating.current = true
    console.log('📸 Generating thumbnail for project:', projectId)

    try {
      const thumbnailCamera = new THREE.PerspectiveCamera(60, THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT, 0.1, 1000)

      // Check if the site node has a saved camera, otherwise use default isometric position
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

      // Match camera aspect to current canvas so the render looks correct
      const { width, height } = gl.domElement
      thumbnailCamera.aspect = width / height
      thumbnailCamera.updateProjectionMatrix()

      // Render with thumbnail camera — main canvas is never resized
      gl.render(scene, thumbnailCamera)

      // Center-crop the canvas to the thumbnail aspect ratio, then scale — avoids deformation
      const srcAspect = width / height
      const dstAspect = THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT
      let sx = 0, sy = 0, sWidth = width, sHeight = height
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

      offscreen.toBlob(async (blob) => {
        if (blob) {
          console.log('☁️ Uploading thumbnail to storage...')
          const result = await uploadProjectThumbnail(projectId, blob)

          if (result.success) {
            useProjectStore.getState().updateActiveThumbnail(result.data.thumbnail_url)
          } else {
            console.error('❌ Failed to upload thumbnail:', result.error)
          }
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
    const handleGenerateThumbnail = async (event: { projectId: string }) => {
      const projectId = propProjectId || event.projectId
      if (!projectId) {
        console.error('❌ No project ID provided')
        return
      }
      await generate(projectId)
    }

    emitter.on('camera-controls:generate-thumbnail', handleGenerateThumbnail)
    return () => emitter.off('camera-controls:generate-thumbnail', handleGenerateThumbnail)
  }, [generate, propProjectId])

  // Auto-trigger: debounced on scene changes, deferred if tab is hidden
  useEffect(() => {
    if (!propProjectId) return

    const triggerNow = () => generate(propProjectId)

    const scheduleOrDefer = () => {
      if (document.visibilityState === 'visible') {
        triggerNow()
      } else {
        // Tab is hidden — remember to fire when the user comes back
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

    // Subscribe to node changes — any structural edit resets the timer
    const unsubscribe = useScene.subscribe((state, prevState) => {
      if (state.nodes !== prevState.nodes) onSceneChange()
    })

    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [propProjectId, generate])

  return null
}
