import { describe, expect, test } from 'bun:test'
import { resolvePlanarCursorPosition } from './planar-cursor-placement'

const snapHalf = (value: number) => Math.round(value / 0.5) * 0.5

describe('resolvePlanarCursorPosition', () => {
  test('absolute mode places the point directly at the snapped cursor', () => {
    const result = resolvePlanarCursorPosition({
      cursor: [1.24, -2.26],
      original: [10, 10],
      anchor: null,
      mode: 'absolute',
      snap: snapHalf,
    })

    expect(result.point).toEqual([1, -2.5])
    expect(result.anchor).toBeNull()
  })

  test('relative mode preserves the original grab offset from the first cursor sample', () => {
    const start = resolvePlanarCursorPosition({
      cursor: [4.1, 6.1],
      original: [10, 20],
      anchor: null,
      mode: 'relative',
      snap: snapHalf,
    })

    expect(start.point).toEqual([10, 20])
    expect(start.anchor).toEqual([4.1, 6.1])

    const moved = resolvePlanarCursorPosition({
      cursor: [4.9, 5.2],
      original: [10, 20],
      anchor: start.anchor,
      mode: 'relative',
      snap: snapHalf,
    })

    expect(moved.point).toEqual([11, 19])
    expect(moved.anchor).toEqual([4.1, 6.1])
  })
})
