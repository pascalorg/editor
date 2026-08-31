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

  // Track B regression: "off-slab cursor, on-slab footprint stays at center".
  // When the gizmo is grabbed off the footprint center (e.g. near a slab edge),
  // the resolved center must track original + cursorDelta and be independent of
  // the initial grab offset — so a footprint fully inside a slab cannot be
  // pushed off the edge just because the cursor sample landed off-center.
  test('relative mode cancels the off-center gizmo grab offset so the committed center is offset-independent', () => {
    const original: [number, number] = [2, 2]
    const firstSample: [number, number] = [2.3, 2.3]
    const cursor: [number, number] = [3.1, 1.6]

    const start = resolvePlanarCursorPosition({
      cursor: firstSample,
      original,
      anchor: null,
      mode: 'relative',
    })

    // First sample absorbs the off-center grab: the footprint stays put.
    expect(start.point).toEqual(original)
    expect(start.anchor).toEqual(firstSample)

    const moved = resolvePlanarCursorPosition({
      cursor,
      original,
      anchor: start.anchor,
      mode: 'relative',
    })

    // Committed center = original + (cursor - firstSample), i.e. the gizmo
    // offset is cancelled regardless of where on the footprint it was grabbed.
    const expected: [number, number] = [
      original[0] + (cursor[0] - firstSample[0]),
      original[1] + (cursor[1] - firstSample[1]),
    ]
    expect(moved.point[0]).toBeCloseTo(expected[0])
    expect(moved.point[1]).toBeCloseTo(expected[1])

    // The result must not depend on the absolute grab offset: grabbing the same
    // footprint dead-center and moving by the same delta yields the same center.
    const centerStart = resolvePlanarCursorPosition({
      cursor: original,
      original,
      anchor: null,
      mode: 'relative',
    })
    const delta: [number, number] = [cursor[0] - firstSample[0], cursor[1] - firstSample[1]]
    const centerMoved = resolvePlanarCursorPosition({
      cursor: [original[0] + delta[0], original[1] + delta[1]],
      original,
      anchor: centerStart.anchor,
      mode: 'relative',
    })

    expect(centerMoved.point[0]).toBeCloseTo(moved.point[0])
    expect(centerMoved.point[1]).toBeCloseTo(moved.point[1])
  })
})
