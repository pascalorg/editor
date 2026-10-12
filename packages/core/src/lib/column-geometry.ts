import type { ColumnNode } from '../schema/nodes/column'
import { union } from './polygon-boolean'

/**
 * Plate thicknesses of an i-beam column. The flanges span the width (local X)
 * at the front and back faces; the web joins them along the depth (local Z).
 */
export function columnIBeamSection(
  width: number,
  depth: number,
): { flangeThickness: number; webThickness: number } {
  return {
    flangeThickness: Math.max(0.01, depth * 0.1),
    webThickness: Math.max(0.01, width * 0.1),
  }
}

/** Plan outline of an i-beam section centred on the column axis, in local XZ. */
export function columnIBeamOutline(width: number, depth: number): [number, number][] {
  const { flangeThickness, webThickness } = columnIBeamSection(width, depth)
  const x = width / 2
  const z = depth / 2
  const webX = webThickness / 2
  const innerZ = Math.max(0, z - flangeThickness)
  return [
    [-x, -z],
    [x, -z],
    [x, -innerZ],
    [webX, -innerZ],
    [webX, innerZ],
    [x, innerZ],
    [x, z],
    [-x, z],
    [-x, innerZ],
    [-webX, innerZ],
    [-webX, -innerZ],
    [-x, -innerZ],
  ]
}

/**
 * How far a leaning column's section moves per metre of height, in its local
 * XZ. A column leans by shearing, not rotating: tiltX tips the top toward +Z
 * and tiltZ toward −X (the senses of right-handed rotations about those axes),
 * while the base stays planted and every horizontal section stays level.
 */
export function columnLean(column: Pick<ColumnNode, 'tiltX' | 'tiltZ'>): [number, number] {
  return [-Math.tan(column.tiltZ ?? 0) || 0, Math.tan(column.tiltX ?? 0)]
}

/** Level-plan offset of a leaning column's section at height `y`, after its yaw. */
export function columnPlanLeanOffset(
  column: Pick<ColumnNode, 'tiltX' | 'tiltZ' | 'rotation'>,
  y: number,
): [number, number] {
  const [x, z] = columnLean(column)
  const cos = Math.cos(column.rotation)
  const sin = Math.sin(column.rotation)
  return [(x * cos + z * sin) * y, (-x * sin + z * cos) * y]
}

/**
 * Plan area a footprint covers while sliding by `offset`: the footprint, its
 * shifted copy and the band each edge sweeps. Returned unchanged when nothing moves.
 */
export function sweptPlanFootprint(
  points: readonly [number, number][],
  [dx, dz]: readonly [number, number],
): [number, number][] {
  if (Math.hypot(dx, dz) < 1e-9 || points.length < 3) return [...points]
  const shifted = points.map(([x, z]): [number, number] => [x + dx, z + dz])
  const bands = points.map((point, i): [number, number][] => {
    const next = (i + 1) % points.length
    return [point, points[next]!, shifted[next]!, shifted[i]!]
  })
  return union([[...points], shifted, ...bands])[0]?.outer ?? [...points]
}
