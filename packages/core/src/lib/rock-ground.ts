import type { RockNode } from '../schema'
import { pointInPolygon } from './polygon-relations'
import { rockCentre } from './rock-shape'
import { surfaceHeightAt, type TerrainField } from './terrain-field'

/** How far a rock's foot sinks under the lowest ground beneath it, so it stands grounded. */
export const ROCK_EMBED = 0.3

/** Heights of a rock in its Site's frame: where its foot ends and where its top is. */
export type RockSpan = { footY: number; topY: number }

/** More lattice points than this under one rock are sampled on a coarser stride. */
const MAX_LATTICE_SAMPLES = 4096
/** An edge is sampled at most this many times, however long it is. */
const MAX_EDGE_SAMPLES = 256

function edgePoints(polygon: RockNode['polygon'], every: number): [number, number][] {
  return polygon.flatMap(([x, z], i) => {
    const [nx, nz] = polygon[(i + 1) % polygon.length] ?? [x, z]
    const count = Math.min(
      MAX_EDGE_SAMPLES,
      Math.max(1, Math.ceil(Math.hypot(nx - x, nz - z) / every)),
    )
    return Array.from({ length: count }, (_, k): [number, number] => [
      x + ((nx - x) * k) / count,
      z + ((nz - z) * k) / count,
    ])
  })
}

/** The field's own sample points that fall inside the polygon, on a stride that bounds their number. */
function latticePointsInside(
  polygon: RockNode['polygon'],
  field: TerrainField,
): [number, number][] {
  const xs = polygon.map(([x]) => x)
  const zs = polygon.map(([, z]) => z)
  // Only the samples the field has: a rock far larger than it reads the field's own extent.
  const cols = [
    Math.max(0, Math.ceil((Math.min(...xs) - field.origin[0]) / field.spacing)),
    Math.min(field.cols - 1, Math.floor((Math.max(...xs) - field.origin[0]) / field.spacing)),
  ] as const
  const rows = [
    Math.max(0, Math.ceil((Math.min(...zs) - field.origin[1]) / field.spacing)),
    Math.min(field.rows - 1, Math.floor((Math.max(...zs) - field.origin[1]) / field.spacing)),
  ] as const
  const total = Math.max(0, cols[1] - cols[0] + 1) * Math.max(0, rows[1] - rows[0] + 1)
  const stride = Math.max(1, Math.ceil(Math.sqrt(total / MAX_LATTICE_SAMPLES)))
  const inside: [number, number][] = []
  for (let col = cols[0]; col <= cols[1]; col += stride)
    for (let row = rows[0]; row <= rows[1]; row += stride) {
      const point: [number, number] = [
        field.origin[0] + col * field.spacing,
        field.origin[1] + row * field.spacing,
      ]
      if (pointInPolygon(point, polygon)) inside.push(point)
    }
  return inside
}

/**
 * Where the ground under a rock can be at its highest or lowest: the field is piecewise linear,
 * so its extremes are at the outline's corners, where the outline crosses the field's grid, or at
 * the field's own samples inside it. Edges are sampled every half a spacing.
 */
function groundHeightsUnder(polygon: RockNode['polygon'], field: TerrainField): number[] {
  const centre = rockCentre(polygon)
  const points = [
    ...edgePoints(polygon, field.spacing / 2),
    ...latticePointsInside(polygon, field),
    // A concave footprint's centroid can lie in an empty notch, outside the rock.
    ...(pointInPolygon(centre, polygon) ? [centre] : []),
  ]
  return points.map(([x, z]) => surfaceHeightAt(field, x, z))
}

/** The lowest ground under the rock: the datum where the Site has no terrain. */
export function lowestGroundUnder(
  polygon: RockNode['polygon'],
  field: TerrainField | null,
  datum = 0,
): number {
  return field ? Math.min(...groundHeightsUnder(polygon, field)) : datum
}

/** The highest ground under the rock: the datum where the Site has no terrain. */
export function highestGroundUnder(
  polygon: RockNode['polygon'],
  field: TerrainField | null,
  datum = 0,
): number {
  return field ? Math.max(...groundHeightsUnder(polygon, field)) : datum
}

/** Site callers supply their flat ground datum; standalone shapes retain a zero datum. */
export function rockSpan(
  rock: Pick<RockNode, 'polygon' | 'height'>,
  field: TerrainField | null,
  datum = 0,
): RockSpan {
  const ground = lowestGroundUnder(rock.polygon, field, datum)
  return { footY: ground - ROCK_EMBED, topY: ground + rock.height }
}
