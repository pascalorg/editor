import { describe, expect, test } from 'bun:test'
import {
  type DxfParsed,
  type DxfRawLine,
  correctJunctions,
  detectWalls,
  inferScale,
  parseDxfGeometry,
  snapEndpoints,
} from './dxf-geometry-parser'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  layer = 'WALL',
): DxfRawLine {
  return { type: 'LINE', layer, start: { x: x1, y: y1 }, end: { x: x2, y: y2 } }
}

/** Simple rectangular room with double-wall construction.
 *  Outer shell is 6 m × 3.2 m. Wall thickness 0.20 m.
 *  Coordinates are already in metres.
 */
function makeRoomDxf(layer = 'WALL'): DxfParsed {
  return {
    header: { $INSUNITS: 6 }, // metres
    entities: [
      // Bottom wall pair (horizontal, y=0 / y=0.2)
      makeLine(0, 0, 6, 0, layer),
      makeLine(0, 0.2, 6, 0.2, layer),
      // Top wall pair (y=3 / y=3.2)
      makeLine(0, 3, 6, 3, layer),
      makeLine(0, 3.2, 6, 3.2, layer),
      // Left wall pair (vertical, x=0 / x=0.2)
      makeLine(0, 0, 0, 3.2, layer),
      makeLine(0.2, 0, 0.2, 3.2, layer),
      // Right wall pair (x=5.8 / x=6)
      makeLine(5.8, 0, 5.8, 3.2, layer),
      makeLine(6, 0, 6, 3.2, layer),
      // Interior partition (y=1.5 / y=1.7)
      makeLine(0.2, 1.5, 5.8, 1.5, layer),
      makeLine(0.2, 1.7, 5.8, 1.7, layer),
    ],
  }
}

/** Room DXF with all coordinates in millimetres (no $INSUNITS header). */
function makeRoomDxfMm(): DxfParsed {
  const room = makeRoomDxf()
  return {
    header: {}, // no $INSUNITS → infer from bbox size
    entities: room.entities.map(e => {
      if (e.type !== 'LINE') return e
      const l = e as DxfRawLine
      return {
        ...l,
        start: { x: l.start.x * 1000, y: l.start.y * 1000 },
        end: { x: l.end.x * 1000, y: l.end.y * 1000 },
      } as DxfRawLine
    }),
  }
}

// ─── inferScale ───────────────────────────────────────────────────────────────

describe('inferScale', () => {
  test('$INSUNITS=4 → 0.001 (mm → m)', () => {
    expect(inferScale(4, 12000)).toBe(0.001)
  })

  test('$INSUNITS=6 → 1 (metres)', () => {
    expect(inferScale(6, 12)).toBe(1)
  })

  test('no header, maxDim ≥ 100 → 0.001 (inferred mm)', () => {
    expect(inferScale(undefined, 12000)).toBe(0.001)
  })

  test('no header, maxDim < 100 → 1 (inferred metres)', () => {
    expect(inferScale(undefined, 12)).toBe(1)
  })
})

// ─── snapEndpoints ────────────────────────────────────────────────────────────

describe('snapEndpoints', () => {
  test('endpoints exactly 3 mm apart merge to centroid', () => {
    const segs = [
      { x1: 0, y1: 0, x2: 5, y2: 0, layer: 'WALL' },
      { x1: 5.003, y1: 0, x2: 5.003, y2: 3, layer: 'WALL' }, // 3 mm off
    ]
    const snapped = snapEndpoints(segs, 0.005)
    // x2 of seg 0 and x1 of seg 1 should be the same value
    expect(snapped[0]!.x2).toBeCloseTo(snapped[1]!.x1, 3)
    expect(snapped[0]!.x2).toBeCloseTo(5.002, 3) // centroid of 5 and 5.003
  })

  test('endpoints exactly 6 mm apart remain distinct', () => {
    const segs = [
      { x1: 0, y1: 0, x2: 5, y2: 0 },
      { x1: 5.006, y1: 0, x2: 5.006, y2: 3 },
    ]
    const snapped = snapEndpoints(segs, 0.005)
    expect(snapped[0]!.x2).not.toBeCloseTo(snapped[1]!.x1, 2)
  })

  test('three endpoints all within 5 mm merge to single cluster', () => {
    const segs = [
      { x1: 0, y1: 0, x2: 1.001, y2: 0 },
      { x1: 1.002, y1: 0, x2: 1.002, y2: 2 },
      { x1: 0.999, y1: 0, x2: 3, y2: 0 },
    ]
    const snapped = snapEndpoints(segs, 0.005)
    // All three should converge to the same x value
    expect(snapped[0]!.x2).toBeCloseTo(snapped[1]!.x1, 2)
    expect(snapped[0]!.x2).toBeCloseTo(snapped[2]!.x1, 2)
  })

  test('rounds result to 1 mm precision', () => {
    const segs = [{ x1: 0, y1: 0, x2: 1.0001234, y2: 0 }]
    const snapped = snapEndpoints(segs, 0.005)
    // Should be rounded to nearest 0.001
    const v = snapped[0]!.x2
    expect(v).toBe(Math.round(v * 1000) / 1000)
  })
})

// ─── detectWalls ─────────────────────────────────────────────────────────────

describe('detectWalls — parallel pair detection', () => {
  const MIN = 0.08,
    MAX = 0.4

  test('two horizontal segments 0.2 m apart → one wall', () => {
    const segs = [
      { x1: 0, y1: 0, x2: 6, y2: 0 },
      { x1: 0, y1: 0.2, x2: 6, y2: 0.2 },
    ]
    const walls = detectWalls(segs, MIN, MAX)
    expect(walls).toHaveLength(1)
    expect(walls[0]!.thickness).toBeCloseTo(0.2, 3)
  })

  test('centreline is midway between the two segments', () => {
    const segs = [
      { x1: 0, y1: 0, x2: 6, y2: 0 },
      { x1: 0, y1: 0.2, x2: 6, y2: 0.2 },
    ]
    const [wall] = detectWalls(segs, MIN, MAX)!
    // Centreline y should be 0.1
    expect(wall!.start[1]).toBeCloseTo(0.1, 3)
    expect(wall!.end[1]).toBeCloseTo(0.1, 3)
  })

  test('segments 0.5 m apart (too wide for wall) → no match', () => {
    const segs = [
      { x1: 0, y1: 0, x2: 6, y2: 0 },
      { x1: 0, y1: 0.5, x2: 6, y2: 0.5 },
    ]
    expect(detectWalls(segs, MIN, MAX)).toHaveLength(0)
  })

  test('perpendicular segments → no match', () => {
    const segs = [
      { x1: 0, y1: 0, x2: 6, y2: 0 }, // horizontal
      { x1: 3, y1: -3, x2: 3, y2: 3 }, // vertical
    ]
    expect(detectWalls(segs, MIN, MAX)).toHaveLength(0)
  })

  test('segments with 25% length difference → no match', () => {
    const segs = [
      { x1: 0, y1: 0, x2: 4, y2: 0 },
      { x1: 0, y1: 0.2, x2: 6, y2: 0.2 }, // 50% longer
    ]
    expect(detectWalls(segs, MIN, MAX)).toHaveLength(0)
  })

  test('segments with < 30% overlap → no match', () => {
    const segs = [
      { x1: 0, y1: 0, x2: 3, y2: 0 },
      { x1: 4, y1: 0.2, x2: 7, y2: 0.2 }, // overlaps < 0%
    ]
    expect(detectWalls(segs, MIN, MAX)).toHaveLength(0)
  })

  test('four wall pairs in room fixture → four walls', () => {
    // Bottom/top/left/right walls = 4 pairs, plus 1 partition = 5 total
    const { entities } = makeRoomDxf()
    const segs = entities
      .filter(e => e.type === 'LINE')
      .map(e => {
        const l = e as DxfRawLine
        return { x1: l.start.x, y1: l.start.y, x2: l.end.x, y2: l.end.y }
      })
    const walls = detectWalls(segs, MIN, MAX)
    expect(walls.length).toBeGreaterThanOrEqual(4)
  })

  test('wall record inherits layer name from source segments', () => {
    const segs = [
      { x1: 0, y1: 0, x2: 5, y2: 0, layer: '承重墙' },
      { x1: 0, y1: 0.2, x2: 5, y2: 0.2, layer: '承重墙' },
    ]
    const [w] = detectWalls(segs, MIN, MAX)!
    expect(w!.layerName).toBe('承重墙')
  })
})

// ─── correctJunctions ────────────────────────────────────────────────────────

describe('correctJunctions', () => {
  test('L-junction: two perpendicular walls whose endpoints nearly meet snap to exact corner', () => {
    // Horizontal wall centreline ends at (5.9, 0.1)
    // Vertical wall centreline starts at (5.9, 0.1) — perfectly aligned, trivial snap
    const walls = [
      { start: [0, 0.1] as [number, number], end: [5.9, 0.1] as [number, number], thickness: 0.2, height: 2.8 },
      { start: [5.9, 0.1] as [number, number], end: [5.9, 3.1] as [number, number], thickness: 0.2, height: 2.8 },
    ]
    const corrected = correctJunctions(walls, 0.4)
    // After correction the shared endpoint should be identical
    expect(corrected[0]!.end[0]).toBeCloseTo(corrected[1]!.start[0], 3)
    expect(corrected[0]!.end[1]).toBeCloseTo(corrected[1]!.start[1], 3)
  })

  test('L-junction with 0.1 m gap snaps both endpoints to computed intersection', () => {
    // Horizontal wall ends at x=5.9, vertical starts at x=6.0 (0.1 m gap due to wall thickness)
    const walls = [
      { start: [0, 0.1] as [number, number], end: [5.9, 0.1] as [number, number], thickness: 0.2, height: 2.8 },
      { start: [6.0, 0.0] as [number, number], end: [6.0, 3.1] as [number, number], thickness: 0.2, height: 2.8 },
    ]
    const corrected = correctJunctions(walls, 0.4)
    // Both endpoints near the corner should snap to the same point
    expect(corrected[0]!.end[0]).toBeCloseTo(corrected[1]!.start[0], 2)
    expect(corrected[0]!.end[1]).toBeCloseTo(corrected[1]!.start[1], 2)
  })

  test('T-junction: endpoint of incoming wall sits on interior of through-wall → splits through-wall', () => {
    // Through-wall: horizontal from (0,1) to (6,1)
    // Incoming wall: vertical ending at (3, 1) — T-junction at x=3
    const walls = [
      { start: [0, 1] as [number, number], end: [6, 1] as [number, number], thickness: 0.2, height: 2.8 },
      { start: [3, 4] as [number, number], end: [3, 1] as [number, number], thickness: 0.2, height: 2.8 },
    ]
    const corrected = correctJunctions(walls, 0.4)
    // Should have 3 walls after splitting
    expect(corrected.length).toBeGreaterThanOrEqual(3)
  })

  test('parallel walls are not snapped to each other', () => {
    const walls = [
      { start: [0, 0] as [number, number], end: [6, 0] as [number, number], thickness: 0.2, height: 2.8 },
      { start: [0, 3] as [number, number], end: [6, 3] as [number, number], thickness: 0.2, height: 2.8 },
    ]
    const corrected = correctJunctions(walls, 0.4)
    // Endpoints of parallel walls should remain unchanged
    expect(corrected[0]!.start[1]).toBeCloseTo(0, 3)
    expect(corrected[1]!.start[1]).toBeCloseTo(3, 3)
  })
})

// ─── parseDxfGeometry — full pipeline ────────────────────────────────────────

describe('parseDxfGeometry', () => {
  test('output has unit = "m"', () => {
    expect(parseDxfGeometry(makeRoomDxf()).unit).toBe('m')
  })

  test('bbox is in metres and has correct shape', () => {
    const { bbox } = parseDxfGeometry(makeRoomDxf())
    // DXF Y is negated on import so north (+Y in DXF) maps to screen-up in Pascal.
    // Fixture room spans DXF Y [0, 3.2] → Pascal Y [-3.2, 0] after negation.
    expect(bbox.minX).toBeCloseTo(0,    3)
    expect(bbox.minY).toBeCloseTo(-3.2, 3)
    expect(bbox.maxX).toBeCloseTo(6,    3)
    expect(bbox.maxY).toBeCloseTo(0,    3)
  })

  test('wall ids follow "w_NNN" format', () => {
    const { walls } = parseDxfGeometry(makeRoomDxf())
    for (const w of walls) {
      expect(w.id).toMatch(/^w_\d{3}$/)
    }
  })

  test('wall coordinates are rounded to 0.001 m', () => {
    const { walls } = parseDxfGeometry(makeRoomDxf())
    for (const w of walls) {
      for (const coord of [...w.start, ...w.end]) {
        expect(coord).toBe(Math.round(coord * 1000) / 1000)
      }
    }
  })

  test('wall thickness is within thicknessMin..thicknessMax', () => {
    const { walls } = parseDxfGeometry(makeRoomDxf())
    for (const w of walls) {
      expect(w.thickness).toBeGreaterThanOrEqual(0.08)
      expect(w.thickness).toBeLessThanOrEqual(0.4)
    }
  })

  test('default wall height is 2.8 m', () => {
    const { walls } = parseDxfGeometry(makeRoomDxf())
    for (const w of walls) {
      expect(w.height).toBe(2.8)
    }
  })

  test('at least 4 walls detected in the room fixture', () => {
    const { walls } = parseDxfGeometry(makeRoomDxf())
    expect(walls.length).toBeGreaterThanOrEqual(4)
  })

  test('mm input is converted to metres (inferred from bbox size)', () => {
    const mmResult = parseDxfGeometry(makeRoomDxfMm())
    // Bbox should still be in metres (≈ 6m × 3.2m), not 6000 mm.
    // After Y-negation: maxX≈6, minY≈-3.2, maxY≈0.
    expect(mmResult.bbox.maxX).toBeCloseTo(6,    1)
    expect(mmResult.bbox.minY).toBeCloseTo(-3.2, 1)
  })

  test('mm input and m input produce the same number of walls', () => {
    const mWalls = parseDxfGeometry(makeRoomDxf()).walls.length
    const mmWalls = parseDxfGeometry(makeRoomDxfMm()).walls.length
    expect(mWalls).toBe(mmWalls)
  })

  test('openings array is present (may be empty for this fixture)', () => {
    expect(Array.isArray(parseDxfGeometry(makeRoomDxf()).openings)).toBe(true)
  })

  test('closed regions are detected for the room fixture', () => {
    const { closedRegions } = parseDxfGeometry(makeRoomDxf())
    expect(closedRegions.length).toBeGreaterThanOrEqual(1)
  })

  test('closed region polygons have at least 3 vertices', () => {
    const { closedRegions } = parseDxfGeometry(makeRoomDxf())
    for (const r of closedRegions) {
      expect(r.polygon.length).toBeGreaterThanOrEqual(3)
    }
  })

  test('confidence is in [0, 1]', () => {
    const { confidence } = parseDxfGeometry(makeRoomDxf())
    expect(confidence).toBeGreaterThanOrEqual(0)
    expect(confidence).toBeLessThanOrEqual(1)
  })

  test('warns when no wall layers present', () => {
    const dxf = makeRoomDxf('0') // generic layer '0', not a wall layer
    const { warnings } = parseDxfGeometry(dxf)
    expect(warnings.some(w => w.includes('墙体图层'))).toBe(true)
  })

  test('no warnings for a well-formed named-layer DXF', () => {
    const { warnings } = parseDxfGeometry(makeRoomDxf('WALL'))
    expect(warnings).toHaveLength(0)
  })

  test('window INSERT block is detected as opening', () => {
    const dxf: DxfParsed = {
      ...makeRoomDxf(),
      entities: [
        ...makeRoomDxf().entities,
        { type: 'INSERT', layer: 'WIN', name: 'WINDOW-1200', position: { x: 3, y: 0 } },
      ],
    }
    const { openings } = parseDxfGeometry(dxf)
    const win = openings.find(o => o.type === 'window')
    expect(win).toBeDefined()
  })

  test('explicit unitScale overrides $INSUNITS header', () => {
    // Room DXF uses $INSUNITS=6 (metres). Pass unitScale=0.001 (mm override)
    // → all coords should be scaled by 0.001 instead of 1.0
    const mResult = parseDxfGeometry(makeRoomDxf())                        // metres
    const mmResult = parseDxfGeometry(makeRoomDxf(), { unitScale: 0.001 }) // force mm scale

    // With mm scale, bbox is 1000× smaller than metre result
    expect(mmResult.bbox.maxX).toBeCloseTo(mResult.bbox.maxX * 0.001, 2)
    // No walls detected because 0.001 × 0.2 = 0.0002 m thickness < thicknessMin (0.08 m)
    expect(mmResult.walls.length).toBe(0)
    expect(mmResult.warnings.some(w => w.includes('平行线'))).toBe(true)
  })

  test('unitScale=0.001 on actual mm-coordinate DXF produces same walls as metre DXF', () => {
    const mmDxf = makeRoomDxfMm()
    const mmResult = parseDxfGeometry(mmDxf, { unitScale: 0.001 })
    const mResult  = parseDxfGeometry(makeRoomDxf())
    expect(mmResult.walls.length).toBe(mResult.walls.length)
    // Bbox should match (within rounding)
    expect(mmResult.bbox.maxX).toBeCloseTo(mResult.bbox.maxX, 1)
  })
})
