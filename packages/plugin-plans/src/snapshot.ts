/**
 * The 3D viewport snapshot for the cover sheet.
 *
 * The viewer runs frameloop="never" on a WebGPU renderer, so a bare
 * `canvas.toDataURL()` usually reads back an already-cleared buffer (the
 * built-in "Take Screenshot" has the same weakness). The supported path is
 * the editor's own snapshot pipeline: emit `camera-controls:generate-
 * thumbnail`, the ThumbnailGenerator renders explicitly (gizmos hidden,
 * theme backdrop composited) and hands the host a Blob through
 * `onThumbnailCapture` — which apps/editor/app/page.tsx re-broadcasts as a
 * `pascal:thumbnail` DOM event for us. Fallback: the canvas read-back.
 *
 * The result is re-encoded as JPEG: the sheet engine sniffs PNG/JPEG headers
 * to size the image (run-sheets.ts sniffDataUrlDims); webp would be dropped.
 */
import { emitter } from '@pascal-app/core'

export async function captureViewport(maxWidth = 1600): Promise<string | undefined> {
  const viaPipeline = await capturePipeline(4000)
  if (viaPipeline) return toJpeg(viaPipeline, maxWidth)
  const canvas = document.querySelector('canvas') as HTMLCanvasElement | null
  if (!canvas || !canvas.width || !canvas.height) return undefined
  try {
    const url = await toJpeg(canvas.toDataURL('image/png'), maxWidth)
    return url
  } catch {
    return undefined
  }
}

function capturePipeline(timeoutMs: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    let done = false
    const finish = (v?: string) => {
      if (done) return
      done = true
      window.removeEventListener('pascal:thumbnail', onThumb as EventListener)
      resolve(v)
    }
    const onThumb = (e: CustomEvent<{ blob: Blob }>) => {
      const blob = e.detail?.blob
      if (!blob) return finish(undefined)
      const r = new FileReader()
      r.onload = () => finish(typeof r.result === 'string' ? r.result : undefined)
      r.onerror = () => finish(undefined)
      r.readAsDataURL(blob)
    }
    window.addEventListener('pascal:thumbnail', onThumb as EventListener)
    try {
      // 'viewport' = exactly what the user sees, at the viewport's own size
      ;(emitter as { emit: (name: string, payload: unknown) => void }).emit('camera-controls:generate-thumbnail', { captureMode: 'viewport' })
    } catch {
      finish(undefined)
    }
    setTimeout(() => finish(undefined), timeoutMs)
  })
}

/** Re-encode any image data URL as a bounded-width JPEG; undefined when the frame is blank. */
function toJpeg(dataUrl: string, maxWidth: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxWidth / (img.naturalWidth || maxWidth))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale))
      c.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale))
      const ctx = c.getContext('2d')
      if (!ctx) return resolve(undefined)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.drawImage(img, 0, 0, c.width, c.height)
      resolve(isBlank(ctx, c.width, c.height) ? undefined : c.toDataURL('image/jpeg', 0.9))
    }
    img.onerror = () => resolve(undefined)
    img.src = dataUrl
  })
}

function isBlank(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const step = Math.max(1, Math.floor(w / 24))
    let same = 0
    let n = 0
    const first = ctx.getImageData(0, 0, 1, 1).data
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const d = ctx.getImageData(x, y, 1, 1).data
        n++
        if (Math.abs(d[0] - first[0]) + Math.abs(d[1] - first[1]) + Math.abs(d[2] - first[2]) < 12) same++
      }
    }
    // a frame that is one flat colour everywhere is not a view of anything
    return n > 0 && same / n > 0.985
  } catch {
    return false
  }
}
