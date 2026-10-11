import type { AnyNode, LevelNode, WallNode } from '../schema'
import { getStoredLevelHeight } from '../services/storey'
import { getWallCurveFrameAt, getWallCurveLength } from '../systems/wall/wall-curve'
import { resolveWallTop } from '../systems/wall/wall-top'
import type { BalconyPoint } from './balcony'
import { wallBaseElevationIn } from './wall-support-in'

export type BalconyEdge = [BalconyPoint, BalconyPoint]

/** Subtract wall-covered intervals; a perpendicular wall touching a corner is not an attachment. */
export function exposedBalconyEdges(
  edges: BalconyEdge[],
  walls: readonly WallNode[],
  level: LevelNode,
  elevation: number,
  nodes: Record<string, AnyNode> = {},
): BalconyEdge[] {
  const context = nodes[level.id] === level ? nodes : { ...nodes, [level.id]: level }
  const segments = walls
    .filter((w) => w.parentId === level.id && w.visible !== false)
    .flatMap((w) => {
      const base = wallBaseElevationIn(w, context)
      if (
        base > elevation + 0.05 ||
        resolveWallTop(w, getStoredLevelHeight(level), base) < elevation + 0.3
      )
        return []
      const count = w.curveOffset
        ? Math.min(256, Math.max(8, Math.ceil(getWallCurveLength(w) / 0.1)))
        : 1
      const points = Array.from({ length: count + 1 }, (_, i): BalconyPoint => {
        const p = getWallCurveFrameAt(w, i / count).point
        return [p.x, p.y]
      })
      return points
        .slice(1)
        .map((end, i) => ({ start: points[i]!, end, tolerance: (w.thickness ?? 0.2) / 2 + 0.025 }))
    })
  return edges.flatMap(([a, b]) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (length < 0.001) return []
    const ux = (b[0] - a[0]) / length,
      uy = (b[1] - a[1]) / length
    const project = (p: BalconyPoint) =>
      [(p[0] - a[0]) * ux + (p[1] - a[1]) * uy, -(p[0] - a[0]) * uy + (p[1] - a[1]) * ux] as const
    const covered = segments
      .flatMap(({ start, end, tolerance }) => {
        const p = project(start),
          q = project(end)
        if (Math.abs(q[1] - p[1]) > Math.abs(q[0] - p[0]) * 0.09) return []
        let from = 0,
          to = 1
        const delta = q[1] - p[1]
        if (Math.abs(delta) < 1e-8) {
          if (Math.abs(p[1]) > tolerance) return []
        } else {
          const t0 = (-tolerance - p[1]) / delta,
            t1 = (tolerance - p[1]) / delta
          from = Math.max(0, Math.min(t0, t1))
          to = Math.min(1, Math.max(t0, t1))
          if (to <= from) return []
        }
        const x = p[0] + from * (q[0] - p[0]),
          y = p[0] + to * (q[0] - p[0])
        const lo = Math.max(0, Math.min(x, y)),
          hi = Math.min(length, Math.max(x, y))
        return hi - lo > 0.001 ? [[lo, hi] as const] : []
      })
      .sort((a, b) => a[0] - b[0])
    const at = (t: number): BalconyPoint => [a[0] + ux * t, a[1] + uy * t]
    const result: BalconyEdge[] = []
    let cursor = 0
    for (const [lo, hi] of covered) {
      if (lo - cursor > 0.001) result.push([at(cursor), at(lo)])
      cursor = Math.max(cursor, hi)
    }
    if (length - cursor > 0.001) result.push([at(cursor), at(length)])
    return result
  })
}
