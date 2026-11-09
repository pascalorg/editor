import { describe, expect, test } from 'bun:test'
import {
  offsetPlanPositionByLocalCenter,
  resolvePlanarCursorPosition,
  resolvePrioritizedPlanarCursorPosition,
} from './planar-cursor-placement'

const snapHalf = (value: number) => Math.round(value / 0.5) * 0.5

describe('resolvePlanarCursorPosition', () => {
  test('absolute mode puts the unrotated footprint centre at the snapped cursor', () => {
    const result = resolvePlanarCursorPosition({
      cursor: [4.24, 2.26],
      original: [0, 0],
      anchor: null,
      mode: 'absolute',
      localCenter: [1.3, 0.5, 0.2],
      snap: snapHalf,
    })

    expect(result.point).toEqual([2.7, 2.3])
    expect(result.anchor).toBeNull()
  })

  test('absolute mode snaps the centre before deriving the rotated origin', () => {
    const proposals: [number, number][] = []
    const localCenter: [number, number, number] = [1.3, 0.5, 0.2]
    const result = resolvePlanarCursorPosition({
      cursor: [4.24, 2.26],
      original: [0, 0],
      anchor: null,
      mode: 'absolute',
      localCenter,
      rotationY: Math.PI / 2,
      snapPoint: (point) => {
        proposals.push(point)
        return [snapHalf(point[0]), snapHalf(point[1])]
      },
    })

    expect(proposals).toEqual([[4.24, 2.26]])
    expect(result.point[0]).toBeCloseTo(3.8)
    expect(result.point[1]).toBeCloseTo(3.8)
    const centre = offsetPlanPositionByLocalCenter(
      [result.point[0], 0, result.point[1]],
      localCenter,
      Math.PI / 2,
    )
    expect(centre[0]).toBeCloseTo(4)
    expect(centre[2]).toBeCloseTo(2.5)
  })

  test('absolute mode follows the unsnapped cursor at an oblique rotation', () => {
    const localCenter: [number, number, number] = [1.5, 0.5, -0.3]
    const result = resolvePlanarCursorPosition({
      cursor: [-2.13, 6.27],
      original: [0, 0],
      anchor: null,
      mode: 'absolute',
      localCenter,
      rotationY: -Math.PI / 4,
    })
    const centre = offsetPlanPositionByLocalCenter(
      [result.point[0], 0, result.point[1]],
      localCenter,
      -Math.PI / 4,
    )

    expect(centre[0]).toBeCloseTo(-2.13)
    expect(centre[2]).toBeCloseTo(6.27)
  })

  test('relative mode ignores the footprint centre and rotation', () => {
    const result = resolvePlanarCursorPosition({
      cursor: [4.9, 5.2],
      original: [10, 20],
      anchor: [4.1, 6.1],
      mode: 'relative',
      localCenter: [1.3, 0.5, 0.2],
      rotationY: Math.PI / 2,
      snap: snapHalf,
    })

    expect(result.point).toEqual([11, 19])
    expect(result.anchor).toEqual([4.1, 6.1])
  })

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

describe('resolvePrioritizedPlanarCursorPosition', () => {
  test('attachment receives the corrected raw origin and returns the final origin', () => {
    const proposals: [number, number][] = []
    const result = resolvePrioritizedPlanarCursorPosition({
      cursor: [4.24, 2.26],
      original: [0, 0],
      anchor: null,
      mode: 'absolute',
      localCenter: [1.3, 0.5, 0.2],
      rotationY: Math.PI / 2,
      snapPoint: () => {
        throw new Error('Grid snapping must not run after attachment')
      },
      resolveAttachment: (proposal) => {
        proposals.push(proposal)
        return [3, 5]
      },
    })

    expect(proposals).toHaveLength(1)
    expect(proposals[0]![0]).toBeCloseTo(4.04)
    expect(proposals[0]![1]).toBeCloseTo(3.56)
    expect(result.point).toEqual([3, 5])
    expect(result.attachmentSnapped).toBe(true)
  })

  test('snaps the footprint centre when attachment declines the corrected origin', () => {
    const result = resolvePrioritizedPlanarCursorPosition({
      cursor: [4.24, 2.26],
      original: [0, 0],
      anchor: null,
      mode: 'absolute',
      localCenter: [1.3, 0.5, 0.2],
      snapPoint: ([x, z]) => [snapHalf(x), snapHalf(z)],
      resolveAttachment: () => null,
    })

    expect(result.point).toEqual([2.7, 2.3])
    expect(result.attachmentSnapped).toBe(false)
  })

  test('wall attachment receives the raw proposal and wins over grid snapping', () => {
    const attachmentProposals: [number, number][] = []
    const result = resolvePrioritizedPlanarCursorPosition({
      cursor: [0.73, 0.32],
      original: [0, 0],
      anchor: null,
      mode: 'absolute',
      snap: snapHalf,
      resolveAttachment: (proposal) => {
        attachmentProposals.push(proposal)
        return [proposal[0], 0.39]
      },
    })

    expect(attachmentProposals).toEqual([[0.73, 0.32]])
    expect(result.point).toEqual([0.73, 0.39])
    expect(result.attachmentSnapped).toBe(true)
  })

  test('falls back to the grid proposal when there is no attachment', () => {
    const result = resolvePrioritizedPlanarCursorPosition({
      cursor: [0.73, 0.32],
      original: [0, 0],
      anchor: null,
      mode: 'absolute',
      snap: snapHalf,
      resolveAttachment: () => null,
    })

    expect(result.point).toEqual([0.5, 0.5])
    expect(result.attachmentSnapped).toBe(false)
  })

  test('supports footprint-aware point snapping after attachment resolution', () => {
    const pointProposals: [number, number][] = []
    const result = resolvePrioritizedPlanarCursorPosition({
      cursor: [1.03, 2.04],
      original: [0.8, 1.8],
      anchor: [0.9, 1.9],
      mode: 'relative',
      snapPoint: (proposal) => {
        pointProposals.push(proposal)
        return [0.8, 2.29]
      },
      resolveAttachment: () => null,
    })

    expect(pointProposals).toHaveLength(1)
    expect(pointProposals[0]![0]).toBeCloseTo(0.93)
    expect(pointProposals[0]![1]).toBeCloseTo(1.94)
    expect(result.point).toEqual([0.8, 2.29])
    expect(result.attachmentSnapped).toBe(false)
  })
})
