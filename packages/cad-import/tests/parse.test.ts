import { describe, expect, it } from 'bun:test'
import { parseDxf } from '../src/parse'
import {
  arc,
  block,
  circle,
  dxf,
  entities,
  header,
  insert,
  layerTable,
  line,
  lwpolyline,
  pair,
  polyline,
  section,
  segmentAt,
} from './fixtures'

function closeTo(actual: number, expected: number, tolerance = 1e-6) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)
}

describe('entities', () => {
  it('reads a LINE into one segment on its layer', () => {
    const drawing = parseDxf(
      dxf(layerTable([{ name: 'DUVAR' }]), entities(line('DUVAR', 0, 0, 3, 4))),
    )

    expect(drawing.stats.segmentCount).toBe(1)
    expect(segmentAt(drawing.segments, 0)).toEqual([0, 0, 3, 4])
    expect(drawing.layers[drawing.segmentLayers[0]!]?.name).toBe('DUVAR')
  })

  it('drops zero-length segments', () => {
    const drawing = parseDxf(dxf(entities(line('0', 5, 5, 5, 5))))
    expect(drawing.stats.segmentCount).toBe(0)
  })

  it('sweeps an ARC counter-clockwise, wrapping when the end angle is lower', () => {
    // 270° → 90° is a 180° CCW sweep through 0°, i.e. the right half of the
    // circle. A parser that subtracted naively would sweep -180° instead.
    const drawing = parseDxf(dxf(entities(arc('0', 0, 0, 10, 270, 90))))

    const [x1, y1] = segmentAt(drawing.segments, 0)
    closeTo(x1, 0, 1e-4)
    closeTo(y1, -10, 1e-4)

    const lastIndex = drawing.stats.segmentCount - 1
    const [, , x2, y2] = segmentAt(drawing.segments, lastIndex)
    closeTo(x2, 0, 1e-4)
    closeTo(y2, 10, 1e-4)

    // Every sampled point must sit on the right half (x >= 0).
    for (let i = 0; i < drawing.stats.segmentCount; i++) {
      expect(segmentAt(drawing.segments, i)[0]).toBeGreaterThanOrEqual(-1e-6)
    }
  })

  it('closes a CIRCLE back onto its start point', () => {
    const drawing = parseDxf(dxf(entities(circle('0', 100, 200, 50))))
    const first = segmentAt(drawing.segments, 0)
    const last = segmentAt(drawing.segments, drawing.stats.segmentCount - 1)
    closeTo(last[2], first[0], 1e-3)
    closeTo(last[3], first[1], 1e-3)
  })

  it('reports unsupported entity types instead of dropping them silently', () => {
    const spline = pair(0, 'SPLINE') + pair(8, '0') + pair(10, 0) + pair(20, 0)
    const drawing = parseDxf(dxf(entities(line('0', 0, 0, 1, 1) + spline)))

    expect(drawing.stats.skippedTypes.SPLINE).toBe(1)
    expect(drawing.stats.segmentCount).toBe(1)
  })
})

describe('polylines', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]

  it('emits n-1 segments when open and n when closed', () => {
    const open = parseDxf(dxf(entities(lwpolyline('0', square, false))))
    const closed = parseDxf(dxf(entities(lwpolyline('0', square, true))))

    expect(open.stats.segmentCount).toBe(3)
    expect(closed.stats.segmentCount).toBe(4)
    expect(segmentAt(closed.segments, 3)).toEqual([0, 10, 0, 0])
  })

  it('treats the pre-R13 POLYLINE/VERTEX form the same as LWPOLYLINE', () => {
    const modern = parseDxf(dxf(entities(lwpolyline('0', square, true))))
    const legacy = parseDxf(dxf(entities(polyline('0', square, true))))

    expect(legacy.stats.segmentCount).toBe(modern.stats.segmentCount)
    expect([...legacy.segments]).toEqual([...modern.segments])
  })

  it('expands a bulge into an arc that ends on the next vertex', () => {
    // bulge = tan(90°/4) is a quarter-circle.
    const bulge = Math.tan(Math.PI / 8)
    const drawing = parseDxf(
      dxf(
        entities(
          lwpolyline('0', [
            { x: 0, y: 0, bulge },
            { x: 100, y: 0 },
          ]),
        ),
      ),
    )

    expect(drawing.stats.segmentCount).toBeGreaterThan(1)
    const first = segmentAt(drawing.segments, 0)
    const last = segmentAt(drawing.segments, drawing.stats.segmentCount - 1)
    closeTo(first[0], 0, 1e-3)
    closeTo(first[1], 0, 1e-3)
    closeTo(last[2], 100, 1e-3)
    closeTo(last[3], 0, 1e-3)

    // A positive bulge sweeps counter-clockwise, which for a left-to-right
    // chord puts the arc below it. The sagitta is bulge · chord / 2.
    let lowest = 0
    for (let i = 0; i < drawing.stats.segmentCount; i++) {
      lowest = Math.min(lowest, segmentAt(drawing.segments, i)[1])
    }
    closeTo(lowest, -(bulge * 100) / 2, 0.5)
  })

  it('mirrors the arc for a negative bulge', () => {
    const bulge = -Math.tan(Math.PI / 8)
    const drawing = parseDxf(
      dxf(
        entities(
          lwpolyline('0', [
            { x: 0, y: 0, bulge },
            { x: 100, y: 0 },
          ]),
        ),
      ),
    )

    let highest = 0
    for (let i = 0; i < drawing.stats.segmentCount; i++) {
      highest = Math.max(highest, segmentAt(drawing.segments, i)[1])
    }
    closeTo(highest, (Math.abs(bulge) * 100) / 2, 0.5)
  })
})

describe('blocks', () => {
  const doorBlock = block('DOOR', 0, 0, line('A-DOOR', 0, 0, 100, 0))

  it('places an INSERT with translation and rotation', () => {
    const drawing = parseDxf(
      dxf(section('BLOCKS', doorBlock), entities(insert('0', 'DOOR', 500, 300, { rotation: 90 }))),
    )

    expect(drawing.stats.segmentCount).toBe(1)
    const [x1, y1, x2, y2] = segmentAt(drawing.segments, 0)
    closeTo(x1, 500, 1e-6)
    closeTo(y1, 300, 1e-6)
    closeTo(x2, 500, 1e-6)
    closeTo(y2, 400, 1e-6)
  })

  it('subtracts the block base point', () => {
    const offsetBlock = block('OFF', 10, 10, line('0', 10, 10, 20, 10))
    const drawing = parseDxf(
      dxf(section('BLOCKS', offsetBlock), entities(insert('0', 'OFF', 0, 0))),
    )

    expect(segmentAt(drawing.segments, 0)).toEqual([0, 0, 10, 0])
  })

  it('applies non-uniform scale', () => {
    const drawing = parseDxf(
      dxf(
        section('BLOCKS', doorBlock),
        entities(insert('0', 'DOOR', 0, 0, { scaleX: 2, scaleY: 3 })),
      ),
    )
    expect(segmentAt(drawing.segments, 0)).toEqual([0, 0, 200, 0])
  })

  it('keeps the block body out of the top-level entity counts', () => {
    const drawing = parseDxf(dxf(section('BLOCKS', doorBlock), entities(insert('0', 'DOOR', 0, 0))))
    expect(drawing.stats.entityCounts.LINE).toBeUndefined()
    expect(drawing.stats.entityCounts.INSERT).toBe(1)
  })

  it('ignores an INSERT of a block that does not exist', () => {
    const drawing = parseDxf(dxf(entities(insert('0', 'MISSING', 0, 0))))
    expect(drawing.stats.segmentCount).toBe(0)
  })

  it('cuts recursive block references at the depth limit', () => {
    // A block that inserts itself — malformed, but files like this exist and
    // must not hang the import.
    const recursive = block('LOOP', 0, 0, line('0', 0, 0, 1, 0) + insert('0', 'LOOP', 1, 0))
    const drawing = parseDxf(
      dxf(section('BLOCKS', recursive), entities(insert('0', 'LOOP', 0, 0))),
      { maxInsertDepth: 4 },
    )

    expect(drawing.stats.droppedNestedInserts).toBeGreaterThan(0)
    expect(drawing.stats.segmentCount).toBeLessThanOrEqual(4)
  })
})

describe('layers', () => {
  it('marks a layer hidden when the table negates its colour', () => {
    const drawing = parseDxf(
      dxf(
        layerTable([
          { name: 'VISIBLE', color: 7 },
          { name: 'OFF', color: -3 },
        ]),
        entities(line('OFF', 0, 0, 1, 1)),
      ),
    )

    const off = drawing.layers.find((l) => l.name === 'OFF')
    expect(off?.visible).toBe(false)
    expect(off?.colorIndex).toBe(3)
    expect(drawing.layers.find((l) => l.name === 'VISIBLE')?.visible).toBe(true)
  })

  it('marks a frozen layer hidden', () => {
    const drawing = parseDxf(dxf(layerTable([{ name: 'FROZEN', flags: 1 }])))
    expect(drawing.layers.find((l) => l.name === 'FROZEN')?.visible).toBe(false)
  })

  it('keeps geometry on a layer the table never declared', () => {
    const drawing = parseDxf(
      dxf(layerTable([{ name: 'DECLARED' }]), entities(line('GHOST', 0, 0, 1, 1))),
    )

    expect(drawing.stats.segmentCount).toBe(1)
    const ghost = drawing.layers[drawing.segmentLayers[0]!]
    expect(ghost?.name).toBe('GHOST')
    expect(ghost?.visible).toBe(true)
  })
})

describe('header', () => {
  it('resolves $INSUNITS to metres per unit', () => {
    const mm = parseDxf(dxf(header({ $INSUNITS: [70, 4] })))
    expect(mm.units.metersPerUnit).toBe(0.001)

    const feet = parseDxf(dxf(header({ $INSUNITS: [70, 2] })))
    expect(feet.units.metersPerUnit).toBe(0.3048)
  })

  it('leaves a unitless drawing uncalibrated rather than assuming metres', () => {
    const unitless = parseDxf(dxf(header({ $INSUNITS: [70, 0] })))
    expect(unitless.units.insunits).toBe(0)
    expect(unitless.units.metersPerUnit).toBeNull()

    const missing = parseDxf(dxf(header()))
    expect(missing.units.metersPerUnit).toBeNull()
  })

  it('does not let a header variable swallow a later layer flag', () => {
    const drawing = parseDxf(
      dxf(header({ $ACADVER: [1, 'AC1027'] }), layerTable([{ name: 'A', flags: 0 }])),
    )
    expect(drawing.layers.find((l) => l.name === 'A')?.visible).toBe(true)
  })
})

describe('curve tolerance', () => {
  function circleSegments(source: string) {
    return parseDxf(source).stats.segmentCount
  }

  it('tessellates the same drawing identically in millimetres and in metres', () => {
    // A 0.45 m circle, declared once in mm and once in m. An absolute
    // tolerance would give the metre version a single chord.
    const inMillimetres = circleSegments(
      dxf(header({ $INSUNITS: [70, 4] }), entities(circle('0', 0, 0, 450))),
    )
    const inMetres = circleSegments(
      dxf(header({ $INSUNITS: [70, 6] }), entities(circle('0', 0, 0, 0.45))),
    )

    expect(inMetres).toBe(inMillimetres)
    expect(inMetres).toBeGreaterThan(20)
  })

  it('falls back to a radius-relative budget when the drawing is unitless', () => {
    const small = circleSegments(dxf(entities(circle('0', 0, 0, 0.45))))
    const large = circleSegments(dxf(entities(circle('0', 0, 0, 450))))

    expect(small).toBe(large)
    expect(small).toBeGreaterThan(20)
  })

  it('honours an explicit tolerance over the unit-derived one', () => {
    const coarse = parseDxf(dxf(header({ $INSUNITS: [70, 4] }), entities(circle('0', 0, 0, 450))), {
      arcTolerance: 100,
    })
    const fine = parseDxf(dxf(header({ $INSUNITS: [70, 4] }), entities(circle('0', 0, 0, 450))), {
      arcTolerance: 0.1,
    })

    expect(coarse.stats.segmentCount).toBeLessThan(fine.stats.segmentCount)
  })

  it('tessellates a scaled block in its final size, not its authored size', () => {
    // A 1-unit arc inserted at 500×. Judging tolerance before the scale would
    // emit a couple of chords for what ends up a 500-unit curve.
    const body = block('DOT', 0, 0, arc('0', 0, 0, 1, 0, 90))
    const unscaled = parseDxf(
      dxf(
        header({ $INSUNITS: [70, 4] }),
        section('BLOCKS', body),
        entities(insert('0', 'DOT', 0, 0)),
      ),
    )
    const scaled = parseDxf(
      dxf(
        header({ $INSUNITS: [70, 4] }),
        section('BLOCKS', body),
        entities(insert('0', 'DOT', 0, 0, { scaleX: 500, scaleY: 500 })),
      ),
    )

    expect(scaled.stats.segmentCount).toBeGreaterThan(unscaled.stats.segmentCount)
  })

  it('caps tessellation so one huge curve cannot blow up the drawing', () => {
    const huge = parseDxf(dxf(header({ $INSUNITS: [70, 4] }), entities(circle('0', 0, 0, 1e7))))
    expect(huge.stats.segmentCount).toBeLessThanOrEqual(512)
  })
})

describe('robustness', () => {
  it('parses CRLF line endings', () => {
    const source = dxf(
      layerTable([{ name: 'DUVAR' }]),
      entities(line('DUVAR', 0, 0, 3, 4)),
    ).replace(/\n/g, '\r\n')
    const drawing = parseDxf(source)

    expect(drawing.stats.segmentCount).toBe(1)
    expect(drawing.layers.find((l) => l.name === 'DUVAR')).toBeDefined()
  })

  it('rejects binary DXF with an actionable message', () => {
    expect(() => parseDxf('AutoCAD Binary DXF\r\n ')).toThrow(/ASCII DXF/)
  })

  it('survives a truncated file', () => {
    const truncated = dxf(entities(line('0', 0, 0, 1, 1))).slice(0, 40)
    expect(() => parseDxf(truncated)).not.toThrow()
  })

  it('mirrors geometry when the extrusion direction is negated', () => {
    const mirrored = parseDxf(
      dxf(entities(line('0', 10, 5, 20, 5, pair(210, 0) + pair(220, 0) + pair(230, -1)))),
    )
    expect(segmentAt(mirrored.segments, 0)).toEqual([-10, 5, -20, 5])
  })
})

describe('bounds', () => {
  it('covers every emitted point', () => {
    const tolerance = 0.5
    const drawing = parseDxf(dxf(entities(line('0', -5, -2, 15, 30) + circle('0', 0, 0, 50))), {
      arcTolerance: tolerance,
    })

    for (let i = 0; i < drawing.stats.segmentCount; i++) {
      const [x1, y1, x2, y2] = segmentAt(drawing.segments, i)
      for (const [x, y] of [
        [x1, y1],
        [x2, y2],
      ] as const) {
        expect(x).toBeGreaterThanOrEqual(drawing.bounds.minX)
        expect(x).toBeLessThanOrEqual(drawing.bounds.maxX)
        expect(y).toBeGreaterThanOrEqual(drawing.bounds.minY)
        expect(y).toBeLessThanOrEqual(drawing.bounds.maxY)
      }
    }

    // Chords are inscribed, so the tessellated circle sits inside the true
    // one by at most the sagitta tolerance — never outside it.
    expect(drawing.bounds.minX).toBeGreaterThanOrEqual(-50)
    expect(drawing.bounds.minX).toBeLessThanOrEqual(-50 + tolerance)
    expect(drawing.bounds.maxY).toBeGreaterThanOrEqual(50 - tolerance)
    expect(drawing.bounds.maxY).toBeLessThanOrEqual(50)
  })

  it('is zeroed for an empty drawing rather than infinite', () => {
    const drawing = parseDxf(dxf(entities('')))
    expect(drawing.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 })
  })
})
