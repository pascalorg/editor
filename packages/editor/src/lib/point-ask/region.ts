import { formatLinearMeasurement } from '../measurements'
import type { Rect, ScreenPoint } from './types'

// A region is a view, not a selection (spec 2.3, "A region is a view, not a selection"): a
// rectangle dragged on the canvas, its size shown live in metres, the crop it frames, and what lies
// inside it ranked for the agent. Pure: the camera is handed in as a ray function.

const MIN_SIDE_PX = 24
const RAY_EPSILON = 1e-6

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/** The rectangle between two drag points, whichever way it was dragged, kept inside `bounds`. */
export function rectFromDrag(a: ScreenPoint, b: ScreenPoint, bounds: Rect): Rect {
  return {
    x0: clamp(Math.min(a.x, b.x), bounds.x0, bounds.x1),
    y0: clamp(Math.min(a.y, b.y), bounds.y0, bounds.y1),
    x1: clamp(Math.max(a.x, b.x), bounds.x0, bounds.x1),
    y1: clamp(Math.max(a.y, b.y), bounds.y0, bounds.y1),
  }
}

/** Under 24 px on a side it is a click that wobbled, not a region. */
export function isRegionBigEnough(rect: Rect): boolean {
  return rect.x1 - rect.x0 >= MIN_SIDE_PX && rect.y1 - rect.y0 >= MIN_SIDE_PX
}

/** The rectangle as 0-1 fractions of the canvas's full frame: [left, top, right, bottom]. */
export function regionFractions(
  rect: Rect,
  canvas: { left: number; top: number; width: number; height: number },
): [number, number, number, number] {
  const fraction = (value: number, origin: number, extent: number) =>
    clamp((value - origin) / extent, 0, 1)
  return [
    fraction(rect.x0, canvas.left, canvas.width),
    fraction(rect.y0, canvas.top, canvas.height),
    fraction(rect.x1, canvas.left, canvas.width),
    fraction(rect.y1, canvas.top, canvas.height),
  ]
}

type Ray = { origin: [number, number, number]; direction: [number, number, number] }

/** Where a ray meets the horizontal plane `y = planeY` in front of it; null when it points up or along it. */
function hitPlane(ray: Ray | null, planeY: number): [number, number, number] | null {
  if (!ray || ray.direction[1] >= -RAY_EPSILON) return null
  const t = (planeY - ray.origin[1]) / ray.direction[1]
  if (!Number.isFinite(t) || t < 0) return null
  return [ray.origin[0] + ray.direction[0] * t, planeY, ray.origin[2] + ray.direction[2] * t]
}

const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0))

/**
 * What the rectangle spans on the ground, in metres: the rays through the middle of its four sides
 * meet the plane at `planeY` (the level's floor), and the width and depth are the distances between
 * opposite hits. Null when any of the four misses the plane (the sky in a corner of the frame).
 */
export function regionSizeMetres(
  rect: Rect,
  cameraRay: (x: number, y: number) => Ray | null,
  planeY: number,
): { width: number; depth: number } | null {
  const midX = (rect.x0 + rect.x1) / 2
  const midY = (rect.y0 + rect.y1) / 2
  const left = hitPlane(cameraRay(rect.x0, midY), planeY)
  const right = hitPlane(cameraRay(rect.x1, midY), planeY)
  const top = hitPlane(cameraRay(midX, rect.y0), planeY)
  const bottom = hitPlane(cameraRay(midX, rect.y1), planeY)
  if (!(left && right && top && bottom)) return null
  return { width: distance(left, right), depth: distance(top, bottom) }
}

/** "4.2 × 3.1 m", or feet and inches as the editor writes them. */
export function formatRegionSize(
  size: { width: number; depth: number },
  unit: 'metric' | 'imperial',
): string {
  if (unit === 'imperial')
    return `${formatLinearMeasurement(size.width, 'imperial')} × ${formatLinearMeasurement(size.depth, 'imperial')}`
  return `${size.width.toFixed(1)} × ${size.depth.toFixed(1)} m`
}

const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
  Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0))

/**
 * What the region shows, by how much of it each element covers, the biggest first, ties by id so
 * the same view ranks the same way; elements that only touch an edge, or have no box on screen,
 * are not in it. The top `limit` are named, the rest only counted.
 */
export function rankInRegion(
  candidates: readonly { id: string; rect: Rect | null }[],
  region: Rect,
  limit = 12,
): { ids: string[]; more: number } {
  const ranked = candidates
    .flatMap(({ id, rect }) => {
      const area = rect ? overlapArea(rect, region) : 0
      return area > 0 ? [{ id, area }] : []
    })
    .sort((a, b) => b.area - a.area || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return {
    ids: ranked.slice(0, limit).map((entry) => entry.id),
    more: Math.max(0, ranked.length - limit),
  }
}

/** The region chip's words: "Area · 6 elements". */
export function regionLabel(count: number): string {
  if (count <= 0) return 'Area'
  return `Area · ${count} element${count === 1 ? '' : 's'}`
}

/**
 * Where the bubble's tail points on the rectangle: the release point put on its nearest edge. A
 * point outside is clamped onto the rectangle; one inside is pushed out to the closest side.
 */
export function nearestEdgePoint(rect: Rect, to: ScreenPoint): ScreenPoint {
  const x = clamp(to.x, rect.x0, rect.x1)
  const y = clamp(to.y, rect.y0, rect.y1)
  const inside = to.x > rect.x0 && to.x < rect.x1 && to.y > rect.y0 && to.y < rect.y1
  if (!inside) return { x, y }
  const toLeft = x - rect.x0
  const toRight = rect.x1 - x
  const toTop = y - rect.y0
  const toBottom = rect.y1 - y
  const nearest = Math.min(toLeft, toRight, toTop, toBottom)
  if (nearest === toRight) return { x: rect.x1, y }
  if (nearest === toLeft) return { x: rect.x0, y }
  if (nearest === toTop) return { x, y: rect.y0 }
  return { x, y: rect.y1 }
}
