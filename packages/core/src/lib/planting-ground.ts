import type { PlantingNode } from '../schema/nodes/planting'
import { triangulatePlanPolygon } from './earcut'
import { linearColor, type MeshWriter, type Rgb, writeTriangle, writeVertex } from './foliage'
import type { GroundRead } from './ground-read'
import { type PlantingPoint, plantingArea, plantingEdgeDistance } from './planting-outline'
import { valueNoise3 } from './seeded-noise'

/** The bed dome is absent when the owner asks to leave the existing ground exposed. */
export function plantingGroundLift(
  node: Pick<PlantingNode, 'ground'>,
  outline: readonly PlantingPoint[],
  x: number,
  z: number,
): number {
  if (node.ground === 'none') return 0
  const t = Math.min(1, plantingEdgeDistance(outline, x, z) / 0.9)
  return 0.025 + 0.12 * t * t * (3 - 2 * t)
}

const middle = (a: PlantingPoint, b: PlantingPoint): PlantingPoint => [
  (a[0] + b[0]) / 2,
  (a[1] + b[1]) / 2,
]

/**
 * Roots stand on the rendered, piecewise-linear soil, not just its smooth analytical envelope.
 * Only polygon topology is retained; no vertex/normal/colour buffers are allocated by planning.
 */
export function plantingSurfaceHeight(
  node: PlantingNode,
  outline: readonly PlantingPoint[],
  ground: GroundRead,
): GroundRead['heightAt'] {
  if (node.ground === 'none') return ground.heightAt
  const triangles = triangulatePlanPolygon(outline)
  const inside = (a: PlantingPoint, b: PlantingPoint, c: PlantingPoint, x: number, z: number) => {
    const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if (Math.abs(denominator) < 1e-14) return null
    const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (z - c[1])) / denominator
    const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (z - c[1])) / denominator
    return u >= -1e-9 && v >= -1e-9 && u + v <= 1 + 1e-9 ? ([u, v, 1 - u - v] as const) : null
  }
  const sample = (
    a: PlantingPoint,
    b: PlantingPoint,
    c: PlantingPoint,
    x: number,
    z: number,
    depth: number,
  ): number | null => {
    const weights = inside(a, b, c, x, z)
    if (!weights) return null
    if (depth > 0) {
      const ab = middle(a, b)
      const bc = middle(b, c)
      const ca = middle(c, a)
      return (
        sample(a, ab, ca, x, z, depth - 1) ??
        sample(ab, b, bc, x, z, depth - 1) ??
        sample(ca, bc, c, x, z, depth - 1) ??
        sample(ab, bc, ca, x, z, depth - 1)
      )
    }
    if (ground.regionAt) {
      const region = ground.regionAt(x, z)
      for (const point of [a, b, c, middle(a, b), middle(b, c), middle(c, a)])
        if (ground.regionAt(...point) !== region) return Number.NaN
    }
    return (
      weights[0] * (ground.heightAt(...a) + plantingGroundLift(node, outline, ...a)) +
      weights[1] * (ground.heightAt(...b) + plantingGroundLift(node, outline, ...b)) +
      weights[2] * (ground.heightAt(...c) + plantingGroundLift(node, outline, ...c))
    )
  }
  return (x, z) => {
    for (const [a, b, c] of triangles) {
      const y = sample(
        outline[a] as PlantingPoint,
        outline[b] as PlantingPoint,
        outline[c] as PlantingPoint,
        x,
        z,
        2,
      )
      if (y !== null) return y
    }
    return Number.NaN
  }
}

function triangle(out: MeshWriter, a: Rgb, b: Rgb, c: Rgb, color: Rgb) {
  const ux = b[0] - a[0]
  const uy = b[1] - a[1]
  const uz = b[2] - a[2]
  const vx = c[0] - a[0]
  const vy = c[1] - a[1]
  const vz = c[2] - a[2]
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  const length = Math.hypot(nx, ny, nz) || 1
  const first = out.vertices
  for (const p of [a, b, c]) writeVertex(out, ...p, nx / length, ny / length, nz / length, ...color)
  writeTriangle(out, first, first + 1, first + 2)
}

/**
 * Count or write the same bounded surface. Triangulate the actual polygon rather than a centroid
 * fan (which would fill a concavity). Subdivision samples the shared dome and Site terrain.
 */
export function plantingGroundGeometry(
  node: PlantingNode,
  outline: readonly PlantingPoint[],
  ground: GroundRead,
  out?: MeshWriter,
): number {
  let triangles = 0
  const home = (a: Rgb, b: Rgb, c: Rgb) => {
    if (![...a, ...b, ...c].every(Number.isFinite)) return false
    if (!ground.regionAt) return true
    const region = ground.regionAt(a[0], a[2])
    return (
      ground.regionAt(b[0], b[2]) === region &&
      ground.regionAt(c[0], c[2]) === region &&
      ground.regionAt((a[0] + b[0]) / 2, (a[2] + b[2]) / 2) === region &&
      ground.regionAt((b[0] + c[0]) / 2, (b[2] + c[2]) / 2) === region &&
      ground.regionAt((c[0] + a[0]) / 2, (c[2] + a[2]) / 2) === region
    )
  }
  const emit = (a: Rgb, b: Rgb, c: Rgb, color: Rgb) => {
    if (!home(a, b, c)) return
    triangles++
    if (out) triangle(out, a, b, c, color)
  }
  if (node.ground !== 'none') {
    const color = linearColor(node.ground === 'soil' ? '#594333' : '#49392b')
    const height = (p: PlantingPoint): Rgb => [
      p[0],
      ground.heightAt(p[0], p[1]) + plantingGroundLift(node, outline, ...p),
      p[1],
    ]
    const face = (a: PlantingPoint, b: PlantingPoint, c: PlantingPoint, depth: number) => {
      if (depth > 0) {
        const ab = middle(a, b)
        const bc = middle(b, c)
        const ca = middle(c, a)
        face(a, ab, ca, depth - 1)
        face(ab, b, bc, depth - 1)
        face(ca, bc, c, depth - 1)
        face(ab, bc, ca, depth - 1)
        return
      }
      const pa = height(a)
      const pb = height(b)
      const pc = height(c)
      const tone =
        0.9 +
        0.15 * valueNoise3(node.seed, (a[0] + b[0] + c[0]) * 0.9, 0, (a[1] + b[1] + c[1]) * 0.9)
      const shade: Rgb = [color[0] * tone, color[1] * tone, color[2] * tone]
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0) emit(pa, pc, pb, shade)
      else emit(pa, pb, pc, shade)
    }
    for (const [a, b, c] of triangulatePlanPolygon(outline))
      face(outline[a] as PlantingPoint, outline[b] as PlantingPoint, outline[c] as PlantingPoint, 2)
  }
  if (node.edging !== 'none') {
    const color = linearColor(node.edging === 'steel' ? '#555a55' : '#99958a')
    const thickness = node.edging === 'steel' ? 0.015 : 0.065
    const rise = node.edging === 'steel' ? 0.065 : 0.09
    const sign = plantingArea(outline) > 0 ? 1 : -1
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i] as PlantingPoint
      const b = outline[(i + 1) % outline.length] as PlantingPoint
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      const nx = ((sign * (b[1] - a[1])) / length) * thickness
      const nz = ((-sign * (b[0] - a[0])) / length) * thickness
      const ya = ground.heightAt(...a)
      const yb = ground.heightAt(...b)
      const ai: Rgb = [a[0], ya + rise, a[1]]
      const bi: Rgb = [b[0], yb + rise, b[1]]
      const ao: Rgb = [a[0] + nx, ya + rise, a[1] + nz]
      const bo: Rgb = [b[0] + nx, yb + rise, b[1] + nz]
      const af: Rgb = [ao[0], ya - 0.02, ao[2]]
      const bf: Rgb = [bo[0], yb - 0.02, bo[2]]
      if (sign > 0) {
        emit(ai, bi, bo, color)
        emit(ai, bo, ao, color)
        emit(af, ao, bo, color)
        emit(af, bo, bf, color)
      } else {
        emit(ai, bo, bi, color)
        emit(ai, ao, bo, color)
        emit(af, bo, ao, color)
        emit(af, bf, bo, color)
      }
    }
  }
  return triangles
}
