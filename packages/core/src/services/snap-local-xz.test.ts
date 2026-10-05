import { expect, test } from 'bun:test'
import { snapLocalXZInWorld } from './snap'

test('world-axis callbacks receive translated and rotated model coordinates', () => {
  const calls: Array<[number, number]> = []
  const result = snapLocalXZInWorld(
    [1.2, 2.3],
    { position: [10, 0, 20], rotationY: Math.PI / 2 },
    (value, axis) => {
      calls.push([value, axis])
      return Math.round(value)
    },
  )
  expect(calls[0]?.[0]).toBeCloseTo(12.3)
  expect(calls[1]?.[0]).toBeCloseTo(18.8)
  expect(calls.map((call) => call[1])).toEqual([0, 1])
  expect(result[0]).toBeCloseTo(1)
  expect(result[1]).toBeCloseTo(2)
})

test('identity snapping preserves the point in every model frame', () => {
  for (const rotationY of [0, 0.7, Math.PI / 2, -Math.PI]) {
    const point = snapLocalXZInWorld([2, -6], { position: [5, 0, -3], rotationY }, (value) => value)
    expect(point[0]).toBeCloseTo(2)
    expect(point[1]).toBeCloseTo(-6)
  }
})
