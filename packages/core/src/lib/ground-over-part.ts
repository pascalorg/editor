import { area, intersection, union } from './polygon-boolean'
import type { Point2D } from './polygon-union'
import { heightAtSample, type TerrainField } from './terrain-field'

/** Pieces smaller than this (m²) are the clip's rounding, not ground. */
const MIN_PIECE_AREA = 0.01
/** A plate over this many field cells is left whole rather than walked cell by cell. */
const MAX_CELLS = 90_000

type Corner = { f: number; x: number; z: number }

/** The part of a triangle where the height is positive, by clipping it against `f > 0` (f is linear on it). */
function positivePart(triangle: readonly [Corner, Corner, Corner]): Point2D[] {
  const part: Point2D[] = []
  for (let i = 0; i < 3; i += 1) {
    const a = triangle[i]!
    const b = triangle[(i + 1) % 3]!
    if (a.f > 0) part.push([a.x, a.z])
    if (a.f > 0 !== b.f > 0) {
      const t = a.f / (a.f - b.f)
      part.push([a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t])
    }
  }
  return part
}

/**
 * The part of `plate` (a floor plate in the world plan) over which the ground stands higher than
 * `above` metres. The ground is the rendered terrain, the triangle plane `heightAt` reads (each cell
 * split on its `(c+1,r)`–`(c,r+1)` diagonal), so the cut follows the slope exactly: every triangle
 * of the field gives its piece where it stands over `above`, a run of cells wholly over it in a row
 * is one rectangle, and the pieces are joined and cut to the plate. Past the field's edge the
 * ground is the edge's height, as `heightAt` reads it. Rings only: an island of low ground inside
 * the part is not cut out.
 */
export function groundOverPart(
  plate: readonly Point2D[],
  field: TerrainField,
  above: number,
): Point2D[][] {
  if (plate.length < 3) return []
  const [originX, originZ] = field.origin
  const { spacing } = field
  const xs = plate.map(([x]) => x)
  const zs = plate.map(([, z]) => z)
  const firstCol = Math.floor((Math.min(...xs) - originX) / spacing)
  const lastCol = Math.floor((Math.max(...xs) - originX) / spacing)
  const firstRow = Math.floor((Math.min(...zs) - originZ) / spacing)
  const lastRow = Math.floor((Math.max(...zs) - originZ) / spacing)
  if ((lastCol - firstCol + 1) * (lastRow - firstRow + 1) > MAX_CELLS) return [[...plate]]

  const pieces: Point2D[][] = []
  for (let row = firstRow; row <= lastRow; row += 1) {
    const z0 = originZ + row * spacing
    const z1 = z0 + spacing
    let runStart = -1
    const closeRun = (col: number) => {
      if (runStart < 0) return
      const x0 = originX + runStart * spacing
      const x1 = originX + col * spacing
      pieces.push([
        [x0, z0],
        [x1, z0],
        [x1, z1],
        [x0, z1],
      ])
      runStart = -1
    }
    for (let col = firstCol; col <= lastCol; col += 1) {
      const x0 = originX + col * spacing
      const x1 = x0 + spacing
      const c00 = { x: x0, z: z0, f: heightAtSample(field, col, row) - above }
      const c10 = { x: x1, z: z0, f: heightAtSample(field, col + 1, row) - above }
      const c01 = { x: x0, z: z1, f: heightAtSample(field, col, row + 1) - above }
      const c11 = { x: x1, z: z1, f: heightAtSample(field, col + 1, row + 1) - above }
      const over = [c00, c10, c01, c11].filter((corner) => corner.f > 0).length
      if (over === 4) {
        if (runStart < 0) runStart = col
        continue
      }
      closeRun(col)
      if (over === 0) continue
      for (const triangle of [
        [c00, c10, c01],
        [c11, c01, c10],
      ] as const) {
        const piece = positivePart(triangle)
        if (piece.length >= 3) pieces.push(piece)
      }
    }
    closeRun(lastCol + 1)
  }
  if (pieces.length === 0) return []

  return intersection(union(pieces), [...plate] as [number, number][])
    .filter((polygon) => area([polygon]) >= MIN_PIECE_AREA)
    .map((polygon) => polygon.outer as Point2D[])
}
