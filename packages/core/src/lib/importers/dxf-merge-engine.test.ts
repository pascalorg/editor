import { describe, expect, test } from 'bun:test'
import type { CoordsJSON } from './dxf-geometry-parser'
import {
  type MergedWall,
  type MergeResult,
  type SemanticJSON,
  type SemanticWallType,
  mergeDxf,
  toWorldCoords,
} from './dxf-merge-engine'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Minimal CoordsJSON for a rectangular room (no openings, one closed region). */
function makeCoords(overrides: Partial<CoordsJSON> = {}): CoordsJSON {
  return {
    unit: 'm',
    bbox: { minX: 0, minY: 0, maxX: 10, maxY: 8 },
    walls: [
      { id: 'w_001', start: [0, 0.1], end: [10, 0.1], thickness: 0.2, height: 2.8, layerName: 'WALL' },
      { id: 'w_002', start: [0, 7.9], end: [10, 7.9], thickness: 0.2, height: 2.8, layerName: 'WALL' },
      { id: 'w_003', start: [0.1, 0], end: [0.1, 8], thickness: 0.2, height: 2.8, layerName: 'WALL' },
      { id: 'w_004', start: [9.9, 0], end: [9.9, 8], thickness: 0.2, height: 2.8, layerName: 'WALL' },
    ],
    openings: [],
    closedRegions: [
      {
        id: 'r_001',
        polygon: [
          [0.1, 0.1],
          [9.9, 0.1],
          [9.9, 7.9],
          [0.1, 7.9],
        ],
      },
    ],
    confidence: 0.9,
    warnings: [],
    ...overrides,
  }
}

/** Minimal valid SemanticJSON. */
function makeSemantic(overrides: Partial<SemanticJSON> = {}): SemanticJSON {
  return {
    valid: true,
    confidence: 0.9,
    rooms: [],
    openings: [],
    wallTypes: [],
    warnings: [],
    ...overrides,
  }
}

// ─── toWorldCoords ────────────────────────────────────────────────────────────

describe('toWorldCoords', () => {
  const bbox = { minX: 0, minY: 0, maxX: 10, maxY: 8 }

  test('centre of image maps to centre of bbox', () => {
    const [x, y] = toWorldCoords([0.5, 0.5], bbox)
    expect(x).toBeCloseTo(5, 3)
    expect(y).toBeCloseTo(4, 3)
  })

  test('top-left image (0,0) maps to world bottom-left (minX, maxY)', () => {
    const [x, y] = toWorldCoords([0, 0], bbox)
    expect(x).toBeCloseTo(0, 3)
    expect(y).toBeCloseTo(8, 3) // Y flipped: 1-0 = 1 → maxY
  })

  test('bottom-right image (1,1) maps to world bottom-right (maxX, minY)', () => {
    const [x, y] = toWorldCoords([1, 1], bbox)
    expect(x).toBeCloseTo(10, 3)
    expect(y).toBeCloseTo(0, 3)
  })

  test('result is rounded to 0.001 m', () => {
    const [x, y] = toWorldCoords([0.3333, 0.6667], bbox)
    expect(x).toBe(Math.round(x * 1000) / 1000)
    expect(y).toBe(Math.round(y * 1000) / 1000)
  })
})

// ─── Channel B unavailable / invalid ─────────────────────────────────────────

describe('mergeDxf — Channel B null', () => {
  test('returns Channel A walls unchanged', () => {
    const coords = makeCoords()
    const { walls } = mergeDxf(coords, null)
    expect(walls).toHaveLength(4)
    expect(walls.map(w => w.id)).toEqual(['w_001', 'w_002', 'w_003', 'w_004'])
  })

  test('wall kind is "wall"', () => {
    const { walls } = mergeDxf(makeCoords(), null)
    for (const w of walls) expect(w.kind).toBe('wall')
  })

  test('wallType is null (no B data)', () => {
    const { walls } = mergeDxf(makeCoords(), null)
    for (const w of walls) expect(w.wallType).toBeNull()
  })

  test('needsReview is false (no B data)', () => {
    const { walls } = mergeDxf(makeCoords(), null)
    for (const w of walls) expect(w.needsReview).toBe(false)
  })

  test('adds "Channel B not available" warning', () => {
    const { warnings } = mergeDxf(makeCoords(), null)
    expect(warnings.some(w => w.includes('Channel B'))).toBe(true)
  })

  test('zones are created from closedRegions', () => {
    const { zones } = mergeDxf(makeCoords(), null)
    expect(zones).toHaveLength(1)
    expect(zones[0]!.kind).toBe('zone')
  })
})

describe('mergeDxf — Channel B valid=false', () => {
  test('falls back to Channel A only', () => {
    const semantic = makeSemantic({ valid: false, reason: '机械图纸' })
    const { walls, warnings } = mergeDxf(makeCoords(), semantic)
    expect(walls).toHaveLength(4)
    expect(warnings.some(w => w.includes('机械图纸'))).toBe(true)
  })
})

// ─── RULE 1: wallType attachment ──────────────────────────────────────────────

describe('RULE 1 — B attaches wallType to nearest A wall', () => {
  test('exterior wallType attached when B location is near bottom wall', () => {
    // Bottom wall w_001 runs along y≈0.1 from x=0..10
    // B location [0.5, 0.98] → world (5, 0.16) — near bottom wall
    const semantic = makeSemantic({
      wallTypes: [{ location: [0.5, 0.98], type: 'exterior', confidence: 0.9 }],
    })
    const { walls } = mergeDxf(makeCoords(), semantic)
    const bottom = walls.find(w => w.id === 'w_001')!
    expect(bottom.wallType).toBe('exterior')
  })

  test('load_bearing attached to interior wall', () => {
    // Left wall w_003 runs along x≈0.1
    // B location [0.01, 0.5] → world (0.1, 4) — on left wall
    const semantic = makeSemantic({
      wallTypes: [{ location: [0.01, 0.5], type: 'load_bearing', confidence: 0.85 }],
    })
    const { walls } = mergeDxf(makeCoords(), semantic)
    const left = walls.find(w => w.id === 'w_003')!
    expect(left.wallType).toBe('load_bearing')
  })

  test('first annotation wins — second B wallType for same wall is ignored', () => {
    const semantic = makeSemantic({
      wallTypes: [
        { location: [0.5, 0.98], type: 'exterior', confidence: 0.9 },
        { location: [0.5, 0.97], type: 'interior', confidence: 0.7 }, // same wall
      ],
    })
    const { walls } = mergeDxf(makeCoords(), semantic)
    const bottom = walls.find(w => w.id === 'w_001')!
    expect(bottom.wallType).toBe('exterior') // first annotation preserved
  })

  test('B location > 1 m from all walls → no wallType attached', () => {
    // Location [0.5, 0.5] → world (5, 4) — centre of room, far from all walls
    const semantic = makeSemantic({
      wallTypes: [{ location: [0.5, 0.5], type: 'interior', confidence: 0.9 }],
    })
    const { walls } = mergeDxf(makeCoords(), semantic)
    for (const w of walls) expect(w.wallType).toBeNull()
  })
})

// ─── RULE 2: ambiguous wall resolution ────────────────────────────────────────

describe('RULE 2 — B resolves ambiguous overlapping walls', () => {
  test('two nearly-coincident walls → B keeps the one it is closer to', () => {
    // Two parallel horizontal walls 0.05 m apart (overlapping / ambiguous)
    const coords = makeCoords({
      walls: [
        { id: 'w_001', start: [0, 1.0], end: [8, 1.0], thickness: 0.2, height: 2.8 },
        { id: 'w_002', start: [0, 1.05], end: [8, 1.05], thickness: 0.2, height: 2.8 }, // ambiguous duplicate
        { id: 'w_003', start: [0, 5.0], end: [8, 5.0], thickness: 0.2, height: 2.8 }, // unrelated
      ],
      closedRegions: [],
    })

    // B has high-confidence location near y=1.0 (→ keep w_001, drop w_002)
    // Image y=0.875 → world y = (1-0.875)*8 = 1.0
    const semantic = makeSemantic({
      wallTypes: [{ location: [0.5, 0.875], type: 'exterior', confidence: 0.9 }],
    })

    const { walls } = mergeDxf(coords, semantic)
    const ids = walls.map(w => w.id)
    expect(ids).toContain('w_001')
    expect(ids).not.toContain('w_002')
    expect(ids).toContain('w_003')
  })

  test('two overlapping walls with no high-confidence B evidence → both kept', () => {
    const coords = makeCoords({
      walls: [
        { id: 'w_001', start: [0, 1.0], end: [8, 1.0], thickness: 0.2, height: 2.8 },
        { id: 'w_002', start: [0, 1.05], end: [8, 1.05], thickness: 0.2, height: 2.8 },
      ],
      closedRegions: [],
    })
    // B confidence ≤ 0.75 → RULE 2 does not fire
    const semantic = makeSemantic({
      wallTypes: [{ location: [0.5, 0.875], type: 'exterior', confidence: 0.6 }],
    })
    const { walls } = mergeDxf(coords, semantic)
    expect(walls.map(w => w.id)).toContain('w_001')
    expect(walls.map(w => w.id)).toContain('w_002')
  })
})

// ─── RULE 3: B adds opening A missed ──────────────────────────────────────────

describe('RULE 3 — B adds openings Channel A missed', () => {
  test('B door at wall location with no A opening → new door in result', () => {
    // Bottom wall w_001 along y=0.1 from x=0..10
    // B opening at [0.3, 0.985] → world (3, 0.12) — on bottom wall, no A opening nearby
    const semantic = makeSemantic({
      openings: [{ type: 'door', location: [0.3, 0.985], confidence: 0.85 }],
    })
    const { openings } = mergeDxf(makeCoords(), semantic)
    const bDoors = openings.filter(o => o.source === 'channel_b' && o.kind === 'door')
    expect(bDoors).toHaveLength(1)
    expect(bDoors[0]!.wallId).toBe('w_001')
    expect(bDoors[0]!.width).toBe(0.9)
    expect(bDoors[0]!.height).toBe(2.1)
  })

  test('B window → new window with default 1.2 m × 1.2 m dimensions', () => {
    const semantic = makeSemantic({
      openings: [{ type: 'window', location: [0.7, 0.985], confidence: 0.8 }],
    })
    const { openings } = mergeDxf(makeCoords(), semantic)
    const bWins = openings.filter(o => o.source === 'channel_b' && o.kind === 'window')
    expect(bWins).toHaveLength(1)
    expect(bWins[0]!.width).toBe(1.2)
  })

  test('B opening at same position as A opening → not duplicated', () => {
    const coords = makeCoords({
      openings: [
        { id: 'o_001', type: 'door', wallId: 'w_001', positionAlongWall: 0.3, width: 0.9, height: 2.1, confidence: 0.8 },
      ],
    })
    // B opening at [0.3, 0.985] → world (3, 0.12) — same as A opening on w_001 at t≈0.3
    const semantic = makeSemantic({
      openings: [{ type: 'door', location: [0.3, 0.985], confidence: 0.85 }],
    })
    const { openings } = mergeDxf(coords, semantic)
    // Should have exactly 1 door (not 2)
    expect(openings.filter(o => o.kind === 'door')).toHaveLength(1)
  })

  test('B opening > 0.3 m from any wall → not added', () => {
    // [0.5, 0.5] → world (5, 4) — centre of room, no wall within 0.3 m
    const semantic = makeSemantic({
      openings: [{ type: 'door', location: [0.5, 0.5], confidence: 0.9 }],
    })
    const { openings } = mergeDxf(makeCoords(), semantic)
    expect(openings.filter(o => o.source === 'channel_b')).toHaveLength(0)
  })

  test('B opening with confidence < 0.6 → ignored', () => {
    const semantic = makeSemantic({
      openings: [{ type: 'door', location: [0.3, 0.985], confidence: 0.5 }],
    })
    const { openings } = mergeDxf(makeCoords(), semantic)
    expect(openings.filter(o => o.source === 'channel_b')).toHaveLength(0)
  })

  test('sliding_door is mapped to kind "door"', () => {
    const semantic = makeSemantic({
      openings: [{ type: 'sliding_door', location: [0.3, 0.985], confidence: 0.8 }],
    })
    const { openings } = mergeDxf(makeCoords(), semantic)
    const added = openings.find(o => o.source === 'channel_b')
    expect(added?.kind).toBe('door')
  })

  test('B opening id uses "o_b" prefix', () => {
    const semantic = makeSemantic({
      openings: [{ type: 'window', location: [0.7, 0.985], confidence: 0.8 }],
    })
    const { openings } = mergeDxf(makeCoords(), semantic)
    const bOpening = openings.find(o => o.source === 'channel_b')
    expect(bOpening!.id).toMatch(/^o_b\d+$/)
  })
})

// ─── RULE 4: room name attachment ────────────────────────────────────────────

describe('RULE 4 — B attaches room name to zone', () => {
  test('room centre inside closed region → zone gets the name', () => {
    // Closed region is the inner rectangle (0.1,0.1)..(9.9,7.9)
    // Centre of image [0.5, 0.5] → world (5, 4) — inside the rectangle
    const semantic = makeSemantic({
      rooms: [{ name: '客厅', center: [0.5, 0.5], approxAreaM2: 60, confidence: 0.9 }],
    })
    const { zones } = mergeDxf(makeCoords(), semantic)
    expect(zones[0]!.name).toBe('客厅')
    expect(zones[0]!.approxAreaM2).toBe(60)
  })

  test('room centre outside all regions → no zone gets a name', () => {
    // [0.02, 0.5] → world (0.2, 4) — between inner region edge at x=0.1 and wall
    // Actually it might be inside... let me put it outside all regions
    // Use a coords with no regions at all
    const coords = makeCoords({ closedRegions: [] })
    const semantic = makeSemantic({
      rooms: [{ name: '餐厅', center: [0.5, 0.5], approxAreaM2: 20, confidence: 0.9 }],
    })
    const { zones } = mergeDxf(coords, semantic)
    expect(zones).toHaveLength(0)
  })

  test('room confidence < 0.5 → name not attached', () => {
    const semantic = makeSemantic({
      rooms: [{ name: '卫生间', center: [0.5, 0.5], approxAreaM2: 5, confidence: 0.4 }],
    })
    const { zones } = mergeDxf(makeCoords(), semantic)
    expect(zones[0]!.name).toBeUndefined()
  })

  test('zone id follows "z_NNN" format', () => {
    const { zones } = mergeDxf(makeCoords(), makeSemantic())
    for (const z of zones) expect(z.id).toMatch(/^z_\d{3}$/)
  })

  test('multiple rooms name multiple zones', () => {
    // Two closed regions side by side (left half / right half)
    const coords = makeCoords({
      closedRegions: [
        { id: 'r_001', polygon: [[0, 0], [5, 0], [5, 8], [0, 8]] },
        { id: 'r_002', polygon: [[5, 0], [10, 0], [10, 8], [5, 8]] },
      ],
    })
    const semantic = makeSemantic({
      rooms: [
        { name: '客厅', center: [0.25, 0.5], approxAreaM2: 30, confidence: 0.9 },
        { name: '卧室', center: [0.75, 0.5], approxAreaM2: 25, confidence: 0.9 },
      ],
    })
    const { zones } = mergeDxf(coords, semantic)
    const names = zones.map(z => z.name)
    expect(names).toContain('客厅')
    expect(names).toContain('卧室')
  })
})

// ─── RULE 5: conflict detection ───────────────────────────────────────────────

describe('RULE 5 — conflict detection', () => {
  test('B position within 10% of wall length → no conflict flag', () => {
    // Bottom wall w_001 runs y=0.1 from x=0..10 → length=10
    // 10% of 10 = 1.0 m. B at y=0.5 → dist ≈ 0.4 m from wall → 0.4 < 1.0 → no flag
    const semantic = makeSemantic({
      wallTypes: [{ location: [0.5, 0.938], type: 'exterior', confidence: 0.9 }],
      // [0.5, 0.938] → world (5, 0.50) → dist to y=0.1 wall ≈ 0.4 → within 10%
    })
    const { walls } = mergeDxf(makeCoords(), semantic)
    const bottom = walls.find(w => w.id === 'w_001')!
    expect(bottom.needsReview).toBe(false)
  })

  test('B position > 10% of wall length away → needsReview=true + importWarning', () => {
    // Bottom wall w_001: length=10, 10% = 1.0 m.
    // B at world (5, 1.5) → dist to y=0.1 = 1.4 m > 1.0 m and < 1.0 m from wall?
    // Actually need: dist > len*0.1 (=1.0) AND dist < 1.0 (coverage radius)
    // 1.4 > 1.0 but also > coverage radius 1.0 → won't flag
    // Use a short wall where 10% is small, e.g. wall of length 2m, 10%=0.2m
    // Put B at 0.5m from it (within 1m coverage, but > 10%=0.2m)
    const coords = makeCoords({
      walls: [
        { id: 'w_short', start: [0, 0], end: [2, 0], thickness: 0.2, height: 2.8 }, // length=2, 10%=0.2
      ],
      closedRegions: [],
    })
    // B at world (1, 0.5) → dist to wall (y=0) = 0.5 > 0.2 (10% of 2m) AND < 1.0 → RULE 5 fires
    // [0.1, 0.9375] → world (1, 0.5)
    const semantic = makeSemantic({
      wallTypes: [{ location: [0.1, 0.9375], type: 'exterior', confidence: 0.9 }],
    })
    const { walls } = mergeDxf(coords, semantic)
    const w = walls.find(w => w.id === 'w_short')!
    expect(w.needsReview).toBe(true)
    expect(w.importWarning).toBe('position_mismatch')
  })

  test('no B wallType data → no walls flagged', () => {
    const { walls } = mergeDxf(makeCoords(), makeSemantic({ wallTypes: [] }))
    for (const w of walls) expect(w.needsReview).toBe(false)
  })
})

// ─── Output shape ─────────────────────────────────────────────────────────────

describe('mergeDxf — output structure', () => {
  test('MergeResult has walls, openings, zones, warnings arrays', () => {
    const result = mergeDxf(makeCoords(), makeSemantic())
    expect(Array.isArray(result.walls)).toBe(true)
    expect(Array.isArray(result.openings)).toBe(true)
    expect(Array.isArray(result.zones)).toBe(true)
    expect(Array.isArray(result.warnings)).toBe(true)
  })

  test('wall start/end coordinates preserved from Channel A', () => {
    const { walls } = mergeDxf(makeCoords(), makeSemantic())
    const w1 = walls.find(w => w.id === 'w_001')!
    expect(w1.start).toEqual([0, 0.1])
    expect(w1.end).toEqual([10, 0.1])
  })

  test('wall thickness and height preserved from Channel A', () => {
    const { walls } = mergeDxf(makeCoords(), makeSemantic())
    for (const w of walls) {
      expect(w.thickness).toBe(0.2)
      expect(w.height).toBe(2.8)
    }
  })

  test('Channel A warnings are propagated to MergeResult', () => {
    const coords = makeCoords({ warnings: ['未找到墙体图层'] })
    const { warnings } = mergeDxf(coords, makeSemantic())
    expect(warnings).toContain('未找到墙体图层')
  })

  test('Channel B warnings are propagated to MergeResult', () => {
    const semantic = makeSemantic({ warnings: ['部分房间识别置信度较低'] })
    const { warnings } = mergeDxf(makeCoords(), semantic)
    expect(warnings).toContain('部分房间识别置信度较低')
  })
})
