'use client'

import { emitter } from '@pascal-app/core'
import {
  computeHeroFraming,
  createPlainSnapshotPipeline,
  createSnapshotPipeline,
  GRID_LAYER,
  heroCameraPose,
  SNAPSHOT_MAX_EDGE,
  SNAPSHOT_MIME,
  SNAPSHOT_QUALITY,
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
import { ClippingGroup, type WebGPURenderer } from 'three/webgpu'
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

function clampSnapshotSize(width: number, height: number): { w: number; h: number } {
  const maxEdge = Math.max(width, height)
  if (maxEdge <= SNAPSHOT_MAX_EDGE) return { w: width, h: height }

  const scale = SNAPSHOT_MAX_EDGE / maxEdge
  return { w: Math.round(width * scale), h: Math.round(height * scale) }
}

/**
 * Every directional light re-aimed at the face a capture looks at — from the
 * camera's side of it, 35° above the horizon, a quarter to the camera's
 * left so returns still read — and brightened a little; the returned
 * function puts them back. The lights' own drift toward their theme config
 * (lights.tsx lerps per frame) resumes afterwards.
 */
function aimLightsAtFace(
  scene: THREE.Scene,
  position: readonly [number, number, number],
  target: readonly [number, number, number],
): () => void {
  const aim = new THREE.Vector3(target[0], target[1], target[2])
  const toCamera = new THREE.Vector3(position[0], position[1], position[2]).sub(aim)
  toCamera.y = 0
  if (toCamera.lengthSq() < 1e-9) return () => {}
  toCamera.normalize()
  const left = new THREE.Vector3(0, 1, 0).cross(toCamera).normalize()
  const up = Math.sin((35 * Math.PI) / 180)
  const along = Math.cos((35 * Math.PI) / 180)
  const direction = toCamera
    .clone()
    .multiplyScalar(along)
    .add(new THREE.Vector3(0, up, 0))
    .add(left.multiplyScalar(0.25))
    .normalize()
  const restores: (() => void)[] = []
  scene.traverse((object) => {
    const light = object as THREE.DirectionalLight
    if (!light.isDirectionalLight) return
    const savedPosition = light.position.clone()
    const savedTarget = light.target.position.clone()
    const savedIntensity = light.intensity
    light.position.copy(aim.clone().add(direction.clone().multiplyScalar(150)))
    light.target.position.copy(aim)
    light.target.updateMatrixWorld()
    light.updateMatrixWorld()
    light.intensity = savedIntensity * 1.15
    restores.push(() => {
      light.position.copy(savedPosition)
      light.target.position.copy(savedTarget)
      light.target.updateMatrixWorld()
      light.updateMatrixWorld()
      light.intensity = savedIntensity
    })
  })
  return () => {
    for (const restore of restores) restore()
  }
}

/**
 * The scene's children gathered under one ClippingGroup carrying `planes`
 * (world space) for the length of a render; the returned function puts
 * them back on the scene. The WebGPU renderer clips only through such
 * groups (there is no renderer-level plane list), and a group added and
 * removed inside one synchronous render never reaches the React tree.
 */
function clipSceneFor(
  scene: THREE.Scene,
  planes: readonly { normal: [number, number, number]; constant: number }[],
): () => void {
  const group = new ClippingGroup()
  group.clippingPlanes = planes.map((p) => new THREE.Plane(new THREE.Vector3(p.normal[0], p.normal[1], p.normal[2]).normalize(), p.constant))
  group.enabled = true
  const children = [...scene.children]
  for (const child of children) group.add(child)
  scene.add(group)
  return () => {
    for (const child of children) scene.add(child)
    scene.remove(group)
  }
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
  // An ORTHOGRAPHIC capture (a sheet's elevation, 2026-09-10) needs its own
  // camera and its own pass — the pipeline binds the camera it was built
  // with — built on first use, kept for the session.
  const orthoCameraRef = useRef<THREE.OrthographicCamera | null>(null)
  const orthoPipelineRef = useRef<SnapshotPipeline | null>(null)
  const orthoPipelineBuild = useRef<Promise<SnapshotPipeline | null> | null>(null)

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
      orthoPipelineRef.current?.dispose()
      orthoPipelineRef.current = null
      orthoPipelineBuild.current = null
    }
  }, [gl, scene])

  /** The orthographic capture camera and its pipeline, built once. */
  const orthoPipeline = useCallback(async (): Promise<{ camera: THREE.OrthographicCamera; pipeline: SnapshotPipeline | null }> => {
    if (!orthoCameraRef.current) {
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000)
      cam.layers.disable(EDITOR_LAYER)
      cam.layers.disable(GRID_LAYER)
      orthoCameraRef.current = cam
    }
    const camera = orthoCameraRef.current
    if (!orthoPipelineRef.current) {
      if (!orthoPipelineBuild.current) {
        // the post-processed stack (AO + ink edges) for the orthographic
        // camera — a WebGPU device delivers it; the WebGL fallback never
        // returned a frame from it, so that backend takes the canvas path
        orthoPipelineBuild.current = createSnapshotPipeline({
          renderer: gl as unknown as WebGPURenderer,
          scene,
          camera,
        })
      }
      orthoPipelineRef.current = await orthoPipelineBuild.current
    }
    return { camera, pipeline: orthoPipelineRef.current }
  }, [gl, scene])

  const generate = useCallback(
    async (
      snapLevels: boolean,
      captureMode?: 'standard' | 'viewport' | 'area',
      cropRegion?: { x: number; y: number; width: number; height: number },
      standardSize?: { w: number; h: number },
      transparent = false,
      // the ink edges the caller wants, else the canvas' (preset / item
      // captures with alpha stay clean) — a sheet's elevation asks for them
      edgesOverride?: 'off' | 'soft' | 'strong',
      // an ORTHOGRAPHIC view of the caller's own: the capture camera stands
      // at `position` looking at `target` with `viewWidth` metres across the
      // frame — the user's camera never moves and nothing is animated (a
      // sheet's elevation; 2026-09-10: switching the main camera's projection
      // recreated the controls at the default pose and the capture showed it)
      ortho?: { position: [number, number, number]; target: [number, number, number]; viewWidth: number },
      // node types hidden for this capture besides the helpers (a sheet's
      // elevation hides the site's terrain: a solid ground band edge-on)
      hideTypes: readonly string[] = [],
      // a PERSPECTIVE view of the caller's own (a sheet's cover view): the
      // capture camera stands at `position` looking at `target` — no
      // animation of the user's camera, so the frame is never caught
      // mid-flight (2026-09-10: the cover came out looking down at a roof)
      perspective?: { position: [number, number, number]; target: [number, number, number]; fov?: number },
      // the sun re-aimed for this frame: from the camera's side, 35° up and
      // a touch to the left, so the face the sheet shows is lit evenly
      // (Steve, 2026-09-10: "ensure the light is bright on the elevation
      // face") — restored right after the render
      lightFace = false,
      // WORLD clipping planes for this frame (a sheet's section: the cut) —
      // the WebGPU renderer clips through ClippingGroup objects, so the
      // scene's children stand in one for the render and come back after
      clip: readonly { normal: [number, number, number]; constant: number }[] = [],
    ) => {
      const standardW = standardSize?.w ?? THUMBNAIL_WIDTH
      const standardH = standardSize?.h ?? THUMBNAIL_HEIGHT
      // dev: the capture handshake on `window.__pascalCaptureTrace`, for a probe
      const trace = (step: string, data?: unknown) => {
        if (process.env.NODE_ENV === 'production') return
        const w = window as unknown as { __pascalCaptureTrace?: unknown[] }
        ;(w.__pascalCaptureTrace ??= []).push({ t: Math.round(performance.now()), step, data })
      }
      trace('generate', { captureMode, ortho: !!ortho, busy: isGenerating.current, callback: !!onThumbnailCaptureRef.current })
      if (isGenerating.current) {
        console.warn('[thumbnail] a capture is still in flight — this request is dropped')
        return
      }
      if (!onThumbnailCaptureRef.current) return

      isGenerating.current = true
      // a capture that never settles (a GPU readback that never returns)
      // must not hold the guard for the session
      const watchdog = setTimeout(() => {
        if (isGenerating.current) {
          console.warn('[thumbnail] capture watchdog released the guard after 30 s')
          isGenerating.current = false
        }
      }, 30000)

      try {
        const perspectiveCamera = thumbnailCameraRef.current
        if (!perspectiveCamera) return
        const { width, height } = gl.domElement
        const edges = edgesOverride ?? (transparent ? 'off' : useViewer.getState().edges)

        // A caller's own orthographic view, or an orthographic main camera,
        // captures orthographically; the auto-save hero shot stays perspective.
        const wantOrtho = !snapLevels && (ortho !== undefined || mainCamera instanceof THREE.OrthographicCamera)
        let thumbnailCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera = perspectiveCamera
        let pipeline: SnapshotPipeline | null = pipelineRef.current
        if (wantOrtho) {
          // On a WebGPU device the orthographic capture goes through its own
          // post-processed pipeline (AO, ink edges); on the WebGL fallback the
          // offscreen readback never returned, so it renders straight to the
          // canvas and copies it (the fallback path below) — the sheets
          // overlay covers the viewer while it runs.
          const hasDevice = Boolean((gl as unknown as { backend?: { device?: unknown } }).backend?.device)
          // dev: `window.__pascalCaptureCanvasPath = true` forces the canvas path for an A/B
          const forceCanvas =
            process.env.NODE_ENV !== 'production' &&
            (window as unknown as { __pascalCaptureCanvasPath?: boolean }).__pascalCaptureCanvasPath === true
          const built = hasDevice && !forceCanvas ? await orthoPipeline() : null
          if (!orthoCameraRef.current) {
            const created = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000)
            created.layers.disable(EDITOR_LAYER)
            created.layers.disable(GRID_LAYER)
            orthoCameraRef.current = created
          }
          const cam = orthoCameraRef.current
          if (ortho) {
            const halfW = ortho.viewWidth / 2
            const halfH = halfW / (width / height)
            cam.position.set(ortho.position[0], ortho.position[1], ortho.position[2])
            cam.up.set(0, 1, 0)
            cam.lookAt(ortho.target[0], ortho.target[1], ortho.target[2])
            cam.left = -halfW
            cam.right = halfW
            cam.top = halfH
            cam.bottom = -halfH
            cam.zoom = 1
            cam.near = 0.1
            cam.far = 2000
          } else {
            const main = mainCamera as THREE.OrthographicCamera
            cam.position.copy(main.position)
            cam.quaternion.copy(main.quaternion)
            cam.left = main.left
            cam.right = main.right
            cam.top = main.top
            cam.bottom = main.bottom
            cam.zoom = main.zoom
            cam.near = main.near
            cam.far = main.far
          }
          cam.updateProjectionMatrix()
          cam.updateMatrixWorld()
          thumbnailCamera = cam
          pipeline = built?.pipeline ?? null
        } else {
          if (perspective && !snapLevels) {
            perspectiveCamera.position.set(perspective.position[0], perspective.position[1], perspective.position[2])
            perspectiveCamera.up.set(0, 1, 0)
            perspectiveCamera.lookAt(perspective.target[0], perspective.target[1], perspective.target[2])
            perspectiveCamera.fov = perspective.fov ?? 60
            perspectiveCamera.near = 0.1
            perspectiveCamera.far = 2000
          } else {
            // Copy the main camera's transform and projection so the thumbnail
            // matches exactly what the user sees in the viewport.
            perspectiveCamera.position.copy(mainCamera.position)
            perspectiveCamera.quaternion.copy(mainCamera.quaternion)
            if (mainCamera instanceof THREE.PerspectiveCamera) {
              perspectiveCamera.fov = mainCamera.fov
              perspectiveCamera.near = mainCamera.near
              perspectiveCamera.far = mainCamera.far
            }
          }
          perspectiveCamera.aspect = width / height
          perspectiveCamera.updateProjectionMatrix()
          // The capture camera never joins the scene graph, so its matrixWorld
          // is only refreshed by the render itself — too late for the backdrop
          // uniforms below.
          perspectiveCamera.updateMatrixWorld()
        }

        pipeline?.applyEnvironment({
          theme: useViewer.getState().sceneTheme,
          transparent,
          grade: useViewer.getState().shading === 'rendered',
          edges,
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
        const restoreNodeVisibility = temporarilyHideNodeTypes(['scan', 'guide', 'spawn', ...hideTypes])
        const pose = ortho ?? perspective
        const restoreLights = lightFace && pose ? aimLightsAtFace(scene, pose.position, pose.target) : () => {}
        const restoreClip = clip.length > 0 ? clipSceneFor(scene, clip) : () => {}

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
              edges,
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
            trace('capture:start', { ortho: wantOrtho, pipeline: !!pipeline })
            // The scene pass is a FRAME-updated node: it renders once per node
            // frame, and only the animation loop advances that frame. With the
            // viewer idle behind the Sheets overlay two captures share one
            // frame and the second returns the first's picture (2026-09-10:
            // the north elevation came back as the east). Advance it by hand.
            const nodeFrame = (gl as unknown as { _nodes?: { nodeFrame?: { update?: () => void } } })._nodes?.nodeFrame
            nodeFrame?.update?.()
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
            restoreLights()
            restoreClip()
          }

          const result = await capturePromise
          trace('capture:done', { w: result.outW, h: result.outH, bytes: result.blob.size })
          blob = result.blob

          if (captureMode !== undefined) cameraData.captureMode = captureMode
          cameraData.resolution = { w: result.outW, h: result.outH }
        } else {
          // Fallback: plain render directly to the canvas — on a white,
          // transparent clear for the sheets' pictures
          const clearColor = (gl as unknown as { getClearColor: (t: THREE.Color) => THREE.Color }).getClearColor(new THREE.Color())
          const clearAlpha = gl.getClearAlpha()
          const sceneBackground = scene.background
          try {
            emitter.emit('thumbnail:before-capture', undefined)
            if (transparent) {
              scene.background = null
              gl.setClearColor(new THREE.Color('#ffffff'), 0)
            }
            trace('canvas:render', { ortho: wantOrtho })
            gl.render(scene, thumbnailCamera)
          } finally {
            if (transparent) {
              scene.background = sceneBackground
              gl.setClearColor(clearColor, clearAlpha)
            }
            restoreLights()
            restoreClip()
            emitter.emit('thumbnail:after-capture', undefined)
            restoreLevels()
            restoreLevelMode?.()
            restoreNodeVisibility()
          }

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

        trace('callback', { bytes: blob.size })
        onThumbnailCaptureRef.current?.(blob, cameraData)
      } catch (error) {
        trace('error', String(error))
        console.error('❌ Failed to generate thumbnail:', error)
      } finally {
        clearTimeout(watchdog)
        isGenerating.current = false
      }
    },
    [gl, scene, mainCamera, controls, orthoPipeline],
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
      /** The ink edges wanted, else the canvas' setting (off with alpha). */
      edges?: 'off' | 'soft' | 'strong'
      /** An orthographic view of the caller's own — see `generate`. */
      ortho?: { position: [number, number, number]; target: [number, number, number]; viewWidth: number }
      /** Node types hidden for this capture besides the helpers. */
      hideTypes?: readonly string[]
      /** A perspective view of the caller's own — see `generate`. */
      perspective?: { position: [number, number, number]; target: [number, number, number]; fov?: number }
      /** Re-aim the sun at the face the pose looks at, for this frame. */
      lightFace?: boolean
      /** World clipping planes for this frame — see `generate`. */
      clip?: readonly { normal: [number, number, number]; constant: number }[]
    }) => {
      await generate(
        event.snapLevels === true,
        event.captureMode,
        event.cropRegion,
        event.standardSize,
        event.transparent === true,
        event.edges,
        event.ortho,
        event.hideTypes ?? [],
        event.perspective,
        event.lightFace === true,
        event.clip ?? [],
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
