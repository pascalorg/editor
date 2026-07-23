'use client'

import { emitter } from '@pascal-app/core'
import {
  computeHeroFraming,
  createSnapshotPipeline,
  GRID_LAYER,
  heroCameraPose,
  type SnapshotPipeline,
  snapLevelsToTruePositions,
  THUMBNAIL_HEIGHT,
  THUMBNAIL_WIDTH,
  temporarilyHideNodeTypes,
  useViewer,
} from '@pascal-app/viewer'
import type { CameraControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { EDITOR_LAYER } from '../../lib/constants'

export interface SnapshotCameraData {
  position: [number, number, number]
  target: [number, number, number] | null
  type?: 'perspective' | 'orthographic'
  zoom?: number
  captureMode?: 'standard' | 'viewport' | 'area'
  resolution?: { w: number; h: number }
}

interface ThumbnailGeneratorProps {
  onThumbnailCapture?: (blob: Blob, cameraData: SnapshotCameraData) => void
}

export const ThumbnailGenerator = ({ onThumbnailCapture }: ThumbnailGeneratorProps) => {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const mainCamera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls) as CameraControls | null
  const isGenerating = useRef(false)
  const onThumbnailCaptureRef = useRef(onThumbnailCapture)

  const thumbnailCameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const pipelineRef = useRef<SnapshotPipeline | null>(null)

  useEffect(() => {
    onThumbnailCaptureRef.current = onThumbnailCapture
  }, [onThumbnailCapture])

  // Build the thumbnail camera, SSGI pipeline, and render target once — reused on every capture.
  useEffect(() => {
    const cam = new THREE.PerspectiveCamera(60, THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT, 0.1, 1000)
    cam.layers.disable(EDITOR_LAYER)
    cam.layers.disable(GRID_LAYER)
    thumbnailCameraRef.current = cam

    let mounted = true

    const buildPipeline = async () => {
      const pipeline = await createSnapshotPipeline({
        renderer: gl as unknown as WebGPURenderer,
        scene,
        camera: cam,
      })
      if (!mounted) {
        pipeline?.dispose()
        return
      }
      pipelineRef.current = pipeline
    }

    void buildPipeline()

    return () => {
      mounted = false
      pipelineRef.current?.dispose()
      pipelineRef.current = null
    }
  }, [gl, scene])

  const generate = useCallback(
    async (
      snapLevels: boolean,
      captureMode?: 'standard' | 'viewport' | 'area',
      cropRegion?: { x: number; y: number; width: number; height: number },
      standardSize?: { w: number; h: number },
      transparent = false,
    ) => {
      const standardW = standardSize?.w ?? THUMBNAIL_WIDTH
      const standardH = standardSize?.h ?? THUMBNAIL_HEIGHT
      if (isGenerating.current) return
      if (!onThumbnailCaptureRef.current) return

      isGenerating.current = true

      try {
        const thumbnailCamera = thumbnailCameraRef.current
        if (!thumbnailCamera) return

        // Copy the main camera's transform and projection so the thumbnail
        // matches exactly what the user sees in the viewport.
        thumbnailCamera.position.copy(mainCamera.position)
        thumbnailCamera.quaternion.copy(mainCamera.quaternion)
        if (mainCamera instanceof THREE.PerspectiveCamera) {
          thumbnailCamera.fov = mainCamera.fov
          thumbnailCamera.near = mainCamera.near
          thumbnailCamera.far = mainCamera.far
        }
        const { width, height } = gl.domElement
        thumbnailCamera.aspect = width / height
        thumbnailCamera.updateProjectionMatrix()
        // The capture camera never joins the scene graph, so its matrixWorld
        // is only refreshed by the render itself — too late for the backdrop
        // uniforms below.
        thumbnailCamera.updateMatrixWorld()

        const pipeline = pipelineRef.current
        pipeline?.applyEnvironment({
          theme: useViewer.getState().sceneTheme,
          transparent,
          grade: useViewer.getState().shading === 'rendered',
          // Preset/item captures stay clean; scene captures mirror the canvas.
          edges: transparent ? 'off' : useViewer.getState().edges,
          camera: thumbnailCamera,
        })

        // Capture camera data for snapshot storage
        const pos = mainCamera.position
        let tgt: [number, number, number] | null = null
        if (controls && 'getTarget' in controls) {
          const v = new THREE.Vector3()
          ;(controls as any).getTarget(v)
          tgt = [v.x, v.y, v.z]
        }
        const isOrtho = mainCamera instanceof THREE.OrthographicCamera
        const cameraData: SnapshotCameraData = {
          position: [pos.x, pos.y, pos.z],
          target: tgt,
          type: isOrtho ? 'orthographic' : 'perspective',
          ...(isOrtho && { zoom: (mainCamera as THREE.OrthographicCamera).zoom }),
        }

        // For auto-save: snap levels to stacked positions and reset levelMode
        let restoreLevelMode: (() => void) | null = null
        let restoreLevels: () => void = () => {}
        if (snapLevels) {
          const prevMode = useViewer.getState().levelMode
          if (prevMode !== 'stacked') {
            useViewer.getState().setLevelMode('stacked')
            restoreLevelMode = () => useViewer.getState().setLevelMode(prevMode)
          }
          restoreLevels = snapLevelsToTruePositions()
        }

        // Hide scan, guide, and spawn nodes directly so they are excluded from
        // the thumbnail regardless of whether ScanSystem/GuideSystem listeners
        // are registered. Spawn renders on SCENE_LAYER for occlusion, so the
        // thumbnail camera's layer mask can't filter it either. Returns a
        // function that restores the original visibility.
        const restoreNodeVisibility = temporarilyHideNodeTypes(['scan', 'guide', 'spawn'])

        // Auto-save shots don't copy the user's mid-edit camera — they re-pose
        // onto the same computed hero angle the published thumbnail uses, so a
        // project's card never shows a half-zoomed working view. Measured after
        // the level snap so stacked positions frame correctly. User-driven
        // captures (captureMode set) keep the exact viewport pose.
        if (snapLevels) {
          const framing = computeHeroFraming()
          if (framing) {
            const pose = heroCameraPose({
              boxes: framing.boxes,
              aim: framing.aim,
              azimuthRad: framing.azimuthRad,
              aspect: width / height,
            })
            thumbnailCamera.position.set(pose.position[0], pose.position[1], pose.position[2])
            thumbnailCamera.lookAt(pose.target[0], pose.target[1], pose.target[2])
            thumbnailCamera.updateMatrixWorld()
            pipeline?.applyEnvironment({
              theme: useViewer.getState().sceneTheme,
              transparent,
              grade: useViewer.getState().shading === 'rendered',
              edges: transparent ? 'off' : useViewer.getState().edges,
              camera: thumbnailCamera,
            })
            cameraData.position = pose.position
            cameraData.target = pose.target
          }
        }

        let blob: Blob

        if (pipeline) {
          let capturePromise: ReturnType<SnapshotPipeline['capture']>

          // Notify other systems (wall cutouts, selection manager) to restore
          // their overrides before capture and re-apply them after.
          try {
            emitter.emit('thumbnail:before-capture', undefined)
            capturePromise = pipeline.capture({
              captureMode,
              cropRegion,
              standardSize,
            })
          } finally {
            // Restore level positions, levelMode, and node visibility immediately
            // after the render — before the async GPU readback. Runs in `finally`
            // so a render failure can't leave helpers permanently hidden.
            emitter.emit('thumbnail:after-capture', undefined)
            restoreLevels()
            restoreLevelMode?.()
            restoreNodeVisibility()
          }

          const result = await capturePromise
          blob = result.blob

          if (captureMode !== undefined) cameraData.captureMode = captureMode
          cameraData.resolution = { w: result.outW, h: result.outH }
        } else {
          // Fallback: plain render directly to the canvas
          try {
            emitter.emit('thumbnail:before-capture', undefined)
            gl.render(scene, thumbnailCamera)
          } finally {
            emitter.emit('thumbnail:after-capture', undefined)
            restoreLevels()
            restoreLevelMode?.()
            restoreNodeVisibility()
          }

          let outW: number
          let outH: number

          if (captureMode === 'viewport') {
            outW = width
            outH = height
            const offscreen = document.createElement('canvas')
            offscreen.width = outW
            offscreen.height = outH
            offscreen.getContext('2d')!.drawImage(gl.domElement, 0, 0)
            blob = await new Promise<Blob>((resolve, reject) =>
              offscreen.toBlob(
                (b) => (b ? resolve(b) : reject(new Error('Canvas capture failed'))),
                'image/png',
              ),
            )
          } else if (captureMode === 'area' && cropRegion) {
            const sx = Math.round(cropRegion.x * width)
            const sy = Math.round(cropRegion.y * height)
            outW = Math.round(cropRegion.width * width)
            outH = Math.round(cropRegion.height * height)
            const offscreen = document.createElement('canvas')
            offscreen.width = outW
            offscreen.height = outH
            offscreen
              .getContext('2d')!
              .drawImage(gl.domElement, sx, sy, outW, outH, 0, 0, outW, outH)
            blob = await new Promise<Blob>((resolve, reject) =>
              offscreen.toBlob(
                (b) => (b ? resolve(b) : reject(new Error('Canvas capture failed'))),
                'image/png',
              ),
            )
          } else {
            const srcAspect = width / height
            const dstAspect = standardW / standardH
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
            outW = standardW
            outH = standardH
            const offscreen = document.createElement('canvas')
            offscreen.width = outW
            offscreen.height = outH
            offscreen
              .getContext('2d')!
              .drawImage(gl.domElement, sx, sy, sWidth, sHeight, 0, 0, outW, outH)
            blob = await new Promise<Blob>((resolve, reject) =>
              offscreen.toBlob(
                (b) => (b ? resolve(b) : reject(new Error('Canvas capture failed'))),
                'image/png',
              ),
            )
          }

          if (captureMode !== undefined) cameraData.captureMode = captureMode
          cameraData.resolution = { w: outW, h: outH }
        }

        onThumbnailCaptureRef.current?.(blob, cameraData)
      } catch (error) {
        console.error('❌ Failed to generate thumbnail:', error)
      } finally {
        isGenerating.current = false
      }
    },
    [gl, scene, mainCamera, controls],
  )

  // Thumbnail request via emitter. Two call shapes:
  //  - user-driven capture: `{ projectId, captureMode, cropRegion }` — captures
  //    the current pose with the supplied crop.
  //  - host-driven auto-save: `{ projectId, snapLevels: true }` — snaps levels
  //    to their true positions first for a consistent auto-thumbnail angle.
  // The caller owns policy (when to fire, whether the tab is visible).
  useEffect(() => {
    if (!onThumbnailCapture) return

    const handleGenerateThumbnail = async (event: {
      captureMode?: 'standard' | 'viewport' | 'area'
      cropRegion?: { x: number; y: number; width: number; height: number }
      standardSize?: { w: number; h: number }
      snapLevels?: boolean
      // Preset/item captures keep the alpha channel (their thumbnails compose
      // onto arbitrary palette backgrounds); scene snapshots — studio renders
      // and project thumbnails — composite the theme backdrop + sky.
      transparent?: boolean
    }) => {
      await generate(
        event.snapLevels === true,
        event.captureMode,
        event.cropRegion,
        event.standardSize,
        event.transparent === true,
      )
    }

    emitter.on('camera-controls:generate-thumbnail', handleGenerateThumbnail)
    return () => emitter.off('camera-controls:generate-thumbnail', handleGenerateThumbnail)
  }, [generate, onThumbnailCapture])

  // Go-to-camera: animate camera to a saved snapshot position/target
  useEffect(() => {
    const handler = ({
      position,
      target,
    }: {
      position: [number, number, number]
      target: [number, number, number]
    }) => {
      if (controls && 'setLookAt' in controls) {
        ;(controls as any).setLookAt(
          position[0],
          position[1],
          position[2],
          target[0],
          target[1],
          target[2],
          true,
        )
      }
    }
    emitter.on('camera:go-to-position', handler)
    return () => emitter.off('camera:go-to-position', handler)
  }, [controls])

  return null
}
