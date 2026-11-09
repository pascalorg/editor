import { expect, test } from 'bun:test'
import { groundOverPart } from './ground-over-part'
import { area, containsPoint } from './polygon-boolean'
import type { Point2D } from './polygon-union'
import { createTerrainField, heightAt, type TerrainField } from './terrain-field'

// The part of a floor plate the ground stands over: exact against the rendered terrain plane
// (`heightAt`), whatever the plate's shape, and past the edge of the field.

/** A hillside: a tilted plane with a swell on it, smooth, so the part over a height has no islands. */
function hillside(cols = 12, rows = 12, origin: [number, number] = [-6, -6]): TerrainField {
  const field = createTerrainField({ cols, rows, spacing: 1, origin })
  const heights = new Int16Array(field.heights.length)
  for (let row = 0; row < rows; row += 1)
    for (let col = 0; col < cols; col += 1) {
      const x = origin[0] + col
      const z = origin[1] + row
      heights[row * cols + col] = Math.round(
        (2 + 0.6 * x - 0.3 * z + 0.8 * Math.sin(0.5 * x) * Math.cos(0.4 * z)) * 100,
      )
    }
  return { ...field, heights }
}

const rect = (x0: number, z0: number, x1: number, z1: number): Point2D[] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]

const asMulti = (rings: Point2D[][]) => rings.map((outer) => ({ outer, holes: [] }))

function inside(plate: Point2D[], [x, z]: Point2D) {
  let result = false
  for (let i = 0, j = plate.length - 1; i < plate.length; j = i++) {
    const [xi, zi] = plate[i]!
    const [xj, zj] = plate[j]!
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) result = !result
  }
  return result
}

/** Probes on a fine grid over the plate's box: every one the ground stands over is in the part, every other is not. */
function expectExact(plate: Point2D[], field: TerrainField, above: number) {
  const part = asMulti(groundOverPart(plate, field, above))
  const xs = plate.map(([x]) => x)
  const zs = plate.map(([, z]) => z)
  let probes = 0
  for (let x = Math.min(...xs) + 0.013; x < Math.max(...xs); x += 0.071) {
    for (let z = Math.min(...zs) + 0.017; z < Math.max(...zs); z += 0.073) {
      if (!inside(plate, [x, z])) {
        expect(containsPoint(part, [x, z])).toBe(false)
        continue
      }
      const margin = heightAt(field, x, z) - above
      // Within a hair of the contour either answer is the clip's rounding.
      if (Math.abs(margin) < 0.01) continue
      probes += 1
      expect(containsPoint(part, [x, z])).toBe(margin > 0)
    }
  }
  expect(probes).toBeGreaterThan(100)
}

test('the part is exactly where the rendered ground stands over the height, on a hillside', () => {
  const field = hillside()
  expectExact(rect(-3.4, -2.6, 2.9, 3.3), field, 1.0)
  expectExact(rect(-4.2, -3.9, 4.6, 4.1), field, 2.2)
})

test('a plate of any shape is cut the same way', () => {
  expectExact(
    [
      [-4.3, -3.1],
      [3.7, -4.4],
      [4.4, 2.2],
      [0.3, 4.1],
      [-3.9, 1.7],
    ],
    hillside(),
    0.8,
  )
})

test('past the edge of the field the ground is the edge’s height, as it is read there', () => {
  // The field covers x -6..5; the plate runs 5 m past its east edge.
  const field = hillside(12, 12, [-6, -6])
  expectExact(rect(1.1, -2.3, 10.2, 2.4), field, 3.5)
})

test('ground wholly over the height gives the whole plate, and none gives nothing', () => {
  const field = hillside()
  const plate = rect(-2.5, -2.5, 2.5, 2.5)
  const whole = groundOverPart(plate, field, -1)
  expect(area(asMulti(whole))).toBeCloseTo(25, 6)
  expect(groundOverPart(plate, field, 100)).toEqual([])
})

test('a plate over more cells than are worth walking is left whole', () => {
  const field = hillside()
  const plate = rect(-200, -200, 200, 200)
  expect(groundOverPart(plate, field, 1.5)).toEqual([plate])
})

test('an island of lower ground inside the part is not cut out: the hole has rings, not islands', () => {
  // A plateau at 4 m with one sunken sample at 0 m in the middle of a plate.
  const plateau = createTerrainField({ cols: 12, rows: 12, spacing: 1, origin: [-6, -6] })
  const heights = new Int16Array(plateau.heights.length).fill(400)
  heights[6 * 12 + 6] = 0
  const field = { ...plateau, heights }
  const plate = rect(-3, -3, 3, 3)
  const part = groundOverPart(plate, field, 2)
  // The sunken point (x = 0, z = 0) is lower than the height, and still inside the part.
  expect(heightAt(field, 0, 0)).toBeLessThan(2)
  expect(containsPoint(asMulti(part), [0, 0])).toBe(true)
  expect(area(asMulti(part))).toBeCloseTo(36, 6)
})
