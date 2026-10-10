import { describe, expect, test } from 'bun:test'
import {
  formatRegionSize,
  isRegionBigEnough,
  nearestEdgePoint,
  rankInRegion,
  rectFromDrag,
  regionFractions,
  regionLabel,
  regionSizeMetres,
} from './region'

// A region is a view, not a selection (spec 2.3): a rectangle dragged on the canvas, its size in
// metres shown live, what lies inside it ranked for the agent. Written first: a rectangle dragged
// right to left coming out inverted; a rectangle past the canvas edge; a speck of a drag taken as
// a region; a size measured through a ray that points at the sky; the ranking leaning on elements
// that merely touch the rectangle.

const canvas = { x0: 0, y0: 0, x1: 1000, y1: 600 }

describe('rectFromDrag', () => {
  test('is the same rectangle whichever corner the drag starts from', () => {
    const rect = { x0: 100, y0: 80, x1: 300, y1: 200 }

    expect(rectFromDrag({ x: 100, y: 80 }, { x: 300, y: 200 }, canvas)).toEqual(rect)
    expect(rectFromDrag({ x: 300, y: 200 }, { x: 100, y: 80 }, canvas)).toEqual(rect)
    expect(rectFromDrag({ x: 300, y: 80 }, { x: 100, y: 200 }, canvas)).toEqual(rect)
  })

  test('is kept inside the canvas', () => {
    expect(rectFromDrag({ x: -40, y: 20 }, { x: 1200, y: 700 }, canvas)).toEqual({
      x0: 0,
      y0: 20,
      x1: 1000,
      y1: 600,
    })
  })
})

describe('isRegionBigEnough', () => {
  test('wants 24 px on both sides, so a click that wobbled is not a region', () => {
    expect(isRegionBigEnough({ x0: 0, y0: 0, x1: 24, y1: 24 })).toBe(true)
    expect(isRegionBigEnough({ x0: 0, y0: 0, x1: 23, y1: 200 })).toBe(false)
    expect(isRegionBigEnough({ x0: 0, y0: 0, x1: 200, y1: 23.9 })).toBe(false)
  })
})

describe('regionFractions', () => {
  test('is [left, top, right, bottom] as 0-1 of the full frame', () => {
    const box = { left: 100, top: 50, width: 800, height: 400 }

    expect(regionFractions({ x0: 300, y0: 150, x1: 700, y1: 350 }, box)).toEqual([
      0.25, 0.25, 0.75, 0.75,
    ])
  })

  test('is clamped to the frame', () => {
    const box = { left: 100, top: 50, width: 800, height: 400 }

    expect(regionFractions({ x0: 0, y0: 0, x1: 2000, y1: 2000 }, box)).toEqual([0, 0, 1, 1])
  })
})

describe('regionSizeMetres', () => {
  // A camera straight above: the screen point (x, y) looks down at the world point (x / 10, 0, y / 10).
  const down = (x: number, y: number) => ({
    origin: [x / 10, 10, y / 10] as [number, number, number],
    direction: [0, -1, 0] as [number, number, number],
  })
  const rect = { x0: 100, y0: 100, x1: 300, y1: 200 }

  test('is the distance between the left and right edge hits, and top and bottom, on the plane', () => {
    expect(regionSizeMetres(rect, down, 0)).toEqual({ width: 20, depth: 10 })
  })

  test('measures on the plane it is given', () => {
    // At y = 5 the same rays hit the same x and z (they are straight down): the size does not change.
    expect(regionSizeMetres(rect, down, 5)).toEqual({ width: 20, depth: 10 })
  })

  test('is null when a ray misses the plane: it points up, along it, or does not exist', () => {
    expect(
      regionSizeMetres(rect, () => ({ origin: [0, 1, 0], direction: [0, 1, 0] }), 0),
    ).toBeNull()
    expect(
      regionSizeMetres(rect, () => ({ origin: [0, 1, 0], direction: [1, 0, 0] }), 0),
    ).toBeNull()
    expect(regionSizeMetres(rect, () => null, 0)).toBeNull()
  })

  test('is null when only one of the four rays misses (the sky in a corner of the frame)', () => {
    const skyAtTop = (x: number, y: number) =>
      y <= 100
        ? {
            origin: [0, 1, 0] as [number, number, number],
            direction: [0, 1, 0] as [number, number, number],
          }
        : down(x, y)

    expect(regionSizeMetres(rect, skyAtTop, 0)).toBeNull()
  })
})

describe('formatRegionSize', () => {
  const size = { width: 4.23, depth: 3.07 }

  test('metric: one decimal each, one unit', () => {
    expect(formatRegionSize(size, 'metric')).toBe('4.2 × 3.1 m')
  })

  test('imperial: feet and inches as the editor writes them', () => {
    expect(formatRegionSize(size, 'imperial')).toBe('13\'11" × 10\'1"')
  })
})

describe('rankInRegion', () => {
  const region = { x0: 100, y0: 100, x1: 300, y1: 300 }

  test('ranks by the area of overlap with the region, biggest first', () => {
    const ranked = rankInRegion(
      [
        { id: 'small', rect: { x0: 250, y0: 250, x1: 350, y1: 350 } }, // 50 x 50
        { id: 'big', rect: { x0: 0, y0: 0, x1: 400, y1: 400 } }, // the whole region
        { id: 'mid', rect: { x0: 100, y0: 100, x1: 200, y1: 300 } }, // 100 x 200
      ],
      region,
    )

    expect(ranked).toEqual({ ids: ['big', 'mid', 'small'], more: 0 })
  })

  test('leaves out what is outside, what only touches an edge, and what has no screen box', () => {
    const ranked = rankInRegion(
      [
        { id: 'outside', rect: { x0: 500, y0: 500, x1: 600, y1: 600 } },
        { id: 'touching', rect: { x0: 300, y0: 100, x1: 400, y1: 300 } },
        { id: 'hidden', rect: null },
        { id: 'inside', rect: { x0: 150, y0: 150, x1: 160, y1: 160 } },
      ],
      region,
    )

    expect(ranked).toEqual({ ids: ['inside'], more: 0 })
  })

  test('ties go by id, so the same view always ranks the same way', () => {
    const same = { x0: 120, y0: 120, x1: 140, y1: 140 }

    expect(
      rankInRegion(
        [
          { id: 'b', rect: same },
          { id: 'a', rect: same },
        ],
        region,
      ).ids,
    ).toEqual(['a', 'b'])
  })

  test('keeps the top few and counts the rest', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      id: `e${String(i).padStart(2, '0')}`,
      rect: { x0: 110, y0: 110, x1: 110 + 10 + i, y1: 120 },
    }))
    const ranked = rankInRegion(many, region)

    expect(ranked.ids).toHaveLength(12)
    expect(ranked.more).toBe(3)
    expect(ranked.ids[0]).toBe('e14')
    expect(rankInRegion(many, region, 5)).toMatchObject({ more: 10 })
  })
})

describe('regionLabel', () => {
  test('counts the elements, in words that agree', () => {
    expect(regionLabel(6)).toBe('Area · 6 elements')
    expect(regionLabel(1)).toBe('Area · 1 element')
    expect(regionLabel(0)).toBe('Area')
  })
})

describe('nearestEdgePoint', () => {
  const rect = { x0: 100, y0: 100, x1: 300, y1: 200 }

  test('puts a release point outside the rectangle on its nearest edge', () => {
    expect(nearestEdgePoint(rect, { x: 400, y: 150 })).toEqual({ x: 300, y: 150 })
    expect(nearestEdgePoint(rect, { x: 200, y: 20 })).toEqual({ x: 200, y: 100 })
    expect(nearestEdgePoint(rect, { x: 20, y: 400 })).toEqual({ x: 100, y: 200 })
  })

  test('pushes a point inside out to the nearest edge, so a tail has something to point from', () => {
    expect(nearestEdgePoint(rect, { x: 290, y: 150 })).toEqual({ x: 300, y: 150 })
    expect(nearestEdgePoint(rect, { x: 200, y: 110 })).toEqual({ x: 200, y: 100 })
  })
})
