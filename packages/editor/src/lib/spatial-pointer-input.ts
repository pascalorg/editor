import type { Ray } from 'three'

type SpatialPointerCapture = {
  onMove: (ray: Ray) => void
  onRelease: () => void
  onCancel: () => void
}

export type SpatialPointerId = object | number | string

export function getSpatialPointerId(nativeEvent: unknown): SpatialPointerId | null {
  if (!nativeEvent || typeof nativeEvent !== 'object') return null
  const event = nativeEvent as {
    inputSource?: object
    pointerState?: { inputSource?: object }
  }
  return event.inputSource ?? event.pointerState?.inputSource ?? null
}

export class SpatialPointerInput {
  private readonly captures = new Map<SpatialPointerId, SpatialPointerCapture>()

  capture(pointerId: SpatialPointerId, capture: SpatialPointerCapture): () => void {
    this.captures.set(pointerId, capture)
    return () => {
      if (this.captures.get(pointerId) === capture) {
        this.captures.delete(pointerId)
      }
    }
  }

  move(pointerId: SpatialPointerId, ray: Ray): boolean {
    const capture = this.captures.get(pointerId)
    if (!capture) return false
    capture.onMove(ray)
    return true
  }

  release(pointerId: SpatialPointerId): boolean {
    const capture = this.captures.get(pointerId)
    if (!capture) return false
    this.captures.delete(pointerId)
    capture.onRelease()
    return true
  }

  cancel(pointerId: SpatialPointerId): boolean {
    const capture = this.captures.get(pointerId)
    if (!capture) return false
    this.captures.delete(pointerId)
    capture.onCancel()
    return true
  }
}

export const spatialPointerInput = new SpatialPointerInput()
