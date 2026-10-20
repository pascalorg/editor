import type { Rect, ScreenPoint } from './types'

/**
 * Where the edge marker of an off-screen pin goes: on the viewport's inset edge, on the line from
 * the viewport's centre towards the pin, turned to point at it. Null when the pin is in view; a
 * pin behind the camera (`point` null) has no direction, so its marker sits at the bottom.
 */
export function edgeMarker(
  point: ScreenPoint | null,
  viewport: Rect,
  inset = 18,
): { x: number; y: number; angle: number } | null {
  const cx = (viewport.x0 + viewport.x1) / 2
  const cy = (viewport.y0 + viewport.y1) / 2
  const hw = (viewport.x1 - viewport.x0) / 2 - inset
  const hh = (viewport.y1 - viewport.y0) / 2 - inset
  if (!point) return { x: cx, y: cy + hh, angle: 90 }
  const dx = point.x - cx
  const dy = point.y - cy
  if (Math.abs(dx) <= hw + inset && Math.abs(dy) <= hh + inset) return null
  // Scale the direction until it touches the inset rectangle.
  const scale = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : hw / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : hh / Math.abs(dy),
  )
  return { x: cx + dx * scale, y: cy + dy * scale, angle: (Math.atan2(dy, dx) * 180) / Math.PI }
}
