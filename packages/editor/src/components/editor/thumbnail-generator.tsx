'use client'

import { emitter, sceneRegistry, useScene } from '@pascal-app/core'
import { SSGI_PARAMS, snapLevelsToTruePositions, useViewer } from '@pascal-app/viewer'
import type { CameraControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { UnsignedByteType } from 'three'
import { ssgi } from 'three/addons/tsl/display/SSGINode.js'
import { denoise } from 'three/examples/jsm/tsl/display/DenoiseNode.js'
import { fxaa } from 'three/examples/jsm/tsl/display/FXAANode.js'
import {
  colorToDirection,
  convertToTexture,
  diffuseColor,
  directionToColor,
  float,
  mrt,
  normalView,
  output,
  pass,
  sample,
  vec4,
} from 'three/tsl'
import { RenderPipeline, RenderTarget, type WebGPURenderer } from 'three/webgpu'
import { EDITOR_LAYER } from '../../lib/constants'

const THUMBNAIL_WIDTH = 1920
const THUMBNAIL_HEIGHT = 1080
const AUTO_SAVE_DELAY = 10_000

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
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingAutoRef = useRef(false)
  const onThumbnailCaptureRef = useRef(onThumbnailCapture)

  const thumbnailCameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const pipelineRef = useRef<RenderPipeline | null>(null)
  const renderTargetRef = useRef<RenderTarget | null>(null)

  useEffect(() => {
    onThumbnailCaptureRef.current = onThumbnailCapture
  }, [onThumbnailCapture])

  // Build the thumbnail camera, SSGI pipeline, and render target once, reused on every capture.
  useEffect(() => {
    const cam = new THREE.PerspectiveCamera(60, THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT, 0.1, 1000)
    cam.layers.disable(EDITOR_LAYER)
    thumbnailCameraRef.current = cam

    let mounted = true

    const buildPipeline = async () => {
      try {
        if ((gl as any).init) await (gl as any).init()
        if (!mounted) return

        // pass() handles MRT internally for all material types, including custom
        // shaders, unlike renderer.setMRT() which crashes on non-NodeMaterials.
        // pass() also respects camera.layers, so EDITOR_LAYER objects are filtered.
        const scenePass = pass(scene, cam)
        scenePass.setMRT(
          mrt({
            output,
            diffuseColor,
            normal: directionToColor(normalView),
          }),
        )

        const scenePassColor = scenePass.getTextureNode('output')
        const scenePassDepth = scenePass.getTextureNode('depth')
        const scenePassNormal = scenePass.getTextureNode('normal')

        scenePass.getTexture('diffuseColor').type = UnsignedByteType
        scenePass.getTexture('normal').type = UnsignedByteType

        const sceneNormal = sample((uv) => colorToDirection(scenePassNormal.sample(uv)))

        const giPass = ssgi(scenePassColor, scenePassDepth, sceneNormal, cam as any)
        giPass.sliceCount.value = SSGI_PARAMS.sliceCount
        giPass.stepCount.value = SSGI_PARAMS.stepCount
        giPass.radius.value = SSGI_PARAMS.radius
        giPass.expFactor.value = SSGI_PARAMS.expFactor
        giPass.thickness.value = SSGI_PARAMS.thickness
        giPass.backfaceLighting.value = SSGI_PARAMS.backfaceLighting
        giPass.aoIntensity.value = SSGI_PARAMS.aoIntensity
        giPass.giIntensity.value = SSGI_PARAMS.giIntensity
        giPass.useLinearThickness.value = SSGI_PARAMS.useLinearThickness
        giPass.useScreenSpaceSampling.value = SSGI_PARAMS.useScreenSpaceSampling
        giPass.useTemporalFiltering = SSGI_PARAMS.useTemporalFiltering

        const giTexture = (giPass as any).getTextureNode()
        const aoAsRgb = vec4(giTexture.a, giTexture.a, giTexture.a, float(1))
        const denoisePass = denoise(aoAsRgb, scenePassDepth, sceneNormal, cam)
        denoisePass.index.value = 0
        denoisePass.radius.value = 4

        const ao = (denoisePass as any).r
        const finalOutput = vec4(scenePassColor.rgb.mul(ao), scenePassColor.a)

        // FXAA requires a texture node as input, convertToTexture renders finalOutput
        // into an intermediate RT so FXAA can sample it with neighbor UV offsets.
        const aaOutput = fxaa(convertToTexture(finalOutput))

        const pipeline = new RenderPipeline(gl as unknown as WebGPURenderer)
        pipeline.outputNode = aaOutput
        pipelineRef.current = pipeline

        // Dedicated render target, pipeline outputs here instead of the canvas,
        // so R3F's main render loop can never overwrite our capture.
        const { width, height } = gl.domElement
        renderTargetRef.current = new RenderTarget(width, height, { depthBuffer: true })
      } catch (error) {
        console.error(
          '[thumbnail] Failed to build post-processing pipeline, will use fallback render.',
          error,
        )
      }
    }

    buildPipeline()

    return () => {
      mounted = false
      pipelineRef.current?.dispose()
      pipelineRef.current = null
      renderTargetRef.current?.dispose()
      renderTargetRef.current = null
    }
  }, [gl, scene])

  const generate = useCallback(
    async (
      snapLevels: boolean,
      captureMode?: 'standard' | 'viewport' | 'area',
      cropRegion?: { x: number; y: number; width: number; height: number },
    ) => {
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

        // Capture camera data for snapshot storage.
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

        // For auto-save, snap levels to stacked positions and reset levelMode.
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

        // Hide scan and guide nodes directly so they are excluded from the
        // thumbnail regardless of whether ScanSystem or GuideSystem listeners are
        // registered. Returns a function that restores the original visibility.
        const restoreNodeVisibility = (() => {
          const saved = new Map<THREE.Object3D, boolean>()
          for (const type of ['scan', 'guide'] as const) {
            const ids = sceneRegistry.byType[type]
            ids.forEach((id) => {
              const node = sceneRegistry.nodes.get(id)
              if (node) {
                saved.set(node, node.visible)
                node.visible = false
              }
            })
          }
          return () => {
            saved.forEach((wasVisible, node) => {
              node.visible = wasVisible
            })
          }
        })()

        let blob: Blob

        if (pipelineRef.current && renderTargetRef.current) {
          const rt = renderTargetRef.current

          // Resize RT if the canvas dimensions changed.
          if (rt.width !== width || rt.height !== height) {
            rt.setSize(width, height)
          }

          const renderer = gl as unknown as WebGPURenderer

          // Notify other systems (wall cutouts, selection manager) to restore
          // their overrides before capture and re-apply them after.
          emitter.emit('thumbnail:before-capture', undefined)
          ;(renderer as any).setClearAlpha(0)
          renderer.setRenderTarget(rt)
          pipelineRef.current.render()
          renderer.setRenderTarget(null)
          emitter.emit('thumbnail:after-capture', undefined)

          // Restore level positions, levelMode, and node visibility immediately after the
          // render, before the async GPU readback.
          restoreLevels()
          restoreLevelMode?.()
          restoreNodeVisibility()

          // Read pixels from the RT asynchronously.
          // WebGPU copyTextureToBuffer aligns each row to 256 bytes, so we must
          // depad the rows before constructing ImageData.
          const pixels = (await (renderer as any).readRenderTargetPixelsAsync(
            rt,
            0,
            0,
            width,
            height,
          )) as Uint8Array

          const actualBytesPerRow = width * 4
          const paddedBytesPerRow = Math.ceil(actualBytesPerRow / 256) * 256
          let tightPixels: Uint8ClampedArray
          if (paddedBytesPerRow === actualBytesPerRow) {
            tightPixels = new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength)
          } else {
            tightPixels = new Uint8ClampedArray(width * height * 4)
            for (let row = 0; row < height; row++) {
              tightPixels.set(
                pixels.subarray(
                  row * paddedBytesPerRow,
                  row * paddedBytesPerRow + actualBytesPerRow,
                ),
                row * actualBytesPerRow,
              )
            }
          }

          const imageData = new ImageData(
            tightPixels as unknown as Uint8ClampedArray<ArrayBuffer>,
            width,
            height,
          )
          const srcCanvas = new OffscreenCanvas(width, height)
          srcCanvas.getContext('2d')!.putImageData(imageData, 0, 0)

          let outW: number
          let outH: number

          if (captureMode === 'viewport') {
            outW = width
            outH = height
            const offscreen = new OffscreenCanvas(outW, outH)
            offscreen.getContext('2d')!.drawImage(srcCanvas, 0, 0)
            blob = await offscreen.convertToBlob({ type: 'image/png' })
          } else if (captureMode === 'area' && cropRegion) {
            const sx = Math.round(cropRegion.x * width)
            const sy = Math.round(cropRegion.y * height)
            outW = Math.round(cropRegion.width * width)
            outH = Math.round(cropRegion.height * height)
            const offscreen = new OffscreenCanvas(outW, outH)
            offscreen.getContext('2d')!.drawImage(srcCanvas, sx, sy, outW, outH, 0, 0, outW, outH)
            blob = await offscreen.convertToBlob({ type: 'image/png' })
          } else {
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
            outW = THUMBNAIL_WIDTH
            outH = THUMBNAIL_HEIGHT
            const offscreen = new OffscreenCanvas(outW, outH)
            offscreen
              .getContext('2d')!
              .drawImage(srcCanvas, sx, sy, sWidth, sHeight, 0, 0, outW, outH)
            blob = await offscreen.convertToBlob({ type: 'image/png' })
          }

          if (captureMode !== undefined) cameraData.captureMode = captureMode
          cameraData.resolution = { w: outW, h: outH }
        } else {
          // Fallback: plain render directly to the canvas.
          emitter.emit('thumbnail:before-capture', undefined)
          gl.render(scene, thumbnailCamera)
          emitter.emit('thumbnail:after-capture', undefined)
          restoreLevels()
          restoreLevelMode?.()
          restoreNodeVisibility()

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
            outW = THUMBNAIL_WIDTH
            outH = THUMBNAIL_HEIGHT
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
  //  - user-driven capture: `{ projectId, captureMode, cropRegion }`, captures
  //    the current pose with the supplied crop.
  //  - auto-save capture: `{ projectId, snapLevels: true }`, snaps levels to
  //    their true positions first for a consistent auto-thumbnail angle.
  useEffect(() => {
    if (!onThumbnailCapture) return

    const handleGenerateThumbnail = async (event: {
      captureMode?: 'standard' | 'viewport' | 'area'
      cropRegion?: { x: number; y: number; width: number; height: number }
      snapLevels?: boolean
    }) => {
      await generate(event.snapLevels === true, event.captureMode, event.cropRegion)
    }

    emitter.on('camera-controls:generate-thumbnail', handleGenerateThumbnail)
    return () => emitter.off('camera-controls:generate-thumbnail', handleGenerateThumbnail)
  }, [generate, onThumbnailCapture])

  // OSS adaptation: keep local debounced auto-capture behavior because the
  // community host-side autosave hook is not part of this repo.
  useEffect(() => {
    if (!onThumbnailCapture) return

    const triggerNow = () => {
      void generate(true)
    }

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
  }, [generate, onThumbnailCapture])

  // Go-to-camera: animate camera to a saved snapshot position or target.
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
