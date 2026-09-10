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
  // reentrant: a second caller while the house is already presented shares
  // the flip — the LAST one out restores the X-ray, never the first
  if (presentationDepth > 0) {
    presentationDepth++
    try {
      return await fn()
    } finally {
      presentationDepth--
    }
  }
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
  presentationDepth++
  try {
    for (const f of flipped) scene().updateNode(f.id, { viewMode: 'off' })
    // the renderer rebuilds its batches and the wall system swaps the X-ray
    // materials back in the React commits that follow — two turns of the
    // event loop, then a settle (the west elevation once captured
    // see-through walls when its capture followed another's restore within
    // one frame, 2026-09-10). Never an animation frame: a hidden tab gets
    // none, and the editor's generator runs the frames it needs by hand.
    await settledTurns(2)
    await wait(900)
    return await fn()
  } finally {
    presentationDepth--
    // a caller that joined the flip (depth > 0) still runs — leave the house
    // presented for it; the last one out restores
    if (presentationDepth === 0) {
      for (const f of flipped) scene().updateNode(f.id, { viewMode: f.viewMode })
      temporal?.getState().resume()
    }
  }
}

/** Callers presently inside `withFinishedPresentation`. */
let presentationDepth = 0

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

/** The capture recipe's version — part of every picture's hash; a change recaptures every sheet once. */
const PICTURE_RECIPE = 'r5'

/** A sheet's picture is rendered at this multiple of the canvas' size and kept at up to PICTURE_MAX_WIDTH px. */
const PICTURE_SUPERSAMPLE = 2
const PICTURE_MAX_WIDTH = 3600

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
  // djb2 over the joined record — a short stable string, prefixed with the
  // picture recipe's version: bump PICTURE_RECIPE when the capture itself
  // changes (its size, its light, its outlines) so every sheet recaptures once
  let h = 5381
  const text = parts.join('|')
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  // dashes, never colons: the scene API's save validator reads a string with
  // a leading `word:` as a URL and rejects the scheme (2026-09-10 — every
  // autosave after the first recipe-tagged capture came back 400)
  return `${PICTURE_RECIPE}-${parts.length}-${(h >>> 0).toString(36)}`
}

/** True when the viewport's picture is missing or was taken of another model — an elevation, a section or the cover view. */
export function elevationCaptureStale(viewport: ViewportNode, nodes: NodeMap): boolean {
  if (viewport.kind === 'view3d') return !viewport.dataUrl || viewport.imageHash !== elevationCaptureHash(nodes)
  if (viewport.kind !== 'elevation' && viewport.kind !== 'section') return false
  if (!viewport.dataUrl || !viewport.imageFrame) return true
  return viewport.imageHash !== elevationCaptureHash(nodes)
}

/** The capture a viewport takes: an elevation or a section from the viewer, else the cover view. */
export function captureViewportPicture(viewport: ViewportNode): Promise<CaptureResult> {
  // ONE capture at a time, whoever asks — the overlay's auto-capture and the
  // rail's Recapture button once ran together, and the first's restore of
  // the Bones X-ray landed while the second still rendered: it captured the
  // framing (2026-09-10). The queue never rejects: a failed capture answers
  // with its reason and the next one runs.
  const run = async (): Promise<CaptureResult> => {
    if (viewport.kind === 'elevation') return captureElevationImage(viewport)
    if (viewport.kind === 'section') return captureSectionImage(viewport)
    return captureViewportImage(viewport)
  }
  const next = captureQueue.then(run, run)
  captureQueue = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

/** The captures in flight, one after another (see `captureViewportPicture`). */
let captureQueue: Promise<unknown> = Promise.resolve()

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
  const [tx, tz] = toWorld(frame.planOrigin[0] + frame.right[0] * cx, frame.planOrigin[1] + frame.right[1] * cx)
  const ty = frame.origin[1] - cy
  const [fx, fz] = [frame.forward[0] * cos + frame.forward[1] * sin, -frame.forward[0] * sin + frame.forward[1] * cos]
  const distance = 80
  const target: [number, number, number] = [tx, ty, tz]
  const position: [number, number, number] = [tx - fx * distance, ty, tz - fz * distance]
  const hash = elevationCaptureHash(nodes)

  // the viewer's own camera never moves: the generator renders through an
  // orthographic capture camera of this pose (thumbnail-generator.tsx) —
  // and the same pose gives the VECTOR lines: the scene's visible feature
  // edges, hidden lines removed (editor lib/vector-edges.ts), so the
  // drawing's lines and its picture come from the one model
  const { raw, edges } = await withFinishedPresentation(() =>
    withSiteSurfaceHidden(async () => {
      const raw = await capturePipeline(20000, {
        transparent: true,
        edges: 'soft',
        ortho: { position, target, viewWidth: width },
        lightFace: true,
        supersample: PICTURE_SUPERSAMPLE,
      })
      const edges = raw ? await requestEdges({ ortho: { position, target, viewWidth: width }, aspect }) : null
      return { raw, edges }
    }),
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
  const dataUrl = await toJpeg(raw, options.maxWidth ?? PICTURE_MAX_WIDTH)
  if (!dataUrl) {
    return { ok: false, reason: 'The captured frame came back blank — the viewer rendered nothing from the elevation pose.' }
  }
  const imageEdges = edges ? encodeEdges(edgesToDrawing(edges, frame)) : undefined
  traceCapture('sheets:edges', { segments: edges ? edges.length / 6 : 0, chars: imageEdges?.length ?? 0 })
  updateViewport(viewport.id, {
    dataUrl,
    imageFrame: { x0: cx - width / 2, y0: cy - height / 2, x1: cx + width / 2, y1: cy + height / 2 },
    imageHash: hash,
    imageEdges,
  })
  return { ok: true, dataUrl }
}

/**
 * The viewer's visible edges through an orthographic pose, as world
 * segments (six floats each) — the editor's VectorEdgeExtractor answers on
 * `pascal:edges`; null when nothing answers within the timeout or the
 * extraction fails (the drawing then keeps its own outlines).
 */
function requestEdges(options: {
  ortho: { position: [number, number, number]; target: [number, number, number]; viewWidth: number }
  aspect: number
}): Promise<Float32Array | null> {
  return new Promise((resolve) => {
    const requestId = `edges-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    let done = false
    const finish = (value: Float32Array | null) => {
      if (done) return
      done = true
      window.removeEventListener('pascal:edges', onEdges as EventListener)
      clearTimeout(timer)
      resolve(value)
    }
    const onEdges = (event: CustomEvent<{ requestId?: string; ok?: boolean; segments?: Float32Array; count?: number; ms?: number }>) => {
      if (event.detail?.requestId !== requestId) return
      traceCapture('edges:done', { count: event.detail.count, ms: event.detail.ms, ok: event.detail.ok })
      finish(event.detail.ok && event.detail.segments ? event.detail.segments : null)
    }
    const timer = setTimeout(() => finish(null), 30000)
    window.addEventListener('pascal:edges', onEdges as EventListener)
    try {
      traceCapture('edges:emit', { requestId })
      emit('camera-controls:extract-edges', { requestId, ...options })
    } catch {
      finish(null)
    }
  })
}

/**
 * World segments → the elevation's drawing space: a point turned into the
 * building's frame, its run along the view's right axis from the plan
 * origin as x, its height over the building's origin NEGATED as y — the
 * inverse of the frame `captureElevationImage` aims the camera with.
 */
function edgesToDrawing(
  segments: Float32Array,
  frame: {
    yaw: number
    origin: readonly [number, number, number]
    right: readonly [number, number]
    planOrigin: readonly [number, number]
  },
): number[] {
  const cos = Math.cos(frame.yaw)
  const sin = Math.sin(frame.yaw)
  const out: number[] = []
  const to = (x: number, y: number, z: number): [number, number] => {
    const dx = x - frame.origin[0]
    const dz = z - frame.origin[2]
    const lx = dx * cos - dz * sin
    const lz = dx * sin + dz * cos
    const u = (lx - frame.planOrigin[0]) * frame.right[0] + (lz - frame.planOrigin[1]) * frame.right[1]
    return [u, -(y - frame.origin[1])]
  }
  for (let i = 0; i + 5 < segments.length; i += 6) {
    const a = to(segments[i] as number, segments[i + 1] as number, segments[i + 2] as number)
    const b = to(segments[i + 3] as number, segments[i + 4] as number, segments[i + 5] as number)
    // a run shorter than 3 mm on paper is rasterisation grit, not a line
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.003) continue
    out.push(a[0], a[1], b[0], b[1])
  }
  return out
}

/** Keep at most this many segments on a viewport (the longest win). */
const EDGES_MAX = 60000

/** "x0,y0,x1,y1;…" to the millimetre. */
function encodeEdges(flat: number[]): string {
  let quads: number[][] = []
  for (let i = 0; i + 3 < flat.length; i += 4) quads.push([flat[i] as number, flat[i + 1] as number, flat[i + 2] as number, flat[i + 3] as number])
  if (quads.length > EDGES_MAX) {
    quads.sort((p, q) => Math.hypot(q[2]! - q[0]!, q[3]! - q[1]!) - Math.hypot(p[2]! - p[0]!, p[3]! - p[1]!))
    quads = quads.slice(0, EDGES_MAX)
  }
  return quads.map((q) => q.map((v) => (Math.round(v * 1000) / 1000).toString()).join(',')).join(';')
}

/** The inverse of `encodeEdges`: drawing-space segments, four numbers each. */
export function decodeEdges(text: string | undefined): number[] {
  if (!text) return []
  const out: number[] = []
  for (const part of text.split(';')) {
    const v = part.split(',')
    if (v.length !== 4) continue
    const n = v.map((s) => Number(s))
    if (n.some((x) => !Number.isFinite(x))) continue
    out.push(n[0] as number, n[1] as number, n[2] as number, n[3] as number)
  }
  return out
}

/**
 * The building section as the viewer shows it: the finished house CLIPPED
 * at the section's plane — everything on the viewer's side of the cut
 * gone, everything beyond it to the section's depth kept — captured
 * orthographically along the marker's look direction and sized to the
 * vector drawing's window; the vector engine then draws the cut itself
 * (the walls, slabs and roof the plane passes through, with their poché),
 * the datums, the grade and Bones' cut members over it (`beyondFromImage`).
 */
export async function captureSectionImage(
  viewport: ViewportNode,
  options: { maxWidth?: number } = {},
): Promise<CaptureResult> {
  if (typeof window === 'undefined') return { ok: false, reason: 'no browser' }
  const nodes = sceneNodes()
  const vector = elevationVectorDrawing(viewport, nodes)
  if (!vector || !vector.frame || vector.primitives.length === 0) {
    return { ok: false, reason: 'There is nothing to cut in this section yet — draw some walls and place a section marker first.' }
  }
  const canvas = viewerCanvas()
  if (!canvas) {
    return {
      ok: false,
      reason: 'The 3D viewer is not mounted — open the model once in this tab, then press Recapture.',
    }
  }
  const aspect = canvas.width / Math.max(1, canvas.height)
  const b = vector.bounds
  const width = Math.max(b.maxX - b.minX, (b.maxY - b.minY) * aspect) * 1.02
  const height = width / aspect
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  const { frame } = vector
  const cos = Math.cos(frame.yaw)
  const sin = Math.sin(frame.yaw)
  const toWorld = (lx: number, lz: number): [number, number] => [
    frame.origin[0] + lx * cos + lz * sin,
    frame.origin[2] - lx * sin + lz * cos,
  ]
  // the cut line's point under the drawing's centre, at depth 0
  const [px, pz] = toWorld(frame.planOrigin[0] + frame.right[0] * cx, frame.planOrigin[1] + frame.right[1] * cx)
  const ty = frame.origin[1] - cy
  const [fx, fz] = [frame.forward[0] * cos + frame.forward[1] * sin, -frame.forward[0] * sin + frame.forward[1] * cos]
  const distance = 80
  const target: [number, number, number] = [px, ty, pz]
  const position: [number, number, number] = [px - fx * distance, ty, pz - fz * distance]
  // WORLD clipping planes: three keeps a fragment where normal · p + constant ≥ 0
  // — the first keeps what lies beyond the cut, the second what lies within
  // the section's depth
  const depth = frame.depth ?? 12
  const clip = [
    { normal: [fx, 0, fz] as [number, number, number], constant: -(fx * px + fz * pz) },
    {
      normal: [-fx, 0, -fz] as [number, number, number],
      constant: fx * (px + fx * depth) + fz * (pz + fz * depth),
    },
  ]
  const hash = elevationCaptureHash(nodes)
  const raw = await withFinishedPresentation(() =>
    withSiteSurfaceHidden(() =>
      capturePipeline(20000, {
        transparent: true,
        edges: 'soft',
        ortho: { position, target, viewWidth: width },
        lightFace: true,
        clip,
        supersample: PICTURE_SUPERSAMPLE,
      }),
    ),
  )
  if (process.env.NODE_ENV !== 'production') {
    ;(window as unknown as { __pascalLastCapture?: unknown }).__pascalLastCapture = {
      raw,
      position,
      target,
      width,
      height,
      bounds: b,
      frame,
      clip,
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
  const dataUrl = await toJpeg(raw, options.maxWidth ?? PICTURE_MAX_WIDTH)
  if (!dataUrl) {
    return { ok: false, reason: 'The captured frame came back blank — the viewer rendered nothing beyond the section plane.' }
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

/** `n` turns of the event loop from now (MessageChannel macrotasks — not throttled in a hidden tab). */
function settledTurns(n: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) => {
      if (left <= 0) return resolve()
      const channel = new MessageChannel()
      channel.port1.onmessage = () => {
        channel.port1.close()
        step(left - 1)
      }
      channel.port2.postMessage(null)
    }
    step(n)
  })
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
    /** World clipping planes for the frame (a section's cut). */
    clip?: readonly { normal: [number, number, number]; constant: number }[]
    /** Render at this multiple of the canvas' size (print-scale pictures). */
    supersample?: number
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
      // a supersampled frame goes through the 'standard' mode at the enlarged
      // size — the 'viewport' mode clamps its copy to 2048 px on the long edge
      const canvas = viewerCanvas()
      const supersample = options.supersample ?? 1
      const sized =
        supersample > 1 && canvas
          ? {
              captureMode: 'standard' as const,
              standardSize: { w: Math.round(canvas.width * supersample), h: Math.round(canvas.height * supersample) },
            }
          : { captureMode: 'viewport' as const }
      emit('camera-controls:generate-thumbnail', { ...sized, ...options })
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
      if (isBlank(img)) return resolve(undefined)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.92))
    }
    img.onerror = () => resolve(undefined)
    img.src = dataUrl
  })
}

/**
 * A frame with nothing in it: fewer than one pixel in two thousand carries
 * any alpha (the captures are transparent), or — an opaque frame — every
 * sampled pixel is the same colour. Read once from a small copy; the old
 * test sampled a white-filled copy at 24 columns and called a brightly lit
 * face blank (the south elevation, 2026-09-10).
 */
function isBlank(img: HTMLImageElement): boolean {
  try {
    const w = Math.max(1, Math.min(256, img.naturalWidth || 1))
    const h = Math.max(1, Math.round(w * ((img.naturalHeight || 1) / (img.naturalWidth || 1))))
    const scratch = document.createElement('canvas')
    scratch.width = w
    scratch.height = h
    const ctx = scratch.getContext('2d', { willReadFrequently: true })
    if (!ctx) return false
    ctx.drawImage(img, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h).data
    let painted = 0
    let opaque = 0
    for (let i = 3; i < data.length; i += 4) {
      const a = data[i] ?? 0
      if (a > 8) painted++
      if (a > 250) opaque++
    }
    const n = w * h
    if (painted < n / 2000) return true
    if (opaque < n) return false
    const r0 = data[0] ?? 0
    const g0 = data[1] ?? 0
    const b0 = data[2] ?? 0
    let same = 0
    for (let i = 0; i < data.length; i += 4) {
      const delta = Math.abs((data[i] ?? 0) - r0) + Math.abs((data[i + 1] ?? 0) - g0) + Math.abs((data[i + 2] ?? 0) - b0)
      if (delta < 12) same++
    }
    return same / n > 0.995
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
