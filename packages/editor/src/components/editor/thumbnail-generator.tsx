'use client'

import {
  type AnyNodeId,
  emitter,
  sceneRegistry,
  type ThumbnailGenerateEvent,
  useScene,
} from '@pascal-app/core'
import {
  computeHeroFraming,
  createSnapshotPipeline,
  GRID_LAYER,
  getVisibleWallMaterials,
  heroCameraPose,
  SNAPSHOT_MAX_EDGE,
  SNAPSHOT_MIME,
  SNAPSHOT_QUALITY,
  type SnapshotPipeline,
  snapLevelsToTruePositions,
  THUMBNAIL_HEIGHT,
  THUMBNAIL_WIDTH,
  temporarilyHideNodeTypes,
  temporarilyShowShadowOnly,
  useViewer,
} from '@pascal-app/viewer'
import type { CameraControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { EDITOR_LAYER } from '../../lib/constants'
import {
  applySnapshotCapturePose,
  captureSnapshotScene,
  createSnapshotQueue,
  enqueueSnapshotCapture,
  runSnapshotCapture,
} from './snapshot-capture'

export interface SnapshotCameraData {
  requestId?: string
  position: [number, number, number]
  quaternion?: [number, number, number, number]
  fov?: number
  target: [number, number, number] | null
  type?: 'perspective' | 'orthographic'
  zoom?: number
  captureMode?: 'standard' | 'viewport' | 'area'
  resolution?: { w: number; h: number }
}

interface ThumbnailGeneratorProps {
  onThumbnailCapture?: (blob: Blob, cameraData: SnapshotCameraData) => void
}

/** Metres ahead of a controls-less camera to place the stored snapshot target. */
const FIRST_PERSON_TARGET_DISTANCE = 8

function clampSnapshotSize(width: number, height: number): { w: number; h: number } {
  const maxEdge = Math.max(width, height)
  if (maxEdge <= SNAPSHOT_MAX_EDGE) return { w: width, h: height }

  const scale = SNAPSHOT_MAX_EDGE / maxEdge
  return { w: Math.round(width * scale), h: Math.round(height * scale) }
}

export const ThumbnailGenerator = ({ onThumbnailCapture }: ThumbnailGeneratorProps) => {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const getThree = useThree((state) => state.get)
  const controls = useThree((state) => state.controls) as CameraControls | null
  const isGenerating = useRef(false)
  const captureQueue = useRef(createSnapshotQueue())
  const onThumbnailCaptureRef = useRef(onThumbnailCapture)

  const thumbnailCameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const pipelineRef = useRef<SnapshotPipeline | null>(null)
  const captureVersion = useRef(0)

  useEffect(() => {
    onThumbnailCaptureRef.current = onThumbnailCapture
  }, [onThumbnailCapture])

  // Build the thumbnail camera, SSGI pipeline, and render target once — reused on every capture.
  useEffect(() => {
    captureVersion.current += 1
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
      captureVersion.current += 1
      thumbnailCameraRef.current = null
      pipelineRef.current?.dispose()
      pipelineRef.current = null
    }
  }, [gl, scene])

  const generate = useCallback(
    async (event: ThumbnailGenerateEvent) => {
      const { captureMode, cropRegion, standardSize, cameraPose, requestId } = event
      const snapLevels = event.snapLevels === true
      const transparent = event.transparent === true
      const standardW = standardSize?.w ?? THUMBNAIL_WIDTH
      const standardH = standardSize?.h ?? THUMBNAIL_HEIGHT
      await runSnapshotCapture(
        requestId,
        isGenerating,
        async () => {
          const version = captureVersion.current
          const onCapture = onThumbnailCaptureRef.current
          if (!onCapture) throw new Error('Snapshot storage is unavailable')
          if (cameraPose && event.projectId !== useViewer.getState().projectId)
            throw new Error('The active project changed before capture')
          const thumbnailCamera = thumbnailCameraRef.current
          if (!thumbnailCamera) throw new Error('Snapshot camera is not ready')
          const { camera: mainCamera, controls } = getThree()
          if (cameraPose && (snapLevels || (captureMode && captureMode !== 'standard'))) {
            throw new Error('An explicit snapshot camera requires standard capture mode')
          }
          if (cameraPose && !pipelineRef.current) {
            throw new Error('Snapshot renderer is not ready. Try again.')
          }

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
          if (cameraPose) {
            applySnapshotCapturePose(
              thumbnailCamera,
              cameraPose,
              { width, height },
              {
                w: standardW,
                h: standardH,
              },
            )
          }
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
          const pos = cameraPose ? thumbnailCamera.position : mainCamera.position
          let tgt: [number, number, number] | null = null
          if (!cameraPose && controls && 'getTarget' in controls) {
            const v = new THREE.Vector3()
            ;(controls as any).getTarget(v)
            tgt = [v.x, v.y, v.z]
          } else {
            // Walk / drone captures run without orbit controls, so there is no orbit
            // target to read. Synthesize one down the view axis — otherwise the
            // saved snapshot carries no framing to return to.
            const look = new THREE.Vector3(0, 0, -1)
              .applyQuaternion(cameraPose ? thumbnailCamera.quaternion : mainCamera.quaternion)
              .multiplyScalar(FIRST_PERSON_TARGET_DISTANCE)
              .add(pos)
            tgt = [look.x, look.y, look.z]
          }
          const isOrtho = !cameraPose && mainCamera instanceof THREE.OrthographicCamera
          const cameraData: SnapshotCameraData = {
            ...(requestId && { requestId }),
            position: [pos.x, pos.y, pos.z],
            ...(cameraPose && {
              quaternion: [...cameraPose.quaternion] as [number, number, number, number],
              fov: cameraPose.fov,
            }),
            target: tgt,
            type: isOrtho ? 'orthographic' : 'perspective',
            ...(isOrtho && { zoom: (mainCamera as THREE.OrthographicCamera).zoom }),
          }

          const capturePromise = captureSnapshotScene((restore) => {
            if (snapLevels) {
              const prevMode = useViewer.getState().levelMode
              if (prevMode !== 'stacked') {
                restore(() => useViewer.getState().setLevelMode(prevMode))
                useViewer.getState().setLevelMode('stacked')
              }
              restore(snapLevelsToTruePositions())
            }
            restore(temporarilyHideNodeTypes(['scan', 'guide', 'spawn']))

            // Auto-save uses the published hero framing. An authored shot keeps
            // its own camera while sharing the same true level positions.
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

            restore(() => emitter.emit('thumbnail:after-capture', undefined))
            emitter.emit('thumbnail:before-capture', undefined)
            if (cameraPose) {
              restore(snapLevelsToTruePositions())
              restore(temporarilyShowShadowOnly(scene))
              const wallMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
              restore(() => {
                for (const [mesh, material] of wallMaterials) mesh.material = material
              })
              const state = useScene.getState()
              const viewer = useViewer.getState()
              for (const id of sceneRegistry.byType.wall ?? []) {
                const node = state.nodes[id as AnyNodeId]
                const mesh = sceneRegistry.nodes.get(id) as THREE.Mesh | undefined
                if (node?.type !== 'wall' || !mesh?.isMesh) continue
                wallMaterials.set(mesh, mesh.material)
                mesh.material = getVisibleWallMaterials(
                  node,
                  viewer.shading,
                  viewer.textures,
                  viewer.colorPreset,
                  viewer.sceneTheme,
                  state.materials,
                )
              }
            }

            if (pipeline) return pipeline.capture({ captureMode, cropRegion, standardSize })
            gl.render(scene, thumbnailCamera)
            return undefined
          })

          let blob: Blob
          if (pipeline) {
            const result = await capturePromise
            if (!result) throw new Error('Snapshot capture produced no image')
            blob = result.blob
            if (captureMode !== undefined) cameraData.captureMode = captureMode
            cameraData.resolution = { w: result.outW, h: result.outH }
          } else {
            await capturePromise
            let outW: number
            let outH: number

            if (captureMode === 'viewport') {
              ;({ w: outW, h: outH } = clampSnapshotSize(width, height))
              const offscreen = document.createElement('canvas')
              offscreen.width = outW
              offscreen.height = outH
              const ctx = offscreen.getContext('2d')!
              if (outW !== width || outH !== height) ctx.imageSmoothingQuality = 'high'
              ctx.drawImage(gl.domElement, 0, 0, width, height, 0, 0, outW, outH)
              blob = await new Promise<Blob>((resolve, reject) =>
                offscreen.toBlob(
                  (b) => (b ? resolve(b) : reject(new Error('Canvas capture failed'))),
                  SNAPSHOT_MIME,
                  SNAPSHOT_QUALITY,
                ),
              )
            } else if (captureMode === 'area' && cropRegion) {
              const sx = Math.round(cropRegion.x * width)
              const sy = Math.round(cropRegion.y * height)
              const sourceW = Math.round(cropRegion.width * width)
              const sourceH = Math.round(cropRegion.height * height)
              ;({ w: outW, h: outH } = clampSnapshotSize(sourceW, sourceH))
              const offscreen = document.createElement('canvas')
              offscreen.width = outW
              offscreen.height = outH
              const ctx = offscreen.getContext('2d')!
              if (outW !== sourceW || outH !== sourceH) ctx.imageSmoothingQuality = 'high'
              ctx.drawImage(gl.domElement, sx, sy, sourceW, sourceH, 0, 0, outW, outH)
              blob = await new Promise<Blob>((resolve, reject) =>
                offscreen.toBlob(
                  (b) => (b ? resolve(b) : reject(new Error('Canvas capture failed'))),
                  SNAPSHOT_MIME,
                  SNAPSHOT_QUALITY,
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
                  SNAPSHOT_MIME,
                  SNAPSHOT_QUALITY,
                ),
              )
            }

            if (captureMode !== undefined) cameraData.captureMode = captureMode
            cameraData.resolution = { w: outW, h: outH }
          }

          if (
            version !== captureVersion.current ||
            thumbnailCamera !== thumbnailCameraRef.current
          ) {
            throw new Error('The scene changed during capture. Try again.')
          }
          if (cameraPose && event.projectId !== useViewer.getState().projectId) {
            throw new Error('The active project changed during capture')
          }
          await onCapture(blob, cameraData)
        },
        (failure) => emitter.emit('snapshot:capture-failed', failure),
      )
    },
    [gl, scene, getThree],
  )

  // Thumbnail request via emitter. Two call shapes:
  //  - user-driven capture: `{ projectId, captureMode, cropRegion }` — captures
  //    the current pose with the supplied crop.
  //  - host-driven auto-save: `{ projectId, snapLevels: true }` — snaps levels
  //    to their true positions first for a consistent auto-thumbnail angle.
  // The caller owns policy (when to fire, whether the tab is visible).
  useEffect(() => {
    const handleGenerateThumbnail = async (event: ThumbnailGenerateEvent) => {
      // A saved-frame notification can enqueue the next shot frame before
      // its predecessor's host callback returns and releases the renderer.
      await enqueueSnapshotCapture(
        captureQueue.current,
        captureVersion,
        event,
        generate,
        (failure) => emitter.emit('snapshot:capture-failed', failure),
      )
    }

    emitter.on('camera-controls:generate-thumbnail', handleGenerateThumbnail)
    return () => {
      emitter.off('camera-controls:generate-thumbnail', handleGenerateThumbnail)
    }
  }, [generate])

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
