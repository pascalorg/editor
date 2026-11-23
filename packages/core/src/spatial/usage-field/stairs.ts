import { area } from '../../lib/polygon-boolean'
import type { AnyNode, StairNode } from '../../schema'
import {
  resolveStairWalkingSurfaces,
  type StairBodySurface,
  type StairWalkingSurface,
  stairSourceFrame,
} from '../../systems/stair/stair-clearance'
import { rotateXZ } from '../../systems/stair/stair-footprint'
import { resolveStairRailPaths } from '../../systems/stair/stair-rail-path'
import type { Prism, Ring, Skipped } from './types'
import type { Nodes } from './walls'

/**
 * A sloped member (a soffit, a rail, a glass pane) is cut into slices that rise this much each, so
 * its prism height stays within this of the member's own at any point along it.
 */
export const SLOPE_STEP_M = 0.05

const MIN_AREA_M2 = 1e-7

type Point = [number, number]
type Place = (x: number, z: number) => Point

export type StairShapes = { stairId: string; levelId: string | null; prisms: Prism[] }

/** Convex hull of up to a few points, counter-clockwise. */
function hull(points: Point[]): Ring {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: Point, a: Point, b: Point) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (list: Point[]) => {
    const out: Point[] = []
    for (const p of list) {
      while (out.length >= 2 && cross(out.at(-2)!, out.at(-1)!, p) <= 1e-12) out.pop()
      out.push(p)
    }
    out.pop()
    return out
  }
  return [...half(sorted), ...half(sorted.reverse())]
}

/** The part of a polygon where `value` is at least zero (Sutherland–Hodgman against one half-plane). */
function clipAbove(ring: Ring, value: (p: Point) => number): Ring {
  const out: Ring = []
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!
    const q = ring[(i + 1) % ring.length]!
    const vp = value(p)
    const vq = value(q)
    if (vp >= 0) out.push(p)
    if (vp >= 0 !== vq >= 0) {
      const t = vp / (vp - vq)
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])
    }
  }
  return out
}

const ringArea = (ring: Ring) => area([{ outer: ring, holes: [] }])

type Common = Pick<Prism, 'nodeId' | 'kind' | 'shape' | 'why'>

/**
 * A body of a stair: its walking region from its soffit up to its top. A soffit that slopes (an
 * open flight) is cut into slices where it rises `SLOPE_STEP_M`, each from the lowest the soffit
 * gets inside it, so the headroom under a flight is read to within that step.
 */
function bodyPrisms(
  id: string,
  body: Pick<StairBodySurface, 'region' | 'underside' | 'undersideFloor' | 'top'>,
  common: Common,
  out: Prism[],
) {
  const [a, b, c] = body.underside
  const floor = body.undersideFloor ?? Number.NEGATIVE_INFINITY
  const outer = body.region.outer
  const sloped = Math.abs(a) + Math.abs(b) > 1e-9 && body.region.holes.length === 0
  const soffit = (p: Point) => a * p[0] + b * p[1] + c
  const heights = outer.map(soffit)
  const lowest = Math.min(...heights)
  const slices = sloped ? Math.max(1, Math.ceil((Math.max(...heights) - lowest) / SLOPE_STEP_M)) : 1
  for (let k = 0; k < slices; k++) {
    const piece =
      slices === 1
        ? outer
        : clipAbove(
            clipAbove(outer, (p) => soffit(p) - (lowest + k * SLOPE_STEP_M)),
            (p) => lowest + (k + 1) * SLOPE_STEP_M - soffit(p),
          )
    if (piece.length < 3 || (slices > 1 && ringArea(piece) < MIN_AREA_M2)) continue
    const z0 = Math.max(slices === 1 ? lowest : lowest + k * SLOPE_STEP_M, floor)
    if (body.top - z0 > 1e-4)
      out.push({
        id: slices === 1 ? id : `${id}.${k}`,
        z0,
        z1: body.top,
        outer: piece,
        holes: slices === 1 ? body.region.holes : [],
        ...common,
      })
  }
}

/** What a stair's guard fills in the clearance: its rail line, a hand wide, from the nosing to the rail. */
const GUARD_WIDTH_M = 0.08
const DEFAULT_RAIL_HEIGHT_M = 0.9

/**
 * The guard along each rail path, as slices of the line it follows: a slice rises `SLOPE_STEP_M`,
 * so a rail high over a walkway does not block it. Its posts, balusters and panes are not drawn
 * one by one.
 */
function railPrisms(stair: StairNode, nodes: Nodes, base: number, place: Place, out: Prism[]) {
  if (stair.destinationSurfaceId || stair.railingMode === 'none') return
  const height = stair.railingHeight ?? DEFAULT_RAIL_HEIGHT_M
  const common: Common = {
    nodeId: stair.id,
    kind: 'stair-rail',
    shape: 'approx',
    why: 'the stair guard is read as its rail line, a hand wide',
  }
  resolveStairRailPaths(stair, nodes).forEach((path, index) => {
    for (const [i, from] of path.points.slice(0, -1).entries()) {
      const to = path.points[i + 1] as [number, number, number]
      const slices = Math.max(1, Math.ceil(Math.abs(to[1] - from[1]) / SLOPE_STEP_M))
      const length = Math.hypot(to[0] - from[0], to[2] - from[2])
      const [nx, nz] =
        length > 1e-6 ? [(from[2] - to[2]) / length, (to[0] - from[0]) / length] : [0, 1]
      const at = (t: number): [number, number, number] => [
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        from[2] + (to[2] - from[2]) * t,
      ]
      for (let k = 0; k < slices; k++) {
        const [a, b] = [at(k / slices), at((k + 1) / slices)]
        const half = GUARD_WIDTH_M / 2
        out.push({
          id: `${stair.id}#rail.${path.side}.${index}.${i}.${k}`,
          z0: base + Math.min(a[1], b[1]),
          z1: base + Math.max(a[1], b[1]) + height,
          outer: hull(
            [a, b].flatMap(([x, , z]) => [
              place(x + nx * half, z + nz * half),
              place(x - nx * half, z - nz * half),
            ]),
          ),
          holes: [],
          ...common,
        })
      }
    }
  })
}

function treadPrisms(stair: StairNode, nodes: Nodes, out: Prism[]) {
  const common: Common = { nodeId: stair.id, kind: 'stair', shape: 'exact' }
  for (const surface of resolveStairWalkingSurfaces(stair, nodes) as StairWalkingSurface[]) {
    const prefix = `${stair.id}#${surface.nodeId}.${surface.index}`
    const solids: Pick<StairBodySurface, 'region' | 'underside' | 'undersideFloor' | 'top'>[] =
      surface.bodies ?? [surface]
    for (const [i, solid] of solids.entries()) bodyPrisms(`${prefix}.${i}`, solid, common, out)
  }
}

/**
 * Every stair's treads, landings and guards as prisms in absolute building metres, each filed under
 * the level the stair starts from. A stair the resolvers refuse (their detail budgets) is named in
 * `skipped` and leaves the others alone; the independent handrail is not drawn here and is counted.
 */
export function stairBodies(nodes: Nodes): {
  stairs: StairShapes[]
  skipped: Skipped[]
  handrails: number
} {
  const stairs: StairShapes[] = []
  const skipped: Skipped[] = []
  let handrails = 0
  for (const node of Object.values(nodes) as AnyNode[]) {
    if (node.type !== 'stair') continue
    try {
      const frame = stairSourceFrame(node, nodes)
      const place: Place = (x, z) => {
        const [dx, dz] = rotateXZ(x, z, node.rotation)
        return [node.position[0] + dx, node.position[2] + dz]
      }
      const prisms: Prism[] = []
      treadPrisms(node, nodes, prisms)
      railPrisms(node, nodes, frame.base, place, prisms)
      if (node.handrail && !node.destinationSurfaceId) handrails += 1
      stairs.push({ stairId: node.id, levelId: frame.sourceId, prisms })
    } catch (error) {
      skipped.push({ nodeId: node.id, why: error instanceof Error ? error.message : String(error) })
    }
  }
  return { stairs, skipped, handrails }
}
