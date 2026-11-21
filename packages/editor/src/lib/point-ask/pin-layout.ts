import type { Rect, ScreenPoint } from './types'

const PIN_SPACING = 36

/** Keep each marker's hit area separate, choosing the nearest free slot around its true anchor. */
export function spreadPinMarkers(
  pins: readonly (ScreenPoint & { id: string })[],
  bounds: Rect,
): Map<string, ScreenPoint> {
  const placed = new Map<string, ScreenPoint>()
  const maxRing = Math.ceil(Math.max(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0) / PIN_SPACING)
  for (const pin of pins) {
    const origin = {
      x: Math.min(Math.max(pin.x, bounds.x0), bounds.x1),
      y: Math.min(Math.max(pin.y, bounds.y0), bounds.y1),
    }
    const free = (point: ScreenPoint) =>
      point.x >= bounds.x0 &&
      point.x <= bounds.x1 &&
      point.y >= bounds.y0 &&
      point.y <= bounds.y1 &&
      [...placed.values()].every(
        (other) =>
          Math.abs(point.x - other.x) >= PIN_SPACING || Math.abs(point.y - other.y) >= PIN_SPACING,
      )
    let position: ScreenPoint | undefined
    for (let ring = 0; ring <= maxRing && !position; ring++) {
      const candidates: ScreenPoint[] = []
      for (let dx = -ring; dx <= ring; dx++)
        for (let dy = -ring; dy <= ring; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
          candidates.push({ x: origin.x + dx * PIN_SPACING, y: origin.y + dy * PIN_SPACING })
        }
      candidates.sort(
        (a, b) => Math.hypot(a.x - pin.x, a.y - pin.y) - Math.hypot(b.x - pin.x, b.y - pin.y),
      )
      position = candidates.find(free)
    }
    placed.set(pin.id, position ?? origin)
  }
  return placed
}
