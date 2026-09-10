/**
 * The 3D image on a cover sheet.
 *
 * The viewer runs `frameloop="never"` on a WebGPU renderer, so reading the
 * canvas directly usually returns an already-cleared buffer. The supported
 * path is the editor's own snapshot pipeline: emit
 * `camera-controls:generate-thumbnail`, the ThumbnailGenerator renders
 * explicitly and hands the host a Blob through `onThumbnailCapture`, which
 * the host re-broadcasts as a `pascal:thumbnail` DOM event. Same mechanism
 * `packages/plugin-plans/src/snapshot.ts` uses.
 *
 * Both host routes now re-broadcast: `apps/editor/app/page.tsx:112` and
 * `apps/editor/components/scene-loader.tsx:233` (the saved-scene route). The
 * remaining precondition is simply that a 3D canvas is mounted — the Sheets
 * workspace is an overlay painted over the editor, not a replacement for it,
 * so the viewer stays alive underneath and the capture works from inside the
 * workspace.
 *
 * What is different here: a sheet must not depend on where the user left the
 * camera. The pose is COMPUTED (`pose.ts`), applied through
 * `camera-controls:apply-pose`, captured, and the user's own pose put back.
 */
import { emitter, sceneRegistry, useScene } from '@pascal-app/core'
import { subscribeCameraPose } from '@pascal-app/editor'
import { elevationVectorDrawing } from './drawings'
import { type NodeMap, scene, sceneNodes, updateViewport } from './model'
import { coverFrontPose, type Pose } from './pose'
import type { ViewportNode } from './schema'

type CameraPoseLike = {
  position: [number, number, number]
  target: [number, number, number]
  projection: 'perspective' | 'orthographic'
  fov?: number
  viewWidth?: number
}

function emit(name: string, payload: unknown): void {
  ;(emitter as unknown as { emit: (n: string, p: unknown) => void }).emit(name, payload)
}

function currentPose(): CameraPoseLike | null {
  let pose: CameraPoseLike | null = null
  try {
    const unsubscribe = subscribeCameraPose((p) => {
      pose = p as CameraPoseLike
    })
    unsubscribe()
  } catch {
    return null
  }
  return pose
}

/** Resolve the pose a viewport asks for. `undefined` when nothing can be framed. */
export function resolveViewportPose(viewport: ViewportNode): Pose | null {
  const pose = viewport.pose ?? 'cover-front'
  if (pose === 'cover-front') return coverFrontPose(sceneNodes() as never)
  return { position: pose.position, target: pose.target }
}

export type CaptureResult =
  | { ok: true; dataUrl: string }
  | { ok: false; reason: string }

/**
 * The FINISHED presentation for the length of a capture: every Bones
 * framing node on the scene to its 'off' view (the physical set — the tank
 * in its enclosure, the condenser, the meter and mast — in finish paint,
 * the framing and the runs back in the walls), restored after. A sheet
 * shows the house, never whatever X-ray the user was in (Steve, 2026-09-10:
 * "shouldn't the 3D view show the normal view not the current view?").
 * History is paused: the flip is not an edit.
 */
export async function withFinishedPresentation<T>(fn: () => Promise<T>): Promise<T> {
  const nodes = sceneNodes()
  const flipped: { id: string; viewMode: string }[] = []
  for (const n of Object.values(nodes)) {
    if (!n || n.type !== 'bones:framing') continue
    const raw = (n as { viewMode?: unknown; seeThrough?: unknown }).viewMode
    const effective =
      raw === 'off' || raw === 'xray' || raw === 'basement' || raw === 'framing'
        ? raw
        : (n as { seeThrough?: unknown }).seeThrough === false
          ? 'off'
          : 'xray'
    if (effective === 'off') continue
    flipped.push({ id: n.id, viewMode: effective })
  }
  if (flipped.length === 0) return fn()
  const temporal = (useScene as unknown as { temporal?: { getState: () => { pause: () => void; resume: () => void } } })
    .temporal
  temporal?.getState().pause()
  try {
    for (const f of flipped) scene().updateNode(f.id, { viewMode: 'off' })
    // the renderer rebuilds its batches on the next frames
    await wait(700)
    return await fn()
  } finally {
    for (const f of flipped) scene().updateNode(f.id, { viewMode: f.viewMode })
    temporal?.getState().resume()
  }
}

/**
 * The site's own surface — the terrain, the lot's ground — hidden for the
 * length of `fn`, the buildings under it kept: hiding the site NODE hides
 * everything that hangs off it (the house went with it, 2026-09-10), so
 * only the site object's children that are no registered node of their own
 * go dark. Edge-on, the terrain is a solid ground band that buries the
 * footings the drawing's grade line and hatch already show.
 */
async function withSiteSurfaceHidden<T>(fn: () => Promise<T>): Promise<T> {
  const registry = sceneRegistry as unknown as {
    byType?: Record<string, Iterable<string> | undefined>
    nodes?: Map<string, { children?: { visible: boolean }[] }>
  }
  const nodeObjects = new Set<unknown>(registry.nodes ? Array.from(registry.nodes.values()) : [])
  const hidden: { visible: boolean }[] = []
  for (const id of Array.from(registry.byType?.site ?? [])) {
    const site = registry.nodes?.get(id)
    for (const child of site?.children ?? []) {
      if (nodeObjects.has(child) || !child.visible) continue
      child.visible = false
      hidden.push(child)
    }
  }
  try {
    return await fn()
  } finally {
    for (const child of hidden) child.visible = true
  }
}

/** The 3D canvas — the largest on the page; its aspect is the capture's. */
function viewerCanvas(): HTMLCanvasElement | null {
  let best: HTMLCanvasElement | null = null
  for (const c of Array.from(document.querySelectorAll('canvas'))) {
    if (!best || c.width * c.height > best.width * best.height) best = c
  }
  return best && best.width > 0 && best.height > 0 ? best : null
}

/** The node types whose change moves an elevation's picture — a cheap content hash over them. */
const PICTURE_TYPES = new Set([
  'building',
  'level',
  'wall',
  'door',
  'window',
  'roof',
  'roof-segment',
  'slab',
  'ceiling',
  'block',
  'column',
  'stair',
  'stair-segment',
  'fence',
  'item',
  'site',
  'bones:service',
  'bones:device',
  'utility-pole',
  'utility-line',
  'tree',
])
const PICTURE_FIELDS = [
  'position',
  'rotation',
  'start',
  'end',
  'height',
  'width',
  'thickness',
  'elevation',
  'length',
  'polygon',
  'wallT',
  'serviceType',
  'kind',
  'pitch',
  'overhang',
  'assembly',
  'material',
  'metadata',
]

/** What the elevation pictures depend on, hashed — equal hashes, same picture. */
export function elevationCaptureHash(nodes: NodeMap): string {
  const parts: string[] = []
  for (const id of Object.keys(nodes).sort()) {
    const n = nodes[id] as (Record<string, unknown> & { type?: string; visible?: boolean }) | undefined
    if (!n || !n.type || !PICTURE_TYPES.has(n.type) || n.visible === false) continue
    const fields: unknown[] = [id, n.type]
    for (const key of PICTURE_FIELDS) if (key in n) fields.push(n[key])
    parts.push(JSON.stringify(fields))
  }
  // djb2 over the joined record — a short stable string
  let h = 5381
  const text = parts.join('|')
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return `${parts.length}:${(h >>> 0).toString(36)}`
}

/** True when the viewport's picture is missing or was taken of another model — an elevation or the cover view. */
export function elevationCaptureStale(viewport: ViewportNode, nodes: NodeMap): boolean {
  if (viewport.kind === 'view3d') return !viewport.dataUrl || viewport.imageHash !== elevationCaptureHash(nodes)
  if (viewport.kind !== 'elevation') return false
  if (!viewport.dataUrl || !viewport.imageFrame) return true
  return viewport.imageHash !== elevationCaptureHash(nodes)
}

/**
 * The elevation as the viewer shows it: an ORTHOGRAPHIC capture of the
 * finished house from the elevation's direction, sized to the vector
 * drawing's window, written onto the viewport with the rectangle it covers
 * in drawing metres — `resolveProvided` lays the datums, the grade line,
 * the tags and the finish key over it. Everything a plugin builds in 3D is
 * in the picture by construction: the roof as its CSG cut it, the doors and
 * windows with their trim, the porch, Bones' equipment on the walls.
 */
export async function captureElevationImage(
  viewport: ViewportNode,
  options: { maxWidth?: number } = {},
): Promise<CaptureResult> {
  if (typeof window === 'undefined') return { ok: false, reason: 'no browser' }
  const nodes = sceneNodes()
  const vector = elevationVectorDrawing(viewport, nodes)
  if (!vector || !vector.frame || vector.primitives.length === 0) {
    return { ok: false, reason: 'There is nothing to frame in this elevation yet — draw some walls first.' }
  }
  const canvas = viewerCanvas()
  if (!canvas) {
    return {
      ok: false,
      reason: 'The 3D viewer is not mounted — open the model once in this tab, then press Recapture.',
    }
  }
  // the picture's window: the vector drawing's bounds, widened to the
  // canvas' aspect so the capture covers it exactly
  const aspect = canvas.width / Math.max(1, canvas.height)
  const b = vector.bounds
  const boundsW = b.maxX - b.minX
  const boundsH = b.maxY - b.minY
  const width = Math.max(boundsW, boundsH * aspect) * 1.02
  const height = width / aspect
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  // drawing frame → world: a plan point u along the view's right axis (depth
  // 0) turns by the building's yaw and stands at its origin; the drawing's
  // y is the NEGATED elevation over the building's own y
  const { frame } = vector
  const cos = Math.cos(frame.yaw)
  const sin = Math.sin(frame.yaw)
  const toWorld = (lx: number, lz: number): [number, number] => [
    frame.origin[0] + lx * cos + lz * sin,
    frame.origin[2] - lx * sin + lz * cos,
  ]
  const [tx, tz] = toWorld(frame.right[0] * cx, frame.right[1] * cx)
  const ty = frame.origin[1] - cy
  const [fx, fz] = [frame.forward[0] * cos + frame.forward[1] * sin, -frame.forward[0] * sin + frame.forward[1] * cos]
  const distance = 80
  const target: [number, number, number] = [tx, ty, tz]
  const position: [number, number, number] = [tx - fx * distance, ty, tz - fz * distance]
  const hash = elevationCaptureHash(nodes)

  // the viewer's own camera never moves: the generator renders through an
  // orthographic capture camera of this pose (thumbnail-generator.tsx)
  const raw = await withFinishedPresentation(() =>
    withSiteSurfaceHidden(() =>
      capturePipeline(20000, {
        transparent: true,
        edges: 'soft',
        ortho: { position, target, viewWidth: width },
        lightFace: true,
      }),
    ),
  )
  if (process.env.NODE_ENV !== 'production') {
    // dev: the last frame and its pose, for a probe to look at
    ;(window as unknown as { __pascalLastCapture?: unknown }).__pascalLastCapture = {
      raw,
      position,
      target,
      width,
      height,
      bounds: b,
      frame,
      canvas: [canvas.width, canvas.height],
    }
  }
  if (!raw) {
    return {
      ok: false,
      reason:
        'No frame came back from the 3D viewer within 20 seconds — open the model once in this tab, then press Recapture.',
    }
  }
  const dataUrl = await toJpeg(raw, options.maxWidth ?? 2400)
  if (!dataUrl) {
    return { ok: false, reason: 'The captured frame came back blank — the viewer rendered nothing from the elevation pose.' }
  }
  updateViewport(viewport.id, {
    dataUrl,
    imageFrame: { x0: cx - width / 2, y0: cy - height / 2, x1: cx + width / 2, y1: cy + height / 2 },
    imageHash: hash,
  })
  return { ok: true, dataUrl }
}

/**
 * Drive the camera to the viewport's standard pose, capture, restore.
 * Writes the JPEG data URL onto the viewport node so the sheet keeps the
 * image with the scene.
 */
export async function captureViewportImage(
  viewport: ViewportNode,
  options: { persist?: boolean; maxWidth?: number } = {},
): Promise<CaptureResult> {
  if (typeof window === 'undefined') return { ok: false, reason: 'no browser' }
  const pose = resolveViewportPose(viewport)
  if (!pose) {
    return {
      ok: false,
      reason: 'There is nothing in the scene to frame yet — draw some walls first.',
    }
  }

  // The capture camera takes the computed pose itself (thumbnail-generator
  // `perspective`): the user's camera never moves and the frame is never
  // caught mid-animation. The finished house is what a sheet shows,
  // whatever view the user was in. The snapshot pipeline builds an SSGI
  // pass on first use, which can take several seconds on a cold WebGPU
  // device — hence the generous window.
  const raw = await withFinishedPresentation(() =>
    capturePipeline(20000, { perspective: { position: pose.position, target: pose.target, fov: 60 } }),
  )
  if (!raw) {
    return {
      ok: false,
      // The generator returns early when the host route passes no
      // `onThumbnailCapture`, and emits nothing at all when no 3D canvas is
      // mounted — either way no blob arrives and there is nothing to wait
      // for. Say so in plain words rather than leaving a silent blank box.
      reason:
        'No snapshot came back from the 3D viewer within 20 seconds. The viewer has to be mounted for a capture — open the model view once in this tab, then press Recapture.',
    }
  }

  const dataUrl = await toJpeg(raw, options.maxWidth ?? 1800)
  if (!dataUrl) {
    return {
      ok: false,
      reason:
        'The captured frame came back blank — the 3D viewer rendered nothing at the standard pose.',
    }
  }
  // the model hash the picture was taken at — a changed model recaptures
  // the cover like an elevation (overlay.tsx)
  if (options.persist !== false) updateViewport(viewport.id, { dataUrl, imageHash: elevationCaptureHash(sceneNodes()) })
  return { ok: true, dataUrl }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** dev: the capture handshake on `window.__pascalCaptureTrace`, shared with the editor's generator. */
function traceCapture(step: string, data?: unknown): void {
  if (process.env.NODE_ENV === 'production') return
  const w = window as unknown as { __pascalCaptureTrace?: unknown[] }
  ;(w.__pascalCaptureTrace ??= []).push({ t: Math.round(performance.now()), step, data })
}

function capturePipeline(
  timeoutMs: number,
  options: {
    transparent?: boolean
    edges?: 'off' | 'soft' | 'strong'
    ortho?: { position: [number, number, number]; target: [number, number, number]; viewWidth: number }
    perspective?: { position: [number, number, number]; target: [number, number, number]; fov?: number }
    hideTypes?: readonly string[]
    lightFace?: boolean
  } = {},
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let done = false
    const finish = (value?: string) => {
      if (done) return
      done = true
      window.removeEventListener('pascal:thumbnail', onThumb as EventListener)
      resolve(value)
    }
    const onThumb = (event: CustomEvent<{ blob: Blob }>) => {
      traceCapture('sheets:thumb', event.detail?.blob?.size)
      const blob = event.detail?.blob
      if (!blob) return finish(undefined)
      const reader = new FileReader()
      reader.onload = () => finish(typeof reader.result === 'string' ? reader.result : undefined)
      reader.onerror = () => finish(undefined)
      reader.readAsDataURL(blob)
    }
    window.addEventListener('pascal:thumbnail', onThumb as EventListener)
    try {
      traceCapture('sheets:emit', options)
      emit('camera-controls:generate-thumbnail', { captureMode: 'viewport', ...options })
    } catch {
      finish(undefined)
    }
    setTimeout(() => finish(undefined), timeoutMs)
  })
}

/** Re-encode as a bounded JPEG on white; `undefined` when the frame is flat. */
function toJpeg(dataUrl: string, maxWidth: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxWidth / (img.naturalWidth || maxWidth))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale))
      canvas.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve(undefined)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(isBlank(ctx, canvas.width, canvas.height) ? undefined : canvas.toDataURL('image/jpeg', 0.92))
    }
    img.onerror = () => resolve(undefined)
    img.src = dataUrl
  })
}

function isBlank(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const step = Math.max(1, Math.floor(w / 24))
    const first = ctx.getImageData(0, 0, 1, 1).data
    let same = 0
    let n = 0
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const d = ctx.getImageData(x, y, 1, 1).data
        n++
        const delta =
          Math.abs((d[0] ?? 0) - (first[0] ?? 0)) +
          Math.abs((d[1] ?? 0) - (first[1] ?? 0)) +
          Math.abs((d[2] ?? 0) - (first[2] ?? 0))
        if (delta < 12) same++
      }
    }
    return n > 0 && same / n > 0.985
  } catch {
    return false
  }
}

/** Capture every view3d viewport that has no image yet. */
export async function captureMissingViews(): Promise<{ captured: number; failures: string[] }> {
  const nodes = sceneNodes()
  const pending = Object.values(nodes).filter(
    (n) => n?.type === 'sheets:viewport' && (n as ViewportNode).kind === 'view3d' && !(n as ViewportNode).dataUrl,
  ) as ViewportNode[]
  let captured = 0
  const failures: string[] = []
  for (const viewport of pending) {
    const result = await captureViewportImage(viewport)
    if (result.ok) captured++
    else failures.push(`${viewport.id}: ${result.reason}`)
  }
  return { captured, failures }
}
