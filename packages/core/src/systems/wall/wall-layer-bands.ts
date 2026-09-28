import { type ResolvedAssembly, resolveAssemblyStack } from '../../lib/assembly-stack'
import { type Point2D as PlanTuple, subtractPolygonsFromPolygon } from '../../lib/polygon-union'
import type { Assembly, WallNode } from '../../schema'
import { resolveWallExteriorSide } from './wall-assembly'
import { getWallCurveFrameAt, isCurvedWall } from './wall-curve'
import {
  CURVED_WALL_SURFACE_SEGMENTS,
  getWallPlanFootprint,
  getWallThickness,
} from './wall-footprint'
import { getWallMiterBoundaryPoints, type Point2D, type WallMiterData } from './wall-mitering'

const EPSILON = 1e-9

/**
 * One assembly layer's share of a wall's plan footprint (F2 band math).
 * `back` and `front` are the band's faces as signed offsets from the wall
 * centreline along the front normal (+n), so `back < front` and the front
 * face of the wall is at +thickness/2.
 */
export type WallLayerBand = {
  layerId: string
  back: number
  front: number
  /** The mitred footprint ∩ the band's offset strip, as counter-clockwise plan rings. */
  polygons: Point2D[][]
}

export type WallLayerBands = ResolvedAssembly & { bands: WallLayerBand[] }

/**
 * Slices a wall's mitred plan footprint into the bands of an assembly's layers
 * (F2 band math). Pure: nothing reads it yet (WL-02 extrudes the bands).
 *
 * The stack sets the body, so the bands tile exactly the footprint that
 * mitering, rooms and 2D already use once `thickness` holds the layer sum. A
 * wall whose stored thickness disagrees gets the `assembly.thickness-mismatch`
 * diagnostic and no bands: it keeps its plain body until a writer re-derives
 * the thickness. Layers stack from the front face (+n), or from the exterior
 * face with `face: 'exterior'` (`resolveWallExteriorSide`, front as fallback).
 *
 * Straight walls intersect the footprint with half-plane strips through the
 * core polygon booleans, which handles the junction vertex a mitred end cap
 * may carry. A curved footprint's end caps are single segments, so its bands
 * resample the footprint's own arcs at the band offsets and interpolate along
 * each cap.
 */
export function getWallLayerBands(
  wall: WallNode,
  assembly: Assembly,
  miterData: WallMiterData,
): WallLayerBands {
  const thickness = getWallThickness(wall)
  // Walls store the body as `thickness` and take no backing.
  const stack = resolveAssemblyStack(assembly, { body: thickness })
  if (stack.diagnostics.some((d) => d.code === 'assembly.thickness-mismatch')) {
    return { ...stack, bands: [] }
  }
  const half = thickness / 2
  // +1 when the first listed layer is on the front face, −1 when it is on the back.
  const sign = assembly.face === 'exterior' ? (resolveWallExteriorSide(wall) ?? 1) : 1
  const footprint = getWallPlanFootprint(wall, miterData)
  const curved = isCurvedWall(wall)

  const bands: WallLayerBand[] = []
  for (const layer of stack.layers) {
    if (layer.thickness <= EPSILON) continue
    const outer = sign * (half - layer.depth)
    const inner = sign * (half - layer.depth - layer.thickness)
    const back = Math.min(outer, inner)
    const front = Math.max(outer, inner)
    let polygons: Point2D[][] = []
    if (footprint.length >= 3) {
      polygons = curved
        ? curvedBand(wall, miterData, thickness, back, front)
        : straightBand(wall, footprint, half, back, front)
    }
    bands.push({ layerId: layer.id, back, front, polygons })
  }
  return { ...stack, bands }
}

function straightBand(
  wall: WallNode,
  footprint: Point2D[],
  half: number,
  back: number,
  front: number,
): Point2D[][] {
  const [sx, sy] = wall.start
  const dx = wall.end[0] - sx
  const dy = wall.end[1] - sy
  const length = Math.hypot(dx, dy)
  const ux = dx / length
  const uy = dy / length
  const nx = -uy
  const ny = ux
  // Past every footprint point, mitre tips included.
  const reach = 1 + Math.max(...footprint.map((point) => Math.hypot(point.x - sx, point.y - sy)))
  const at = (along: number, offset: number): PlanTuple => [
    sx + ux * along + nx * offset,
    sy + uy * along + ny * offset,
  ]
  // Each cutter is the half-plane beyond one band face, clipped to a rectangle
  // that contains the whole footprint. A face on the wall's own face needs none.
  const strip = (from: number, to: number): PlanTuple[] => [
    at(-reach, from),
    at(length + reach, from),
    at(length + reach, to),
    at(-reach, to),
  ]
  const cutters: PlanTuple[][] = []
  if (front < half - EPSILON) cutters.push(strip(front, half + reach))
  if (back > -half + EPSILON) cutters.push(strip(-half - reach, back))

  const subject = footprint.map((point): PlanTuple => [point.x, point.y])
  return subtractPolygonsFromPolygon(subject, cutters).map((ring) =>
    ring.map(([x, y]) => ({ x, y })),
  )
}

function curvedBand(
  wall: WallNode,
  miterData: WallMiterData,
  thickness: number,
  back: number,
  front: number,
): Point2D[][] {
  const caps = getWallMiterBoundaryPoints(wall, miterData)
  if (!caps) return []
  const half = thickness / 2
  const along = (offset: number) => {
    const points: Point2D[] = []
    for (let index = 0; index <= CURVED_WALL_SURFACE_SEGMENTS; index++) {
      const frame = getWallCurveFrameAt(wall, index / CURVED_WALL_SURFACE_SEGMENTS)
      points.push({
        x: frame.point.x + frame.normal.x * offset,
        y: frame.point.y + frame.normal.y * offset,
      })
    }
    const t = (offset + half) / thickness
    points[0] = lerp(caps.startRight, caps.startLeft, t)
    points[points.length - 1] = lerp(caps.endRight, caps.endLeft, t)
    return points
  }
  return [[...along(back), ...along(front).reverse()]]
}

function lerp(a: Point2D, b: Point2D, t: number): Point2D {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}
