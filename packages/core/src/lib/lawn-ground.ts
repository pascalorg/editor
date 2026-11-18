import type { LawnNode } from '../schema/nodes/lawn'
import { LAWN_LIMITS } from '../schema/nodes/lawn'
import { triangulatePlanPolygon } from './earcut'
import { linearColor, type Rgb } from './foliage'
import { lawnCoverage } from './lawn-coverage'
import { sampleLawnStrokes } from './lawn-strokes'
import { assertLawnStrokeWork, LawnBuildError, type LawnMesh } from './lawn-types'
import { plantingBounds } from './planting-outline'
import { area, intersection, type MultiPolygon, type Polygon, type Ring } from './polygon-boolean'
import { valueNoise3 } from './seeded-noise'
import { FLAT_GROUND_Y } from './site-ground-height'
import { heightAt, type TerrainField } from './terrain-field'

export type LawnGroundTriangle = [Rgb, Rgb, Rgb]

function withoutHoles(polygon: Polygon): Ring[] {
  if (!polygon.holes.length) return [polygon.outer]
  const bounds = plantingBounds(polygon.outer)
  const cuts = [
    ...new Set([
      bounds.minX,
      bounds.maxX,
      ...polygon.holes.flatMap((hole) => hole.map(([x]) => x)),
    ]),
  ].sort((a, b) => a - b)
  const rings: Ring[] = []
  for (let index = 0; index + 1 < cuts.length; index++) {
    const left = cuts[index]
    const right = cuts[index + 1]
    if (left === undefined || right === undefined || right - left < 1e-8) continue
    const clipped = intersection(polygon, [
      [left, bounds.minZ - 1],
      [right, bounds.minZ - 1],
      [right, bounds.maxZ + 1],
      [left, bounds.maxZ + 1],
    ])
    for (const part of clipped) {
      if (part.holes.length)
        throw new LawnBuildError(
          'lawn_terrain_budget',
          'Lawn ground could not resolve a clipped hole.',
        )
      rings.push(part.outer)
    }
  }
  return rings
}

function gridAxis(minimum: number, maximum: number, origin: number, spacing: number): number[] {
  const values = [minimum]
  for (
    let cell = Math.floor((minimum - origin) / spacing) + 1;
    origin + cell * spacing < maximum - 1e-8;
    cell++
  )
    values.push(origin + cell * spacing)
  values.push(maximum)
  return values
}

function terrainAxes(polygons: MultiPolygon, field: TerrainField | null) {
  const bounds = plantingBounds(polygons.flatMap((polygon) => polygon.outer))
  const spacing = field?.spacing ?? 1
  const origin = field?.origin ?? [0, 0]
  const cellCount =
    (Math.ceil((bounds.maxX - bounds.minX) / spacing) + 1) *
    (Math.ceil((bounds.maxZ - bounds.minZ) / spacing) + 1)
  if (cellCount > LAWN_LIMITS.maxBaseTriangles * 2)
    throw new LawnBuildError(
      'lawn_terrain_budget',
      'Lawn ground exceeds the terrain-cell work budget.',
    )
  const xs = gridAxis(bounds.minX, bounds.maxX, origin[0] ?? 0, spacing)
  const zs = gridAxis(bounds.minZ, bounds.maxZ, origin[1] ?? 0, spacing)
  // Clamped terrain beyond the field boundary changes slope at the last sample.
  if (field) {
    for (const edge of [field.origin[0], field.origin[0] + (field.cols - 1) * field.spacing])
      if (edge > bounds.minX && edge < bounds.maxX) xs.push(edge)
    for (const edge of [field.origin[1], field.origin[1] + (field.rows - 1) * field.spacing])
      if (edge > bounds.minZ && edge < bounds.maxZ) zs.push(edge)
  }
  return { xs: [...new Set(xs)].sort((a, b) => a - b), zs: [...new Set(zs)].sort((a, b) => a - b) }
}

function cellTriangles(
  left: number,
  right: number,
  top: number,
  bottom: number,
  field: TerrainField | null,
): Ring[] {
  const rectangle: Ring = [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ]
  if (
    !field ||
    left < field.origin[0] ||
    top < field.origin[1] ||
    right > field.origin[0] + (field.cols - 1) * field.spacing ||
    bottom > field.origin[1] + (field.rows - 1) * field.spacing
  )
    return [rectangle]
  const col = Math.floor(((left + right) / 2 - field.origin[0]) / field.spacing)
  const row = Math.floor(((top + bottom) / 2 - field.origin[1]) / field.spacing)
  const x = field.origin[0] + col * field.spacing
  const z = field.origin[1] + row * field.spacing
  const size = field.spacing
  const halves: Ring[] = [
    [
      [x, z],
      [x + size, z],
      [x, z + size],
    ],
    [
      [x + size, z],
      [x + size, z + size],
      [x, z + size],
    ],
  ]
  if (
    Math.abs(left - x) < 1e-8 &&
    Math.abs(top - z) < 1e-8 &&
    Math.abs(right - x - size) < 1e-8 &&
    Math.abs(bottom - z - size) < 1e-8
  )
    return halves
  return halves.flatMap((half) => intersection(half, rectangle).map((polygon) => polygon.outer))
}

function needsStrokeSubdivision(triangle: LawnGroundTriangle, node: LawnNode): boolean {
  const xs = triangle.map((point) => point[0]),
    zs = triangle.map((point) => point[2])
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minZ = Math.min(...zs),
    maxZ = Math.max(...zs)
  const size = Math.max(maxX - minX, maxZ - minZ)
  for (const stroke of node.strokes) {
    if (
      !stroke.strength ||
      (stroke.effect !== 'bare' && stroke.effect !== 'grass') ||
      size <= Math.min(0.25, stroke.radiusM * 0.3)
    )
      continue
    for (let index = 0; index < stroke.points.length; index++) {
      const start = stroke.points[index],
        end = stroke.points[index + 1] ?? start
      if (!start || !end) continue
      if (
        Math.min(start[0], end[0]) - stroke.radiusM <= maxX &&
        Math.max(start[0], end[0]) + stroke.radiusM >= minX &&
        Math.min(start[1], end[1]) - stroke.radiusM <= maxZ &&
        Math.max(start[1], end[1]) + stroke.radiusM >= minZ
      )
        return true
    }
  }
  return false
}

function appendGroundTriangle(
  triangles: LawnGroundTriangle[],
  triangle: LawnGroundTriangle,
  node: LawnNode,
  work: { visits: number; points: number },
) {
  work.visits += work.points
  assertLawnStrokeWork(work.visits)
  if (needsStrokeSubdivision(triangle, node)) {
    const [a, b, c] = triangle
    const middle = (left: Rgb, right: Rgb): Rgb => [
      (left[0] + right[0]) / 2,
      (left[1] + right[1]) / 2,
      (left[2] + right[2]) / 2,
    ]
    const ab = middle(a, b),
      bc = middle(b, c),
      ca = middle(c, a)
    for (const part of [
      [a, ab, ca],
      [ab, b, bc],
      [ca, bc, c],
      [ab, bc, ca],
    ] as LawnGroundTriangle[])
      appendGroundTriangle(triangles, part, node, work)
    return
  }
  if (triangles.length >= LAWN_LIMITS.maxBaseTriangles)
    throw new LawnBuildError('lawn_terrain_budget', 'Lawn ground exceeds the base triangle budget.')
  triangles.push(triangle)
}

export function lawnGroundTriangles(
  polygons: MultiPolygon,
  node: LawnNode,
  field: TerrainField | null,
  work = { visits: 0, points: node.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0) },
): LawnGroundTriangle[] {
  const { xs, zs } = terrainAxes(polygons, field)
  const coverage = lawnCoverage(polygons)
  const triangles: LawnGroundTriangle[] = []
  for (let row = 0; row + 1 < zs.length; row++)
    for (let col = 0; col + 1 < xs.length; col++) {
      const left = xs[col],
        right = xs[col + 1],
        top = zs[row],
        bottom = zs[row + 1]
      if (left === undefined || right === undefined || top === undefined || bottom === undefined)
        continue
      const status = coverage.cell(left, top, right, bottom)
      if (status === 'outside') continue
      for (const cell of cellTriangles(left, right, top, bottom, field)) {
        const retained =
          status === 'inside' ? [{ outer: cell, holes: [] }] : intersection(polygons, cell)
        for (const polygon of retained)
          for (const ring of withoutHoles(polygon)) {
            for (const indices of triangulatePlanPolygon(ring)) {
              const points = indices
                .map((index) => ring[index])
                .filter((point): point is [number, number] => !!point)
              const a = points[0],
                b = points[1],
                c = points[2]
              if (!a || !b || !c || area([{ outer: [a, b, c], holes: [] }]) < 1e-9) continue
              const point = ([x, z]: [number, number]): Rgb => [
                x,
                field ? heightAt(field, x, z) : FLAT_GROUND_Y,
                z,
              ]
              appendGroundTriangle(triangles, [point(a), point(b), point(c)], node, work)
            }
          }
      }
    }
  return triangles
}

export function lawnGroundMesh(triangles: LawnGroundTriangle[], node: LawnNode): LawnMesh {
  const positions = new Float32Array(triangles.length * 9)
  const normals = new Float32Array(positions.length)
  const colors = new Float32Array(positions.length)
  const indices = new Uint32Array(triangles.length * 3)
  const grass = linearColor(node.color),
    soil = linearColor('#66513a')
  for (let index = 0; index < triangles.length; index++) {
    const triangle = triangles[index]
    if (!triangle) continue
    let [a, b, c] = triangle
    const crossY = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2])
    if (crossY < 0) [b, c] = [c, b]
    const normal: Rgb = [
      (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    ]
    const length = Math.hypot(...normal) || 1
    for (const [corner, point] of [a, b, c].entries()) {
      const offset = index * 9 + corner * 3
      const coverage = sampleLawnStrokes(node.strokes, point[0], point[2]).coverage
      const broad = valueNoise3(node.seed + 53, point[0] / 4.5, 0, point[2] / 4.5)
      const detail = valueNoise3(node.seed + 57, point[0] / 0.9, 0, point[2] / 0.9)
      const tone = 0.75 + broad * 0.27 + detail * 0.045
      positions.set(point, offset)
      normals.set(
        normal.map((value) => value / length),
        offset,
      )
      colors.set(
        grass.map(
          (value, channel) => ((soil[channel] ?? 0) * (1 - coverage) + value * coverage) * tone,
        ),
        offset,
      )
      indices[index * 3 + corner] = index * 3 + corner
    }
  }
  return { positions, normals, colors, indices }
}
