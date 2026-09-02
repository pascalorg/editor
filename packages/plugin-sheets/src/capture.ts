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
import { emitter } from '@pascal-app/core'
import { subscribeCameraPose } from '@pascal-app/editor'
import { sceneNodes, updateViewport } from './model'
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

  const restore = currentPose()
  // `camera:go-to-position` drives CameraControls.setLookAt directly
  // (thumbnail-generator.tsx) — the shortest path to "put the camera exactly
  // here". `camera-controls:apply-pose` is sent as well so the pose store and
  // any projection switch stay in step.
  emit('camera-controls:apply-pose', {
    position: pose.position,
    target: pose.target,
    projection: 'perspective',
    fov: 60,
  })
  emit('camera:go-to-position', { position: pose.position, target: pose.target })
  // The move is animated; let it settle before the render.
  await wait(1400)

  // The snapshot pipeline builds an SSGI pass on first use, which can take
  // several seconds on a cold WebGPU device — hence the generous window.
  const raw = await capturePipeline(20000)
  if (restore) {
    emit('camera-controls:apply-pose', restore)
    emit('camera:go-to-position', { position: restore.position, target: restore.target })
  }
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
  if (options.persist !== false) updateViewport(viewport.id, { dataUrl })
  return { ok: true, dataUrl }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function capturePipeline(timeoutMs: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    let done = false
    const finish = (value?: string) => {
      if (done) return
      done = true
      window.removeEventListener('pascal:thumbnail', onThumb as EventListener)
      resolve(value)
    }
    const onThumb = (event: CustomEvent<{ blob: Blob }>) => {
      const blob = event.detail?.blob
      if (!blob) return finish(undefined)
      const reader = new FileReader()
      reader.onload = () => finish(typeof reader.result === 'string' ? reader.result : undefined)
      reader.onerror = () => finish(undefined)
      reader.readAsDataURL(blob)
    }
    window.addEventListener('pascal:thumbnail', onThumb as EventListener)
    try {
      emit('camera-controls:generate-thumbnail', { captureMode: 'viewport' })
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
