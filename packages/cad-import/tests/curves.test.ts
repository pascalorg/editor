import { describe, expect, it } from 'bun:test'
import { parseDxf } from '../src/parse'
import { evaluateSpline, flattenSpline, isEvaluable } from '../src/spline'
import { dxf, ellipse, entities, header, line, pair, segmentAt, spline } from './fixtures'

function closeTo(actual: number, expected: number, tolerance = 1e-6) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)
}

/** Every point the parse produced, as a flat list. */
function points(source: string): [number, number][] {
  const drawing = parseDxf(source)
  const out: [number, number][] = []
  for (let i = 0; i < drawing.stats.segmentCount; i++) {
    const [x1, y1, x2, y2] = segmentAt(drawing.segments, i)
    if (i === 0) out.push([x1, y1])
    out.push([x2, y2])
  }
  return out
}

describe('ELLIPSE', () => {
  it('draws a full ellipse with the stored axis ratio', () => {
    // Major axis 100 along +X, minor half that.
    const all = points(
      dxf(header({ $INSUNITS: [70, 4] }), entities(ellipse('0', 0, 0, 100, 0, 0.5))),
    )

    let maxX = 0
    let maxY = 0
    for (const [x, y] of all) {
      maxX = Math.max(maxX, Math.abs(x))
      maxY = Math.max(maxY, Math.abs(y))
    }

    closeTo(maxX, 100, 0.5)
    closeTo(maxY, 50, 0.5)
  })

  it('carries its own rotation through the major-axis vector', () => {
    // Major axis along +Y instead: the extents swap.
    const all = points(
      dxf(header({ $INSUNITS: [70, 4] }), entities(ellipse('0', 0, 0, 0, 100, 0.5))),
    )

    let maxX = 0
    let maxY = 0
    for (const [x, y] of all) {
      maxX = Math.max(maxX, Math.abs(x))
      maxY = Math.max(maxY, Math.abs(y))
    }

    closeTo(maxX, 50, 0.5)
    closeTo(maxY, 100, 0.5)
  })

  it('honours the centre', () => {
    const drawing = parseDxf(
      dxf(header({ $INSUNITS: [70, 4] }), entities(ellipse('0', 500, 300, 100, 0, 1))),
    )
    expect(drawing.bounds.minX).toBeGreaterThan(390)
    expect(drawing.bounds.maxX).toBeLessThan(610)
    expect(drawing.bounds.minY).toBeGreaterThan(190)
  })

  it('draws an elliptical arc rather than the whole ellipse', () => {
    const quarter = parseDxf(
      dxf(header({ $INSUNITS: [70, 4] }), entities(ellipse('0', 0, 0, 100, 0, 1, 0, Math.PI / 2))),
    )
    const full = parseDxf(
      dxf(header({ $INSUNITS: [70, 4] }), entities(ellipse('0', 0, 0, 100, 0, 1))),
    )

    expect(quarter.stats.segmentCount).toBeLessThan(full.stats.segmentCount / 3)
    // A quarter starting at parameter 0 stays in the +X +Y quadrant.
    for (let i = 0; i < quarter.stats.segmentCount; i++) {
      const [x, y] = segmentAt(quarter.segments, i)
      expect(x).toBeGreaterThanOrEqual(-1e-6)
      expect(y).toBeGreaterThanOrEqual(-1e-6)
    }
  })

  it('is no longer reported as skipped', () => {
    const drawing = parseDxf(dxf(entities(ellipse('0', 0, 0, 10, 0, 0.5))))
    expect(drawing.stats.skippedTypes.ELLIPSE).toBeUndefined()
    expect(drawing.stats.entityCounts.ELLIPSE).toBe(1)
  })
})

describe('SPLINE', () => {
  const control: [number, number][] = [
    [0, 0],
    [100, 200],
    [300, 200],
    [400, 0],
  ]

  it('starts and ends exactly on the first and last control points', () => {
    // A clamped knot vector makes the curve interpolate its ends; anything
    // else means the evaluation is wrong.
    const all = points(dxf(header({ $INSUNITS: [70, 4] }), entities(spline('0', control))))

    closeTo(all[0]![0], 0, 0.01)
    closeTo(all[0]![1], 0, 0.01)
    closeTo(all[all.length - 1]![0], 400, 0.01)
    closeTo(all[all.length - 1]![1], 0, 0.01)
  })

  it('stays inside the convex hull of its control points', () => {
    const all = points(dxf(header({ $INSUNITS: [70, 4] }), entities(spline('0', control))))

    for (const [x, y] of all) {
      expect(x).toBeGreaterThanOrEqual(-0.01)
      expect(x).toBeLessThanOrEqual(400.01)
      expect(y).toBeGreaterThanOrEqual(-0.01)
      expect(y).toBeLessThanOrEqual(200.01)
    }
  })

  it('bends — it is not just the control polygon', () => {
    const all = points(dxf(header({ $INSUNITS: [70, 4] }), entities(spline('0', control))))

    // A cubic through these controls peaks well below the control polygon's
    // own 200; reproducing the polygon verbatim would reach it.
    let peak = 0
    for (const [, y] of all) peak = Math.max(peak, y)
    expect(peak).toBeGreaterThan(50)
    expect(peak).toBeLessThan(190)
  })

  it('spends points where the curve bends, not uniformly', () => {
    const drawing = parseDxf(dxf(header({ $INSUNITS: [70, 4] }), entities(spline('0', control))))
    expect(drawing.stats.segmentCount).toBeGreaterThan(8)

    // A straight run of collinear controls is a straight line, and must not
    // cost the same as a curve.
    const straight = parseDxf(
      dxf(
        header({ $INSUNITS: [70, 4] }),
        entities(
          spline('0', [
            [0, 0],
            [100, 0],
            [200, 0],
            [300, 0],
          ]),
        ),
      ),
    )
    expect(straight.stats.segmentCount).toBeLessThan(drawing.stats.segmentCount)
  })

  it('reads a degree-1 spline as the polyline it is', () => {
    const linear = parseDxf(
      dxf(
        header({ $INSUNITS: [70, 4] }),
        entities(
          spline(
            '0',
            [
              [0, 0],
              [100, 0],
              [100, 100],
            ],
            { degree: 1 },
          ),
        ),
      ),
    )

    expect(linear.stats.segmentCount).toBe(2)
  })

  it('bends toward a heavily weighted control point', () => {
    const plain = points(
      dxf(header({ $INSUNITS: [70, 4] }), entities(spline('0', control, { degree: 3 }))),
    )
    const weighted = points(
      dxf(
        header({ $INSUNITS: [70, 4] }),
        entities(spline('0', control, { degree: 3, weights: [1, 8, 8, 1] })),
      ),
    )

    const peakOf = (list: [number, number][]) => list.reduce((m, [, y]) => Math.max(m, y), 0)
    expect(peakOf(weighted)).toBeGreaterThan(peakOf(plain))
  })

  it('closes the loop when the closed flag is set', () => {
    const open = parseDxf(dxf(header({ $INSUNITS: [70, 4] }), entities(spline('0', control))))
    const closed = parseDxf(
      dxf(header({ $INSUNITS: [70, 4] }), entities(spline('0', control, { closed: true }))),
    )

    expect(closed.stats.segmentCount).toBe(open.stats.segmentCount + 1)
  })

  it('falls back to the control polygon when the knot vector is malformed', () => {
    // Real files contain these. An outline is worth more than a dropped entity.
    const broken = parseDxf(
      dxf(header({ $INSUNITS: [70, 4] }), entities(spline('0', control, { knots: [0, 1] }))),
    )

    expect(broken.stats.segmentCount).toBe(control.length - 1)
  })

  it('is no longer reported as skipped', () => {
    const drawing = parseDxf(dxf(entities(spline('0', control))))
    expect(drawing.stats.skippedTypes.SPLINE).toBeUndefined()
    expect(drawing.stats.entityCounts.SPLINE).toBe(1)
  })

  it('ignores a spline with too few control points instead of throwing', () => {
    const body = pair(0, 'SPLINE') + pair(8, '0') + pair(71, 3) + pair(10, 0) + pair(20, 0)
    const drawing = parseDxf(dxf(entities(line('0', 0, 0, 1, 1) + body)))
    expect(drawing.stats.segmentCount).toBe(1)
  })
})

describe('spline evaluation', () => {
  const definition = {
    controlPoints: [
      [0, 0],
      [1, 2],
      [3, 2],
      [4, 0],
    ] as [number, number][],
    weights: [],
    knots: [0, 0, 0, 0, 1, 1, 1, 1],
    degree: 3,
    closed: false,
  }

  it('accepts a well-formed definition', () => {
    expect(isEvaluable(definition)).toBe(true)
  })

  it('rejects a knot vector of the wrong length', () => {
    expect(isEvaluable({ ...definition, knots: [0, 0, 1, 1] })).toBe(false)
  })

  it('rejects a non-decreasing knot vector that decreases', () => {
    expect(isEvaluable({ ...definition, knots: [0, 0, 0, 0, 1, 0.5, 1, 1] })).toBe(false)
  })

  it('rejects fewer control points than the degree allows', () => {
    expect(
      isEvaluable({
        ...definition,
        controlPoints: [
          [0, 0],
          [1, 1],
        ],
        knots: [0, 0, 0, 0, 1, 1],
      }),
    ).toBe(false)
  })

  it('interpolates a clamped curve at both ends', () => {
    const start = evaluateSpline(definition, 0)
    const end = evaluateSpline(definition, 1)

    closeTo(start[0], 0, 1e-9)
    closeTo(start[1], 0, 1e-9)
    closeTo(end[0], 4, 1e-9)
    closeTo(end[1], 0, 1e-9)
  })

  it('is symmetric for a symmetric curve', () => {
    const left = evaluateSpline(definition, 0.25)
    const right = evaluateSpline(definition, 0.75)

    closeTo(left[0], 4 - right[0], 1e-9)
    closeTo(left[1], right[1], 1e-9)
  })

  it('tightens with the tolerance', () => {
    const coarse = flattenSpline(definition, 0.1)
    const fine = flattenSpline(definition, 0.0001)
    expect(fine.length).toBeGreaterThan(coarse.length)
  })

  it('caps refinement so a pathological curve cannot hang the import', () => {
    expect(flattenSpline(definition, 0).length).toBeLessThan(5000)
  })
})
