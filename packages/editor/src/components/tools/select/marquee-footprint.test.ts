import { expect, test } from 'bun:test'
import { marqueePolygon } from './marquee-footprint'
import { type Point2, polygonsIntersect } from './marquee-geometry'

const polygon: Point2[] = [
  [-4, -2],
  [4, -2],
  [4, 2],
  [-4, 2],
]

test('a translated pool is not selected by a pipe marquee over its untransformed outline', () => {
  const pool = { polygon, position: [12, 0, 0], rotation: [0, 0, 0] }
  const pipeMarquee: Point2[] = [
    [-1, -0.1],
    [1, -0.1],
    [1, 0.1],
    [-1, 0.1],
  ]
  expect(polygonsIntersect(polygon, pipeMarquee)).toBe(true)
  expect(polygonsIntersect(marqueePolygon(pool)!, pipeMarquee)).toBe(false)
  expect(
    polygonsIntersect(marqueePolygon(pool)!, [
      [11, -1],
      [13, -1],
      [13, 1],
      [11, 1],
    ]),
  ).toBe(true)
})

test('pool rotation is applied before its position', () => {
  const footprint = marqueePolygon({
    polygon,
    position: [12, 0, 5],
    rotation: [0, Math.PI / 2, 0],
  })!
  expect(footprint[0]![0]).toBeCloseTo(10)
  expect(footprint[0]![1]).toBeCloseTo(9)
  expect(
    polygonsIntersect(footprint, [
      [15, 4],
      [16, 4],
      [16, 6],
      [15, 6],
    ]),
  ).toBe(false)
})

test('level-space polygons keep their existing coordinates', () => {
  expect(marqueePolygon({ polygon })).toBe(polygon)
  expect(marqueePolygon({ polygon: undefined })).toBeNull()
})
