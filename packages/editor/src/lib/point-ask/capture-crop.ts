import {
  emitter,
  type SnapshotCapturedEvent,
  type SnapshotCaptureFailedEvent,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { canvasRect } from './projector'
import type { Rect } from './types'

// The picture an ask carries as evidence (spec 2.4): the targets' screen box padded 25%, at least
// 512 px on its long side, rendered by the snapshot pipeline as an ephemeral frame so nothing is
// stored. Started at pointer-down, so it is ready by the time the person has typed.

const CROP_LONG_SIDE_MIN = 512
const CROP_LONG_SIDE_MAX = 768
const CAPTURE_TIMEOUT_MS = 12_000

export type CapturedCrop = { dataUrl: string; width: number; height: number }

/** The target's box padded by `pad` of its size on every side, and kept inside the canvas. */
export function paddedCropRect(
  box: Rect,
  canvas: { width: number; height: number },
  pad = 0.25,
): Rect {
  const w = Math.max(48, box.x1 - box.x0)
  const h = Math.max(48, box.y1 - box.y0)
  const cx = (box.x0 + box.x1) / 2
  const cy = (box.y0 + box.y1) / 2
  const half = { x: (w * (1 + pad * 2)) / 2, y: (h * (1 + pad * 2)) / 2 }
  return {
    x0: Math.max(0, cx - half.x),
    y0: Math.max(0, cy - half.y),
    x1: Math.min(canvas.width, cx + half.x),
    y1: Math.min(canvas.height, cy + half.y),
  }
}

/** A rectangle as 0-1 fractions of the frame, for the snapshot pipeline's `cropRegion`. */
export function toCropRegion(rect: Rect, canvas: { width: number; height: number }) {
  return {
    x: rect.x0 / canvas.width,
    y: rect.y0 / canvas.height,
    width: (rect.x1 - rect.x0) / canvas.width,
    height: (rect.y1 - rect.y0) / canvas.height,
  }
}

async function blobToScaledDataUrl(blob: Blob): Promise<CapturedCrop> {
  const bitmap = await createImageBitmap(blob)
  const long = Math.max(bitmap.width, bitmap.height)
  const scale =
    long > CROP_LONG_SIDE_MAX ? CROP_LONG_SIDE_MAX / long : long < CROP_LONG_SIDE_MIN ? 1 : 1
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No 2D canvas to scale the picture')
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.84), width, height }
}

const BUSY = 'Another snapshot is being captured'
const BUSY_RETRY_MS = 1_500

/**
 * One crop of the current view over `screenRect` (viewport pixels); once more after 1.5 s when
 * another capture (the agent's own view) holds the renderer. Rejects when the 3D canvas cannot
 * answer in time (a hidden tab, a busy renderer): the ask then goes without a picture.
 */
export async function captureViewCrop(
  screenRect: Rect,
  options: { pad?: number } = {},
): Promise<CapturedCrop> {
  try {
    return await captureOnce(screenRect, options)
  } catch (error) {
    if (!(error instanceof Error && error.message.startsWith(BUSY))) throw error
    await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_MS))
    return captureOnce(screenRect, options)
  }
}

function captureOnce(screenRect: Rect, options: { pad?: number }): Promise<CapturedCrop> {
  const rect = canvasRect()
  const projectId = useViewer.getState().projectId
  if (!rect || !projectId) return Promise.reject(new Error('The 3D view is not ready'))
  const local: Rect = {
    x0: screenRect.x0 - rect.left,
    y0: screenRect.y0 - rect.top,
    x1: screenRect.x1 - rect.left,
    y1: screenRect.y1 - rect.top,
  }
  const cropRegion = toCropRegion(paddedCropRect(local, rect, options.pad ?? 0.25), rect)
  const requestId = `point-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  return new Promise((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer)
      emitter.off('snapshot:captured', onCaptured)
      emitter.off('snapshot:capture-failed', onFailed)
    }
    const onCaptured = (event: SnapshotCapturedEvent) => {
      if (event.requestId !== requestId) return
      stop()
      blobToScaledDataUrl(event.blob).then(resolve, reject)
    }
    const onFailed = (event: SnapshotCaptureFailedEvent) => {
      if (event.requestId !== requestId) return
      stop()
      reject(new Error(event.error))
    }
    const timer = setTimeout(() => {
      stop()
      reject(new Error('No picture came back from the 3D view'))
    }, CAPTURE_TIMEOUT_MS)
    emitter.on('snapshot:captured', onCaptured)
    emitter.on('snapshot:capture-failed', onFailed)
    emitter.emit('camera-controls:generate-thumbnail', {
      projectId,
      requestId,
      ephemeral: true,
      captureMode: 'area',
      cropRegion,
    })
  })
}
