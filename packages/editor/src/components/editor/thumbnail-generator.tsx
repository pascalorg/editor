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
import { ClippingGroup, type WebGPURenderer } from 'three/webgpu'
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

/** Longest drawing-buffer edge a supersampled frame may reach. */
const SUPERSAMPLE_MAX_EDGE = 4096

/** A capture that never settles (a GPU readback that never returns) must not hold the queue for the session. */
const CAPTURE_WATCHDOG_MS = 30000

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

/** A yield to the next macrotask through a MessageChannel — unlike a timer, never throttled in a hidden tab. */
function macrotask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })
}

/**
 * Run the frame loop `n` times by hand — the useFrame subscribers and the
 * render — a macrotask apart so React's commits land between the frames.
 * A hidden tab gets no animation frames at all, so a capture that waited on
 * one would hang.
 */
async function pumpFrames(
  advance: (timestamp: number, runGlobalEffects?: boolean) => void,
  clock: { getDelta: () => number },
  n: number,
): Promise<void> {
  for (let i = 0; i < n; i++) {
    // The loop reads the clock's delta for every useFrame — after minutes
    // without a frame (the hidden tab) it would hand them the whole gap.
    clock.getDelta()
    advance(performance.now(), true)
    await macrotask()
  }
}

// TODO(review B8): Bones-specific knowledge (`userData.sourceId === 'utility-plant'`)
// does not belong in the generic generator; move it behind a plugin-owned
// `thumbnail:before-capture` listener or a `hideTypes` entry.
/**
 * Bones' finished-house utility plant (the pole, the overhead drop, the pad
 * transformer — buckets tagged `userData.sourceId = 'utility-plant'`,
 * plugin-bones framing/renderer.tsx) hidden for a capture; the returned
 * function shows it again.
 */
export function hideUtilityPlant(scene: THREE.Scene): () => void {
  const hidden: THREE.Object3D[] = []
  scene.traverse((object) => {
    if ((object.userData as { sourceId?: unknown }).sourceId !== 'utility-plant' || !object.visible)
      return
    object.visible = false
    hidden.push(object)
  })
  return () => {
    for (const object of hidden) object.visible = true
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
  group.clippingPlanes = planes.map(
    (p) =>
      new THREE.Plane(
        new THREE.Vector3(p.normal[0], p.normal[1], p.normal[2]).normalize(),
        p.constant,
      ),
  )
  group.enabled = true
  const children = [...scene.children]
  for (const child of children) group.add(child)
  scene.add(group)
  return () => {
    for (const child of children) scene.add(child)
    scene.remove(group)
  }
}

/**
 * `capture` raced against a timer; `expired()` tells a late-settling capture
 * that its failure was already reported, so it must not deliver a frame.
 */
function withWatchdog<T>(capture: (expired: () => boolean) => Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let expired = false
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true
      reject(new Error(`Snapshot capture did not return within ${Math.round(ms / 1000)} s`))
    }, ms)
  })
  return Promise.race([capture(() => expired), timeout]).finally(() => clearTimeout(timer))
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
  // A host-authored ORTHOGRAPHIC capture (a sheet's elevation) needs its own
  // camera and its own pass — a pipeline binds the camera it was built with.
  // Built on first use, kept for the session.
  const orthoCameraRef = useRef<THREE.OrthographicCamera | null>(null)
  const orthoPipelineRef = useRef<SnapshotPipeline | null>(null)
  const orthoPipelineBuild = useRef<Promise<SnapshotPipeline | null> | null>(null)
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

    const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000)
    orthoCam.layers.disable(EDITOR_LAYER)
    orthoCam.layers.disable(GRID_LAYER)
    orthoCameraRef.current = orthoCam

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
      orthoCameraRef.current = null
      pipelineRef.current?.dispose()
      pipelineRef.current = null
      orthoPipelineRef.current?.dispose()
      orthoPipelineRef.current = null
      orthoPipelineBuild.current = null
    }
  }, [gl, scene])

  /** The orthographic capture pipeline, built once for the session's ortho camera. */
  const getOrthoPipeline = useCallback(
    (camera: THREE.OrthographicCamera): Promise<SnapshotPipeline | null> => {
      if (orthoPipelineRef.current) return Promise.resolve(orthoPipelineRef.current)
      if (!orthoPipelineBuild.current) {
        const version = captureVersion.current
        orthoPipelineBuild.current = createSnapshotPipeline({
          renderer: gl as unknown as WebGPURenderer,
          scene,
          camera,
        }).then((pipeline) => {
          if (version !== captureVersion.current) {
            pipeline?.dispose()
            return null
          }
          orthoPipelineRef.current = pipeline
          return pipeline
        })
      }
      return orthoPipelineBuild.current
    },
    [gl, scene],
  )

  const generate = useCallback(
    async (event: ThumbnailGenerateEvent) => {
      const { captureMode, cropRegion, standardSize, cameraPose, requestId, ortho, perspective } =
        event
      const snapLevels = event.snapLevels === true
      const transparent = event.transparent === true
      const lightFace = event.lightFace === true
      const hideTypes = event.hideTypes ?? []
      const clip = event.clip ?? []
      const supersample = event.supersample ?? 1
      const standardW = standardSize?.w ?? THUMBNAIL_WIDTH
      const standardH = standardSize?.h ?? THUMBNAIL_HEIGHT
      // A host-authored view (a sheet's elevation or cover): the capture
      // camera takes the pose itself, so the user's camera never moves and
      // the frame is never caught mid-animation.
      const authoredPose = ortho ?? perspective
      await runSnapshotCapture(
        requestId,
        isGenerating,
        () =>
          withWatchdog(async (expired) => {
            const version = captureVersion.current
            const onCapture = onThumbnailCaptureRef.current
            if (!onCapture) throw new Error('Snapshot storage is unavailable')
            if ((cameraPose || authoredPose) && event.projectId !== useViewer.getState().projectId)
              throw new Error('The active project changed before capture')
            const perspectiveCamera = thumbnailCameraRef.current
            const orthoCamera = orthoCameraRef.current
            if (!perspectiveCamera || !orthoCamera) throw new Error('Snapshot camera is not ready')
            const { camera: mainCamera, controls, advance, clock } = getThree()
            if (cameraPose && (snapLevels || (captureMode && captureMode !== 'standard'))) {
              throw new Error('An explicit snapshot camera requires standard capture mode')
            }
            if (cameraPose && authoredPose) {
              throw new Error('A snapshot camera pose and an authored view are exclusive')
            }
            if (authoredPose && snapLevels) {
              throw new Error('An authored view cannot snap levels')
            }
            if (cameraPose && !pipelineRef.current) {
              throw new Error('Snapshot renderer is not ready. Try again.')
            }

            if (authoredPose) {
              // Let the viewer's own systems (wall materials, batched
              // renderers) take two real frames first — run by hand, never
              // awaited from the animation loop.
              await pumpFrames(advance, clock, 2)
              if (version !== captureVersion.current) {
                throw new Error('The scene changed during capture. Try again.')
              }
            }

            // A supersampled frame enlarges the drawing buffer only. Save the
            // LOGICAL size and pixel ratio; `setSize(w, h, false)` multiplies by
            // the ratio itself, so restoring with the physical size would
            // compound it.
            const logicalSize = gl.getSize(new THREE.Vector2())
            const pixelRatio = gl.getPixelRatio()
            const physicalEdge = Math.max(gl.domElement.width, gl.domElement.height)
            const scale = Math.max(
              1,
              Math.min(supersample, physicalEdge > 0 ? SUPERSAMPLE_MAX_EDGE / physicalEdge : 1),
            )
            let bufferScaled = false
            const restoreBuffer = () => {
              if (!bufferScaled) return
              bufferScaled = false
              gl.setPixelRatio(pixelRatio)
              gl.setSize(logicalSize.x, logicalSize.y, false)
            }

            try {
              if (scale > 1) {
                bufferScaled = true
                gl.setSize(
                  Math.round(logicalSize.x * scale),
                  Math.round(logicalSize.y * scale),
                  false,
                )
              }
              const { width, height } = gl.domElement

              let thumbnailCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera =
                perspectiveCamera
              let pipeline = pipelineRef.current
              if (ortho) {
                // The SSGI stack delivers for a second camera on a WebGPU
                // device; the WebGL fallback never returned a frame from it,
                // so that backend renders straight to the canvas below.
                const hasDevice = Boolean(
                  (gl as unknown as { backend?: { device?: unknown } }).backend?.device,
                )
                pipeline = hasDevice ? await getOrthoPipeline(orthoCamera) : null
                if (version !== captureVersion.current) {
                  throw new Error('The scene changed during capture. Try again.')
                }
                const halfW = ortho.viewWidth / 2
                const halfH = halfW / (width / height)
                orthoCamera.position.set(ortho.position[0], ortho.position[1], ortho.position[2])
                orthoCamera.up.set(0, 1, 0)
                orthoCamera.lookAt(ortho.target[0], ortho.target[1], ortho.target[2])
                orthoCamera.left = -halfW
                orthoCamera.right = halfW
                orthoCamera.top = halfH
                orthoCamera.bottom = -halfH
                orthoCamera.zoom = 1
                orthoCamera.updateProjectionMatrix()
                orthoCamera.updateMatrixWorld()
                thumbnailCamera = orthoCamera
              } else if (perspective) {
                perspectiveCamera.position.set(
                  perspective.position[0],
                  perspective.position[1],
                  perspective.position[2],
                )
                perspectiveCamera.up.set(0, 1, 0)
                perspectiveCamera.lookAt(
                  perspective.target[0],
                  perspective.target[1],
                  perspective.target[2],
                )
                perspectiveCamera.fov = perspective.fov ?? 60
                perspectiveCamera.near = 0.1
                perspectiveCamera.far = 2000
                perspectiveCamera.aspect = width / height
                perspectiveCamera.updateProjectionMatrix()
                perspectiveCamera.updateMatrixWorld()
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
                perspectiveCamera.aspect = width / height
                if (cameraPose) {
                  applySnapshotCapturePose(
                    perspectiveCamera,
                    cameraPose,
                    { width, height },
                    {
                      w: standardW,
                      h: standardH,
                    },
                  )
                }
                perspectiveCamera.updateProjectionMatrix()
                // The capture camera never joins the scene graph, so its matrixWorld
                // is only refreshed by the render itself — too late for the backdrop
                // uniforms below.
                perspectiveCamera.updateMatrixWorld()
              }

              // Preset/item captures stay clean; scene captures mirror the canvas
              // unless the caller asks for a specific ink.
              const edges = event.edges ?? (transparent ? 'off' : useViewer.getState().edges)
              const applyEnvironment = () =>
                pipeline?.applyEnvironment({
                  theme: useViewer.getState().sceneTheme,
                  transparent,
                  grade: useViewer.getState().shading === 'rendered',
                  edges,
                  camera: thumbnailCamera,
                })
              applyEnvironment()

              // Capture camera data for snapshot storage
              const pos =
                cameraPose || authoredPose ? thumbnailCamera.position : mainCamera.position
              let tgt: [number, number, number] | null = null
              if (authoredPose) {
                tgt = [...authoredPose.target] as [number, number, number]
              } else if (!cameraPose && controls && 'getTarget' in controls) {
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
              const isOrtho = ortho
                ? true
                : !cameraPose && !perspective && mainCamera instanceof THREE.OrthographicCamera
              const cameraData: SnapshotCameraData = {
                ...(requestId && { requestId }),
                position: [pos.x, pos.y, pos.z],
                ...(cameraPose && {
                  quaternion: [...cameraPose.quaternion] as [number, number, number, number],
                  fov: cameraPose.fov,
                }),
                ...(perspective && { fov: perspectiveCamera.fov }),
                target: tgt,
                type: isOrtho ? 'orthographic' : 'perspective',
                ...(isOrtho && {
                  zoom: ortho ? orthoCamera.zoom : (mainCamera as THREE.OrthographicCamera).zoom,
                }),
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
                restore(temporarilyHideNodeTypes(['scan', 'guide', 'spawn', ...hideTypes]))
                if (authoredPose) {
                  // A sheet's picture is of the house: the utility's pole, drop
                  // and pad transformer stay out of it.
                  restore(hideUtilityPlant(scene))
                  if (lightFace)
                    restore(aimLightsAtFace(scene, authoredPose.position, authoredPose.target))
                }
                if (clip.length > 0) restore(clipSceneFor(scene, clip))

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
                    thumbnailCamera.position.set(
                      pose.position[0],
                      pose.position[1],
                      pose.position[2],
                    )
                    thumbnailCamera.lookAt(pose.target[0], pose.target[1], pose.target[2])
                    thumbnailCamera.updateMatrixWorld()
                    applyEnvironment()
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

                if (pipeline) {
                  // The pipeline reads the drawing-buffer size and renders into
                  // its own target synchronously, so the buffer can shrink back
                  // right after the render, before the GPU readback.
                  restore(restoreBuffer)
                  if (authoredPose) {
                    // The scene pass is a FRAME-updated node: it renders once per
                    // node frame, and only the animation loop advances that frame.
                    // With the viewer idle behind an overlay two captures share
                    // one frame and the second returns the first's picture.
                    const nodeFrame = (
                      gl as unknown as { _nodes?: { nodeFrame?: { update?: () => void } } }
                    )._nodes?.nodeFrame
                    nodeFrame?.update?.()
                  }
                  return pipeline.capture({ captureMode, cropRegion, standardSize })
                }
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
                // Fallback: the frame is on the canvas at the (possibly
                // supersampled) buffer size — copy it before the buffer
                // shrinks back in `finally`.
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
                restoreBuffer()
              }

              if (
                version !== captureVersion.current ||
                perspectiveCamera !== thumbnailCameraRef.current
              ) {
                throw new Error('The scene changed during capture. Try again.')
              }
              if (
                (cameraPose || authoredPose) &&
                event.projectId !== useViewer.getState().projectId
              ) {
                throw new Error('The active project changed during capture')
              }
              if (expired()) throw new Error('Snapshot capture timed out before delivery')
              await onCapture(blob, cameraData)
            } finally {
              restoreBuffer()
            }
          }, CAPTURE_WATCHDOG_MS),
        (failure) => emitter.emit('snapshot:capture-failed', failure),
      )
    },
    [gl, scene, getThree, getOrthoPipeline],
  )

  // Thumbnail request via emitter. Three call shapes:
  //  - user-driven capture: `{ projectId, captureMode, cropRegion }` — captures
  //    the current pose with the supplied crop.
  //  - host-driven auto-save: `{ projectId, snapLevels: true }` — snaps levels
  //    to their true positions first for a consistent auto-thumbnail angle.
  //  - host-authored view: `{ projectId, ortho | perspective, … }` — the
  //    capture camera takes the given pose; the viewport camera never moves.
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
