import { describe, expect, test } from 'bun:test'
import { buildCadSnapIndex, CadSnapIndex, findCadSnap } from './cad-snap-index'

/** Build an index directly in level-local metres, bypassing the placement bake. */
function index(...segments: [number, number, number, number][]): CadSnapIndex {
  return new CadSnapIndex(Float64Array.from(segments.flat()))
}

function build(
  segments: number[],
  segmentLayers: number[],
  visibleLayers: boolean[],
  placement = { scale: 1, rotation: 0, position: [0, 0] as [number, number] },
) {
  return buildCadSnapIndex({
    segments: Float32Array.from(segments),
    segmentLayers: Uint16Array.from(segmentLayers),
    visibleLayers,
    placement,
  })
}

function closeTo(actual: number, expected: number, tolerance = 1e-9) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)
}

describe('placement bake', () => {
  test('converts drawing units to level-local metres', () => {
    // A 1000-unit line in a drawing whose unit is a millimetre is 1 m long.
    const built = build([0, 0, 1000, 0], [0], [true], {
      scale: 0.001,
      rotation: 0,
      position: [0, 0],
    })

    expect(built.segmentAt(0)).toEqual([0, 0, 1, 0])
  })

  test('applies rotation and position', () => {
    const built = build([0, 0, 1, 0], [0], [true], {
      scale: 1,
      rotation: Math.PI / 2,
      position: [10, 5],
    })

    const [x1, y1, x2, y2] = built.segmentAt(0)
    closeTo(x1, 10, 1e-9)
    closeTo(y1, 5, 1e-9)
    closeTo(x2, 10, 1e-9)
    closeTo(y2, 6, 1e-9)
  })

  test('drops hidden layers entirely, so they cannot be snapped to', () => {
    // Layer 0 visible, layer 1 hidden. This is what makes turning off the
    // decoration layers a performance lever and not just a visual one.
    const built = build([0, 0, 1, 0, 5, 5, 6, 5], [0, 1], [true, false])

    expect(built.segmentCount).toBe(1)
    expect(built.segmentAt(0)).toEqual([0, 0, 1, 0])
    expect(built.nearestEndpoint(5, 5, 1)).toBeNull()
  })
})

describe('queries', () => {
  const grid = index([0, 0, 10, 0], [5, -5, 5, 5])

  test('finds the nearest endpoint within the radius', () => {
    expect(grid.nearestEndpoint(0.2, 0.1, 0.5)).toEqual([0, 0])
    expect(grid.nearestEndpoint(0.2, 0.1, 0.1)).toBeNull()
  })

  test('finds a midpoint', () => {
    expect(grid.nearestMidpoint(5.1, 0.1, 0.5)).toEqual([5, 0])
  })

  test('finds where two lines cross', () => {
    expect(grid.nearestIntersection(5.1, 0.1, 0.5)).toEqual([5, 0])
  })

  test('projects onto a line body', () => {
    expect(grid.nearestOnSegment(3, 0.2, 0.5)).toEqual([3, 0])
  })

  test('clamps the projection to the segment rather than its infinite line', () => {
    const single = index([0, 0, 10, 0])
    expect(single.nearestOnSegment(-0.2, 0, 0.5)).toEqual([0, 0])
    expect(single.nearestOnSegment(20, 0, 0.5)).toBeNull()
  })

  test('returns nothing when the drawing is empty', () => {
    const empty = index()
    expect(empty.segmentCount).toBe(0)
    expect(empty.nearestEndpoint(0, 0, 10)).toBeNull()
  })
})

describe('spatial index', () => {
  test('finds geometry far from the origin', () => {
    // Negative and large coordinates both have to hash correctly.
    const far = index([-5000.5, -3000.25, -5000.5, -2999.25])
    expect(far.nearestEndpoint(-5000.4, -3000.2, 0.5)).toEqual([-5000.5, -3000.25])
  })

  test('finds a segment whose ends are both outside the query cell', () => {
    // The classic uniform-grid bug: a line crossing the query cell with
    // neither endpoint inside it. Kept under the per-segment cell budget so
    // this exercises the cell path rather than the overflow list.
    const long = index([-10, 0, 10, 0])
    const hit = long.nearestOnSegment(7.3, 0.1, 0.5)

    expect(hit).not.toBeNull()
    closeTo(hit![0], 7.3, 1e-9)
    closeTo(hit![1], 0, 1e-9)
  })

  test('still finds a line too long to be filed into cells', () => {
    // Beyond the per-segment cell budget it goes to the overflow list; it must
    // remain snappable. CAD files are full of sheet-length construction lines.
    const veryLong = index([-100_000, 0, 100_000, 0])
    const hit = veryLong.nearestOnSegment(12.5, 0.1, 0.5)

    expect(hit).not.toBeNull()
    closeTo(hit![0], 12.5, 1e-6)
    closeTo(hit![1], 0, 1e-6)
  })

  test('does not report a segment outside the radius that shares a cell', () => {
    const near = index([0.9, 0.9, 0.95, 0.95])
    expect(near.nearestEndpoint(0.1, 0.1, 0.5)).toBeNull()
  })
})

describe('endpointsWithin', () => {
  test('returns every distinct corner inside the radius', () => {
    const shape = index([0, 0, 1, 0], [1, 0, 1, 1])
    const found = shape.endpointsWithin(0.5, 0.5, 2, 10)

    expect(found).toHaveLength(3)
  })

  test('collapses the coincident corners polylines are full of', () => {
    // Two segments meeting at (1,0) contribute that point twice.
    const joined = index([0, 0, 1, 0], [1, 0, 2, 0])
    const found = joined.endpointsWithin(1, 0, 0.1, 10)

    expect(found).toEqual([[1, 0]])
  })

  test('excludes corners outside the radius', () => {
    const spread = index([0, 0, 1, 0], [10, 10, 11, 10])
    expect(spread.endpointsWithin(0, 0, 2, 10)).toHaveLength(2)
  })

  test('stops at the cap rather than returning a whole dense drawing', () => {
    const many: [number, number, number, number][] = []
    for (let i = 0; i < 200; i++) many.push([i * 0.01, 0, i * 0.01, 0.5])
    expect(index(...many).endpointsWithin(1, 0.25, 5, 12)).toHaveLength(12)
  })
})

describe('findCadSnap priority', () => {
  test('prefers a corner over a crossing when both are in range', () => {
    // A line ending exactly where two others cross: the corner must win, the
    // same way it does for walls.
    const shape = index([0, 0, 1, 0], [0.5, -1, 0.5, 1], [1, 0, 2, 0])
    const snap = findCadSnap(shape, [1.02, 0.02])

    expect(snap).toEqual({ point: [1, 0], kind: 'endpoint' })
  })

  test('falls back through midpoint / crossing to the line body', () => {
    const line = index([0, 0, 10, 0])

    expect(findCadSnap(line, [5.02, 0.02])?.kind).toBe('midpoint')
    expect(findCadSnap(line, [3, 0.05])?.kind).toBe('segment')
  })

  test('reports a crossing when no corner or midpoint is near', () => {
    // Both lines are deliberately asymmetric about the crossing, so neither
    // midpoint lands on it and the intersection is the only candidate.
    const cross = index([-10, 0, 20, 0], [3, -30, 3, 10])
    const snap = findCadSnap(cross, [3.02, 0.02])

    expect(snap?.kind).toBe('intersection')
    closeTo(snap!.point[0], 3, 1e-9)
    closeTo(snap!.point[1], 0, 1e-9)
  })

  test('returns nothing when the cursor is clear of the drawing', () => {
    expect(findCadSnap(index([0, 0, 1, 0]), [50, 50])).toBeNull()
  })

  test('honours a caller radius override', () => {
    const line = index([0, 0, 10, 0])
    expect(findCadSnap(line, [0.4, 0])?.kind).toBe('endpoint')
    expect(findCadSnap(line, [0.4, 0], { endpoint: 0.1 })?.kind).toBe('segment')
  })
})
