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
  holdLiveFrame,
  pendingSceneBuildCount,
  refreshIsolation,
  SNAPSHOT_MAX_EDGE,
  SNAPSHOT_MIME,
  SNAPSHOT_QUALITY,
  type SnapshotPipeline,
  snapLevelsToTruePositions,
  THUMBNAIL_HEIGHT,
  THUMBNAIL_WIDTH,
  temporarilyHideNodeTypes,
  temporarilyShowShadowOnly,
  useSceneAtmosphere,
  useViewer,
} from '@pascal-app/viewer'
import type { CameraControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { CanvasTarget, ClippingGroup, type WebGPURenderer } from 'three/webgpu'
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

/** The long edge, in pixels, of a supersampled capture's picture at most (it may render in tiles). */
const MAX_CAPTURE_EDGE = 8192
/** The long edge of one render pass at most, whatever the GPU allows: the post-processing targets scale with it. */
const MAX_PASS_EDGE = 4096
/** A supersampled picture's pixels at most on a GPU, and on a software renderer (SwiftShader, llvmpipe) — its time budget. */
const MAX_CAPTURE_PIXELS = 24_000_000
const MAX_SOFTWARE_CAPTURE_PIXELS = 16_000_000
/** Pixels a tile renders past its edge on each inner side, cropped off: the AO and the ink sample across it. */
const TILE_OVERLAP = 96

type CaptureLimits = { passEdge: number; maxPixels: number; software: boolean }

/**
 * What one capture may ask of this GPU: a pass no larger than its biggest
 * texture (and MAX_PASS_EDGE), and — on a software renderer, where a big
 * frame takes minutes — fewer pixels.
 */
function captureLimits(renderer: unknown): CaptureLimits {
  const backend = (renderer as {
    backend?: {
      device?: { limits?: { maxTextureDimension2D?: number }; adapterInfo?: { architecture?: string; description?: string; vendor?: string } }
      gl?: WebGL2RenderingContext
    }
  }).backend
  let gpuEdge = backend?.device?.limits?.maxTextureDimension2D ?? 0
  let rendererName = [backend?.device?.adapterInfo?.vendor, backend?.device?.adapterInfo?.architecture, backend?.device?.adapterInfo?.description].join(' ')
  const gl = backend?.gl
  if (gl) {
    gpuEdge = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number)
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    rendererName = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
  }
  const software = /swiftshader|llvmpipe|software|softpipe/i.test(rendererName)
  const limits = {
    passEdge: Math.min(MAX_PASS_EDGE, gpuEdge || MAX_PASS_EDGE),
    maxPixels: software ? MAX_SOFTWARE_CAPTURE_PIXELS : MAX_CAPTURE_PIXELS,
    software,
  }
  // dev: `window.__pascalCaptureLimits = { passEdge: 2048 }` forces tiling (or a budget) for a probe
  if (process.env.NODE_ENV === 'production') return limits
  return { ...limits, ...(window as unknown as { __pascalCaptureLimits?: Partial<CaptureLimits> }).__pascalCaptureLimits }
}

type Tile = {
  /** The pixels the tile renders, overlap included. */
  x: number
  y: number
  w: number
  h: number
  /** The pixels it contributes to the picture. */
  inner: { x: number; y: number; w: number; h: number }
}

/**
 * A `width × height` picture split into equal tiles no larger than
 * `passEdge`, each rendered TILE_OVERLAP past its inner edges so the
 * screen-space passes (AO, ink, FXAA) have their neighbourhood at a seam.
 * One tile when the picture fits a pass.
 */
export function tileGrid(width: number, height: number, passEdge: number): Tile[] {
  const room = passEdge - 2 * TILE_OVERLAP
  const cols = width <= passEdge ? 1 : Math.ceil(width / room)
  const rows = height <= passEdge ? 1 : Math.ceil(height / room)
  const tiles: Tile[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const ix = Math.round((col * width) / cols)
      const iy = Math.round((row * height) / rows)
      const iw = Math.round(((col + 1) * width) / cols) - ix
      const ih = Math.round(((row + 1) * height) / rows) - iy
      const x = Math.max(0, ix - TILE_OVERLAP)
      const y = Math.max(0, iy - TILE_OVERLAP)
      const w = Math.min(width, ix + iw + TILE_OVERLAP) - x
      const h = Math.min(height, iy + ih + TILE_OVERLAP) - y
      tiles.push({ x, y, w, h, inner: { x: ix, y: iy, w: iw, h: ih } })
    }
  }
  return tiles
}

/**
 * `render` with the renderer's canvas target swapped for a detached one of
 * `width × height`. Every pass of a capture pipeline sizes itself from the
 * renderer's drawing buffer, so a supersampled capture renders at its own
 * size into its own targets while the live canvas — and the live pipeline's
 * targets — keep theirs. Only for renders into a render target: nothing may
 * draw to the screen while the stand-in is current.
 */
export function atCaptureSize<T>(renderer: WebGPURenderer, width: number, height: number, render: () => T): T {
  const live = renderer.getCanvasTarget()
  if (live.domElement.width === width && live.domElement.height === height) return render()
  const stand = document.createElement('canvas')
  stand.width = width
  stand.height = height
  const target = new CanvasTarget(stand)
  renderer.setCanvasTarget(target)
  try {
    return render()
  } finally {
    renderer.setCanvasTarget(live)
    target.dispose()
  }
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

/** The step, in seconds of R3F's clock, a frame run by hand takes (FrameLimiter's own `kick`). */
const PUMPED_FRAME_SECONDS = 1 / 1000

/**
 * Run the frame loop `n` times by hand — the useFrame subscribers and the
 * render — a macrotask apart so React's commits land between the frames.
 *
 * With `frameloop="never"` R3F takes each frame's delta as `timestamp −
 * clock.elapsedTime`, and the viewer's FrameLimiter keeps that clock in
 * SECONDS since it mounted. A pumped frame steps it by a millisecond and puts
 * it back, so the next real frame gets exactly its own delta. (Pumping it with
 * `performance.now()` — milliseconds — handed the next real frame a delta of
 * minus hundreds of thousands of seconds: every delta-scaled lerp blew up, the
 * lights and the backdrop to ±1e6, and the 3D view went black, then colours,
 * while the next capture came back black or blown out white — 2026-09-22.)
 */
export async function pumpFrames(
  advance: (timestamp: number, runGlobalEffects?: boolean) => void,
  clock: { elapsedTime: number; oldTime: number },
  n: number,
): Promise<void> {
  for (let i = 0; i < n; i++) {
    const { elapsedTime, oldTime } = clock
    try {
      advance(elapsedTime + PUMPED_FRAME_SECONDS, true)
    } finally {
      clock.elapsedTime = elapsedTime
      clock.oldTime = oldTime
    }
    await macrotask()
  }
}

/**
 * Bones' finished-house utility plant (the pole, the overhead drop, the pad
 * transformer — buckets tagged `userData.sourceId = 'utility-plant'`,
 * plugin-bones framing/renderer.tsx) hidden for a capture; the returned
 * function shows it again.
 */
export function hideUtilityPlant(scene: THREE.Scene): () => void {
  const hidden: THREE.Object3D[] = []
  scene.traverse((object) => {
    if ((object.userData as { sourceId?: unknown }).sourceId !== 'utility-plant' || !object.visible) return
    object.visible = false
    hidden.push(object)
  })
  return () => {
    for (const object of hidden) object.visible = true
  }
}

/**
 * A section looks INTO the house, and what it sees there — the attic under
 * the roof, a porch roof's underside — faces away from the sun re-aimed at
 * the cut: it read as a solid dark mass. For the frame the unshadowed fill
 * lights shine from the camera and the hemisphere's ground takes the sky's
 * colour, so the attic reads as a light void with its roof and ceiling
 * lines; the returned function puts the lights back.
 */
function lightInterior(scene: THREE.Scene, camera: THREE.Camera): () => void {
  const look = camera.getWorldDirection(new THREE.Vector3())
  const eye = camera.getWorldPosition(new THREE.Vector3())
  const restores: (() => void)[] = []
  scene.traverse((object) => {
    const directional = object as THREE.DirectionalLight
    if (directional.isDirectionalLight && !directional.castShadow) {
      const savedPosition = directional.position.clone()
      const savedTarget = directional.target.position.clone()
      const savedIntensity = directional.intensity
      directional.position.copy(eye)
      directional.target.position.copy(eye.clone().add(look))
      directional.target.updateMatrixWorld()
      directional.updateMatrixWorld()
      directional.intensity = Math.max(savedIntensity, INTERIOR_FILL_INTENSITY)
      restores.push(() => {
        directional.position.copy(savedPosition)
        directional.target.position.copy(savedTarget)
        directional.target.updateMatrixWorld()
        directional.updateMatrixWorld()
        directional.intensity = savedIntensity
      })
      return
    }
    const hemisphere = object as THREE.HemisphereLight
    if (hemisphere.isHemisphereLight) {
      const savedGround = hemisphere.groundColor.clone()
      hemisphere.groundColor.copy(hemisphere.color)
      restores.push(() => hemisphere.groundColor.copy(savedGround))
    }
  })
  return () => {
    for (const restore of restores) restore()
  }
}

/** The fill a section's interior gets from the camera's side (the key light is the re-aimed sun). */
const INTERIOR_FILL_INTENSITY = 2

/** Why a sheet's capture refuses to run in a background tab — the words reach the Architect. */
const HIDDEN_TAB =
  'The Pascal tab is in the background, where the 3D viewer draws no frames — bring it to the front.'

function isTabHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

/** A scene that stops settling for this long holds a node no system will ever build. */
const SCENE_BUILD_STALL_MS = 15_000
/** However busy the scene, a capture waits no longer than this for it. */
const SCENE_BUILD_MAX_MS = 120_000

/**
 * Until the scene has built what the picture shows — walls, roofs, openings,
 * every item's model (a loading placeholder draws through the roof) — the
 * viewer's own scene-ready test. Progress-based: a slow GPU loading a big
 * house keeps it waiting while the pending count moves; a count that stops
 * moving (a node no system settles) lets the capture go. Returns the count
 * left.
 */
async function untilSceneBuilt(): Promise<number> {
  const started = performance.now()
  let pending = pendingSceneBuildCount()
  let changedAt = started
  while (pending > 0) {
    if (isTabHidden()) throw new Error(HIDDEN_TAB)
    const now = performance.now()
    if (now - changedAt > SCENE_BUILD_STALL_MS || now - started > SCENE_BUILD_MAX_MS) break
    await new Promise((resolve) => setTimeout(resolve, 100))
    const next = pendingSceneBuildCount()
    if (next !== pending) {
      pending = next
      changedAt = performance.now()
    }
  }
  return pending
}

/** `promise`, or a rejection with `message` after `ms` — a wait that must not hold the capture queue for good. */
function within<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

/** A readback or a host callback that takes longer than this is abandoned so the next capture runs. */
const CAPTURE_SETTLE_MS = 120_000

/** After a capture session puts the user's view back, the viewport resumes once the restored materials are in. */
const SESSION_RESUME_MS = 250

/** The longest a capture keeps the viewport on its last frame, should its release never come. */
const HOLD_MAX_MS = 300_000

/**
 * What the sheets' pictures are drawn in, whatever the user's view: full-
 * height walls, the storeys stacked at their true heights, the materials'
 * own textures and colours (a white or blueprint palette is a view, not the
 * house). The shading stays the user's: the capture brings its own AO.
 */
const FINISHED_PRESENTATION = {
  wallMode: 'up',
  levelMode: 'stacked',
  textures: true,
  colorPreset: 'clay',
} as const

/** The viewer switched to FINISHED_PRESENTATION; the returned function puts the user's view back. */
export function presentFinished(): () => void {
  const viewer = useViewer.getState()
  const restores: (() => void)[] = []
  if (viewer.wallMode !== FINISHED_PRESENTATION.wallMode) {
    const wallMode = viewer.wallMode
    viewer.setWallMode(FINISHED_PRESENTATION.wallMode)
    restores.push(() => useViewer.getState().setWallMode(wallMode))
  }
  if (viewer.levelMode !== FINISHED_PRESENTATION.levelMode) {
    const levelMode = viewer.levelMode
    viewer.setLevelMode(FINISHED_PRESENTATION.levelMode)
    restores.push(() => useViewer.getState().setLevelMode(levelMode))
  }
  if (viewer.textures !== FINISHED_PRESENTATION.textures) {
    const textures = viewer.textures
    viewer.setTextures(FINISHED_PRESENTATION.textures)
    restores.push(() => useViewer.getState().setTextures(textures))
  }
  if (viewer.colorPreset !== FINISHED_PRESENTATION.colorPreset) {
    const colorPreset = viewer.colorPreset
    viewer.setColorPreset(FINISHED_PRESENTATION.colorPreset)
    restores.push(() => useViewer.getState().setColorPreset(colorPreset))
  }
  return () => {
    for (const restore of restores.reverse()) restore()
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
  const atmosphere = useSceneAtmosphere()
  const getThree = useThree((state) => state.get)
  const advance = useThree((state) => state.advance)
  const clock = useThree((state) => state.clock)
  const controls = useThree((state) => state.controls) as CameraControls | null
  const isGenerating = useRef(false)
  const captureQueue = useRef(createSnapshotQueue())
  const onThumbnailCaptureRef = useRef(onThumbnailCapture)

  const thumbnailCameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const pipelineRef = useRef<SnapshotPipeline | null>(null)
  const captureVersion = useRef(0)
  // An ORTHOGRAPHIC capture (a sheet's elevation, 2026-09-10) needs its own
  // camera and its own pass — the pipeline binds the camera it was built
  // with — built on first use, kept until the atmosphere changes.
  const orthoCameraRef = useRef<THREE.OrthographicCamera | null>(null)
  const orthoPipelineRef = useRef<SnapshotPipeline | null>(null)
  const orthoPipelineBuild = useRef<Promise<SnapshotPipeline | null> | null>(null)

  useEffect(() => {
    onThumbnailCaptureRef.current = onThumbnailCapture
  }, [onThumbnailCapture])

  // Reuse the camera and snapshot graph until the active atmosphere source changes.
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
        atmosphere,
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
      orthoPipelineRef.current?.dispose()
      orthoPipelineRef.current = null
      orthoPipelineBuild.current = null
    }
  }, [gl, scene, atmosphere])

  /** The orthographic capture camera and its pipeline, built once per atmosphere. */
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
        // the post-processed stack (AO + ink edges) for the orthographic camera
        orthoPipelineBuild.current = createSnapshotPipeline({
          renderer: gl as unknown as WebGPURenderer,
          scene,
          camera,
          atmosphere,
        })
      }
      orthoPipelineRef.current = await orthoPipelineBuild.current
    }
    return { camera, pipeline: orthoPipelineRef.current }
  }, [gl, scene, atmosphere])

  const generate = useCallback(
    async (event: ThumbnailGenerateEvent) => {
      const { captureMode, cropRegion, standardSize, cameraPose, requestId } = event
      const snapLevels = event.snapLevels === true
      const transparent = event.transparent === true
      // A SHEET's capture (plugin-sheets capture.ts) asks for more than a
      // thumbnail: its own ink edges, an orthographic or perspective view of
      // its own (the user's camera never moves), node types hidden, the sun
      // re-aimed at the face, the scene clipped at a section's cut, and the
      // frame rendered at print scale.
      const edgesOverride = event.edges
      const ortho = event.ortho
      const hideTypes = event.hideTypes ?? []
      const perspective = event.perspective
      const lightFace = event.lightFace === true
      const clip = event.clip ?? []
      const supersample = event.supersample ?? 1
      const standardW = standardSize?.w ?? THUMBNAIL_WIDTH
      const standardH = standardSize?.h ?? THUMBNAIL_HEIGHT
      // dev: the capture handshake on `window.__pascalCaptureTrace`, for a probe
      const trace = (step: string, data?: unknown) => {
        if (process.env.NODE_ENV === 'production') return
        const w = window as unknown as { __pascalCaptureTrace?: unknown[] }
        ;(w.__pascalCaptureTrace ??= []).push({ t: Math.round(performance.now()), step, data })
      }
      trace('generate', { captureMode, ortho: !!ortho, busy: isGenerating.current, callback: !!onThumbnailCaptureRef.current })
      await runSnapshotCapture(
        requestId,
        isGenerating,
        async () => {
          const version = captureVersion.current
          const onCapture = onThumbnailCaptureRef.current
          if (!onCapture) throw new Error('Snapshot storage is unavailable')
          if (cameraPose && event.projectId !== useViewer.getState().projectId)
            throw new Error('The active project changed before capture')
          const perspectiveCamera = thumbnailCameraRef.current
          if (!perspectiveCamera) throw new Error('Snapshot camera is not ready')
          const { camera: mainCamera, controls } = getThree()
          if (cameraPose && (snapLevels || (captureMode && captureMode !== 'standard'))) {
            throw new Error('An explicit snapshot camera requires standard capture mode')
          }
          if (cameraPose && !pipelineRef.current) {
            throw new Error('Snapshot renderer is not ready. Try again.')
          }

          // a supersampled frame renders at a multiple of the canvas' size into
          // the capture's own targets; the live canvas is never resized
          const canvasSize: [number, number] = [gl.domElement.width, gl.domElement.height]
          const limits = captureLimits(gl)
          const scale = Math.max(
            1,
            Math.min(
              supersample,
              MAX_CAPTURE_EDGE / Math.max(canvasSize[0], canvasSize[1]),
              Math.sqrt(limits.maxPixels / (canvasSize[0] * canvasSize[1])),
            ),
          )
          const width = Math.round(canvasSize[0] * scale)
          const height = Math.round(canvasSize[1] * scale)
          // a supersampled picture is encoded at the size it could render (the
          // caller asked for canvas × supersample, maybe past this GPU's limits)
          const encodeSize = supersample > 1 ? { w: width, h: height } : standardSize
          const pose = ortho ?? perspective
          // a background tab draws no frames and (on the WebGL backend) never
          // finishes a readback: a sheet's capture says so at once
          if (pose && isTabHidden()) throw new Error(HIDDEN_TAB)
          // a sheet's capture runs frames by hand in a scene set up for the
          // picture: the viewport keeps its last frame meanwhile
          const releaseLiveFrame = pose ? holdLiveFrame(HOLD_MAX_MS) : null

          try {
            const edges = edgesOverride ?? (transparent ? 'off' : useViewer.getState().edges)

            // A caller's own orthographic view, or an orthographic main camera,
            // captures orthographically; the auto-save hero shot and an authored
            // snapshot pose stay perspective.
            const wantOrtho =
              !snapLevels && !cameraPose && (ortho !== undefined || mainCamera instanceof THREE.OrthographicCamera)
            let thumbnailCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera = perspectiveCamera
            let pipeline: SnapshotPipeline | null = pipelineRef.current
            if (wantOrtho) {
              // the orthographic capture goes through its own post-processed
              // pipeline (AO, ink edges) and target, on either backend — never
              // through the live canvas
              const built = await orthoPipeline()
              const cam = built.camera
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
              pipeline = built.pipeline
            } else {
              if (perspective && !snapLevels && !cameraPose) {
                // a sheet's cover view: the capture camera stands where the
                // sheet asks, the user's camera never moves
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

            pipeline?.applyEnvironment({
              theme: useViewer.getState().sceneTheme,
              transparent,
              grade: useViewer.getState().shading === 'rendered',
              edges,
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

            if (pose) {
              // a sheet's capture: the house as built — never a half-built scene
              // or an item's loading placeholder (the cover once showed striped
              // boxes through a white roof, 2026-09-23) — then the viewer's own
              // systems (the wall materials, the Bones batches) take two real
              // frames — run by hand, never awaited from the animation loop: a
              // hidden tab gets no animation frames at all, and a capture that
              // waited on one hung the sheet's whole capture chain (2026-09-10)
              const pending = await untilSceneBuilt()
              trace('scene-built', { pending })
              await pumpFrames(advance, clock, 2)
            }

            // the scene as the picture wants it, for one render; `restore` puts
            // every change back right after it
            const setUp = (restore: (callback: () => void) => void) => {
              if (snapLevels) {
                const prevMode = useViewer.getState().levelMode
                if (prevMode !== 'stacked') {
                  restore(() => useViewer.getState().setLevelMode(prevMode))
                  useViewer.getState().setLevelMode('stacked')
                }
                restore(snapLevelsToTruePositions())
              }
              // Hide scan, guide, and spawn nodes (and what the caller asks) so
              // they are excluded from the thumbnail regardless of whether the
              // system listeners are registered.
              restore(temporarilyHideNodeTypes(['scan', 'guide', 'spawn', ...hideTypes]))
              // a sheet's picture is of the house: the utility's pole, drop and
              // pad transformer (Bones' finished-house plant) stay out of it,
              // and every storey stands at its true height
              if (pose) {
                restore(hideUtilityPlant(scene))
                restore(snapLevelsToTruePositions())
              }
              if (lightFace && pose) restore(aimLightsAtFace(scene, pose.position, pose.target))
              if (clip.length > 0) {
                restore(clipSceneFor(scene, clip))
                restore(lightInterior(scene, thumbnailCamera))
              }

              // Auto-save uses the published hero framing. An authored shot keeps
              // its own camera while sharing the same true level positions.
              if (snapLevels) {
                const framing = computeHeroFraming()
                if (framing) {
                  const hero = heroCameraPose({
                    boxes: framing.boxes,
                    aim: framing.aim,
                    azimuthRad: framing.azimuthRad,
                    aspect: width / height,
                  })
                  thumbnailCamera.position.set(hero.position[0], hero.position[1], hero.position[2])
                  thumbnailCamera.lookAt(hero.target[0], hero.target[1], hero.target[2])
                  thumbnailCamera.updateMatrixWorld()
                  pipeline?.applyEnvironment({
                    theme: useViewer.getState().sceneTheme,
                    transparent,
                    grade: useViewer.getState().shading === 'rendered',
                    edges,
                    camera: thumbnailCamera,
                  })
                  cameraData.position = hero.position
                  cameraData.target = hero.target
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

              // Geometry and presentation systems may have mounted new meshes
              // since the viewport's last frame. Apply the same isolation to
              // those meshes before either snapshot render path submits them,
              // and restore fog afterwards so the atmosphere never leaks in.
              restore(refreshIsolation(scene))
            }
            // The scene pass is a FRAME-updated node: it renders once per node
            // frame, and only the animation loop advances that frame. With the
            // viewer idle behind the Sheets overlay two captures share one
            // frame and the second returns the first's picture (2026-09-10:
            // the north elevation came back as the east). Advance it by hand.
            const advanceNodeFrame = () =>
              (gl as unknown as { _nodes?: { nodeFrame?: { update?: () => void } } })._nodes?.nodeFrame?.update?.()
            // a sheet's picture goes to the sheets lossless: they pick its print encoding
            const mime = pose ? 'image/png' : undefined
            const tiles = pose && pipeline ? tileGrid(width, height, limits.passEdge) : []

            if (tiles.length > 1 && pipeline) {
              // Past one pass (the GPU's biggest texture, or MAX_PASS_EDGE) the
              // picture renders tile by tile — each a view offset of the same
              // camera, the scene set up afresh for it (the frame loop runs
              // between the readbacks) — and the tiles land on one canvas.
              trace('capture:tiles', { width, height, tiles: tiles.length, software: limits.software })
              const picture = new OffscreenCanvas(width, height)
              const context = picture.getContext('2d')
              if (!context) throw new Error('The picture canvas could not be created')
              for (const tile of tiles) {
                const shot = captureSnapshotScene((restore) => {
                  setUp(restore)
                  thumbnailCamera.setViewOffset(width, height, tile.x, tile.y, tile.w, tile.h)
                  restore(() => thumbnailCamera.clearViewOffset())
                  thumbnailCamera.updateMatrixWorld()
                  pipeline.applyEnvironment({
                    theme: useViewer.getState().sceneTheme,
                    transparent,
                    grade: useViewer.getState().shading === 'rendered',
                    edges,
                    camera: thumbnailCamera,
                  })
                  advanceNodeFrame()
                  return atCaptureSize(gl as unknown as WebGPURenderer, tile.w, tile.h, () =>
                    pipeline.capture({ captureMode: 'standard', standardSize: { w: tile.w, h: tile.h }, mime }),
                  )
                })
                const result = await within(
                  Promise.resolve(shot),
                  CAPTURE_SETTLE_MS,
                  'The GPU readback of the captured frame never came back.',
                )
                const bitmap = await createImageBitmap(result.blob)
                const { inner } = tile
                context.drawImage(bitmap, inner.x - tile.x, inner.y - tile.y, inner.w, inner.h, inner.x, inner.y, inner.w, inner.h)
                bitmap.close()
              }
              const blob = await picture.convertToBlob({ type: 'image/png' })
              trace('capture:done', { w: width, h: height, bytes: blob.size, tiles: tiles.length })
              if (captureMode !== undefined) cameraData.captureMode = captureMode
              cameraData.resolution = { w: width, h: height }
              if (version !== captureVersion.current || perspectiveCamera !== thumbnailCameraRef.current) {
                throw new Error('The scene changed during capture. Try again.')
              }
              trace('callback', { bytes: blob.size })
              await within(Promise.resolve(onCapture(blob, cameraData)), CAPTURE_SETTLE_MS, 'The snapshot host never took the frame.')
              return
            }

            const capturePromise = captureSnapshotScene((restore) => {
              setUp(restore)
              if (pipeline) {
                trace('capture:start', { ortho: wantOrtho, pipeline: true, width, height })
                advanceNodeFrame()
                return atCaptureSize(gl as unknown as WebGPURenderer, width, height, () =>
                  pipeline.capture({ captureMode, cropRegion, standardSize: encodeSize, mime }),
                )
              }
              // a sheet's picture (or a supersampled one) is never drawn into
              // the live canvas the viewport shows
              if (pose || scale > 1) throw new Error('Snapshot renderer is not ready. Try again.')
              // Fallback: plain render directly to the canvas
              if (transparent) {
                const clearColor = (gl as unknown as { getClearColor: (t: THREE.Color) => THREE.Color }).getClearColor(new THREE.Color())
                const clearAlpha = gl.getClearAlpha()
                const sceneBackground = scene.background
                restore(() => {
                  scene.background = sceneBackground
                  gl.setClearColor(clearColor, clearAlpha)
                })
                scene.background = null
                gl.setClearColor(new THREE.Color('#ffffff'), 0)
              }
              trace('canvas:render', { ortho: wantOrtho })
              gl.render(scene, thumbnailCamera)
              return undefined
            })

            let blob: Blob
            if (pipeline) {
              // the frame is rendered and the scene restored: a readback that
              // never returns must not hold every later capture in the queue
              const result = await within(
                Promise.resolve(capturePromise),
                CAPTURE_SETTLE_MS,
                'The GPU readback of the captured frame never came back.',
              )
              if (!result) throw new Error('Snapshot capture produced no image')
              trace('capture:done', { w: result.outW, h: result.outH, bytes: result.blob.size })
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
              perspectiveCamera !== thumbnailCameraRef.current
            ) {
              throw new Error('The scene changed during capture. Try again.')
            }
            if (cameraPose && event.projectId !== useViewer.getState().projectId) {
              throw new Error('The active project changed during capture')
            }
            trace('callback', { bytes: blob.size })
            await within(Promise.resolve(onCapture(blob, cameraData)), CAPTURE_SETTLE_MS, 'The snapshot host never took the frame.')
          } finally {
            releaseLiveFrame?.()
            // a sheet capture (transparent ground, ink edges, an orthographic
            // camera) sets the environment the live viewer shares; put the
            // viewer's own look back whatever happened above, or the live 3D
            // view keeps the capture's tinted (sepia-looking) environment
            if (transparent || edgesOverride !== undefined || ortho !== undefined) {
              try {
                pipelineRef.current?.applyEnvironment({
                  theme: useViewer.getState().sceneTheme,
                  transparent: false,
                  grade: useViewer.getState().shading === 'rendered',
                  edges: useViewer.getState().edges,
                  camera: mainCamera,
                })
              } catch (error) {
                trace('restore-environment', String(error))
              }
            }
          }
        },
        (failure) => emitter.emit('snapshot:capture-failed', failure),
      )
    },
    [gl, scene, getThree, orthoPipeline, advance, clock],
  )

  // A sheet's run of captures (plugin-sheets capture.ts) sets the shared scene
  // up for its pictures — the finished presentation, the ground hidden — so
  // for the run the viewport keeps its last frame and the viewer shows the
  // finished house whatever view the user was in; `active: false` puts the
  // user's view back, then (a few commits later) the viewport resumes.
  // `camera-controls:capture-session` `{ owner, active }`.
  useEffect(() => {
    const sessions = new Map<string, () => void>()
    const end = (owner: string) => {
      sessions.get(owner)?.()
      sessions.delete(owner)
    }
    const onSession = (event: { owner?: string; active?: boolean }) => {
      if (!event?.owner) return
      end(event.owner)
      if (!event.active) return
      const releaseLiveFrame = holdLiveFrame(HOLD_MAX_MS)
      const restorePresentation = presentFinished()
      sessions.set(event.owner, () => {
        restorePresentation()
        setTimeout(releaseLiveFrame, SESSION_RESUME_MS)
      })
    }
    const bus = emitter as unknown as {
      on: (name: string, handler: typeof onSession) => void
      off: (name: string, handler: typeof onSession) => void
    }
    bus.on('camera-controls:capture-session', onSession)
    return () => {
      bus.off('camera-controls:capture-session', onSession)
      for (const owner of [...sessions.keys()]) end(owner)
    }
  }, [])

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
