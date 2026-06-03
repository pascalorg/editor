import { describe, expect, test } from 'bun:test'
import {
  type BBox,
  type DxfEntity,
  type DxfLineEntity,
  type DxfLwPolylineEntity,
  validateDxf,
} from './dxf-validator'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  layer = 'WALL',
): DxfLineEntity {
  return { type: 'LINE', layer, start: { x: x1, y: y1 }, end: { x: x2, y: y2 } }
}

function polyline(vertices: Array<[number, number]>, closed = false, layer = 'WALL'): DxfLwPolylineEntity {
  return {
    type: 'LWPOLYLINE',
    layer,
    vertices: vertices.map(([x, y]) => ({ x, y })),
    closed,
  }
}

function generic(type: string, layer = '0'): DxfEntity {
  return { type, layer }
}

/**
 * Builds a simple rectangular room with double walls (parallel pairs).
 * Room inner dimensions approx 5m × 3m. Wall thickness 0.20m.
 * All four sides have two parallel line segments → 4 pairs.
 * The outer boundary forms a closed rectangle → closable region exists.
 */
function residentialFloorPlan(overrideLayer?: string): { entities: DxfEntity[]; bbox: BBox } {
  const L = overrideLayer

  // Bottom wall: y=0 (outer) and y=0.2 (inner), x 0→6
  // Top wall: y=3 (inner) and y=3.2 (outer), x 0→6
  // Left wall: x=0 (outer) and x=0.2 (inner), y 0→3.2
  // Right wall: x=5.8 (inner) and x=6 (outer), y 0→3.2
  const entities: DxfEntity[] = [
    // Bottom wall pair
    line(0, 0, 6, 0, L ?? 'WALL'),
    line(0, 0.2, 6, 0.2, L ?? 'WALL'),
    // Top wall pair
    line(0, 3, 6, 3, L ?? 'WALL'),
    line(0, 3.2, 6, 3.2, L ?? 'WALL'),
    // Left wall pair
    line(0, 0, 0, 3.2, L ?? 'WALL'),
    line(0.2, 0, 0.2, 3.2, L ?? 'WALL'),
    // Right wall pair
    line(5.8, 0, 5.8, 3.2, L ?? 'WALL'),
    line(6, 0, 6, 3.2, L ?? 'WALL'),
    // Dimension entity (soft-warning check)
    generic('DIMENSION'),
    // A few extra lines to reach comfortable entity count
    line(0.2, 1.5, 5.8, 1.5, L ?? 'WALL'), // interior partition
    line(0.2, 1.7, 5.8, 1.7, L ?? 'WALL'), // its pair
  ]

  return {
    entities,
    bbox: { minX: 0, minY: 0, maxX: 6, maxY: 3.2 },
  }
}

/**
 * Gear / mechanical part drawing.
 * BBox: 0.048m × 0.032m → diagonal ≈ 0.058m (< 3m)
 * ~70% CIRCLE + SPLINE entities → mechanical dominance
 * No parallel line pairs at wall-thickness scale
 * No closable region from lines alone (only circles)
 */
function gearDrawing(): { entities: DxfEntity[]; bbox: BBox } {
  const entities: DxfEntity[] = [
    // 14 circles (gear teeth outline)
    ...Array.from({ length: 14 }, () => generic('CIRCLE', 'GEAR')),
    // 3 splines (tooth profile)
    ...Array.from({ length: 3 }, () => generic('SPLINE', 'GEAR')),
    // 3 isolated short lines (dimension leaders, no wall pairs)
    line(0.001, 0.001, 0.005, 0.001, 'DIM'),
    line(0.010, 0.001, 0.014, 0.001, 'DIM'),
    line(0.020, 0.001, 0.024, 0.001, 'DIM'),
    // 1 arc
    generic('ARC', 'GEAR'),
  ]

  return {
    entities,
    bbox: { minX: 0, minY: 0, maxX: 0.048, maxY: 0.032 },
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('validateDxf — gear drawing (should reject)', () => {
  test('result.passed is false', () => {
    const { entities, bbox } = gearDrawing()
    const result = validateDxf(entities, bbox)
    expect(result.passed).toBe(false)
  })

  test('reports BBox diagonal check with the actual measurement', () => {
    const { entities, bbox } = gearDrawing()
    const { rejectReasons } = validateDxf(entities, bbox)
    const bboxReason = rejectReasons.find(r => r.includes('BBox diagonal'))
    expect(bboxReason).toBeDefined()
    // Must contain the measured diagonal (≈ 0.058 m)
    expect(bboxReason).toMatch(/0\.0\d+ m/)
    expect(bboxReason).toMatch(/3 m/)
  })

  test('reports mechanical entity dominance with percentages', () => {
    const { entities, bbox } = gearDrawing()
    const { rejectReasons } = validateDxf(entities, bbox)
    const mechReason = rejectReasons.find(r => r.includes('CIRCLE + SPLINE'))
    expect(mechReason).toBeDefined()
    // 17 mech / 21 total = 80%
    expect(mechReason).toMatch(/\d+%/)
    expect(mechReason).toMatch(/60%/)
  })

  test('confidence is 0 when rejected', () => {
    const { entities, bbox } = gearDrawing()
    expect(validateDxf(entities, bbox).confidence).toBe(0)
  })

  test('reject messages contain specific numeric values, not just generic text', () => {
    const { entities, bbox } = gearDrawing()
    const { rejectReasons } = validateDxf(entities, bbox)
    // Every reason must include at least one number
    for (const reason of rejectReasons) {
      expect(reason).toMatch(/\d/)
    }
  })
})

describe('validateDxf — normal residential floor plan (should pass)', () => {
  test('result.passed is true', () => {
    const { entities, bbox } = residentialFloorPlan()
    expect(validateDxf(entities, bbox).passed).toBe(true)
  })

  test('no rejectReasons', () => {
    const { entities, bbox } = residentialFloorPlan()
    expect(validateDxf(entities, bbox).rejectReasons).toHaveLength(0)
  })

  test('confidence is between 0.6 and 1.0', () => {
    const { entities, bbox } = residentialFloorPlan()
    const { confidence } = validateDxf(entities, bbox)
    expect(confidence).toBeGreaterThanOrEqual(0.6)
    expect(confidence).toBeLessThanOrEqual(1)
  })

  test('no spurious warnings for a well-formed plan', () => {
    const { entities, bbox } = residentialFloorPlan()
    const { warnings } = validateDxf(entities, bbox)
    // The only possible warning is "low parallel ratio" — wall-layer plan should be clean
    const unexpected = warnings.filter(
      w => w.includes('wall layers') && w.includes('recognition'),
    )
    expect(unexpected).toHaveLength(0)
  })
})

describe('validateDxf — no layer names (should warn)', () => {
  test('passes validation (not a hard reject)', () => {
    // Strip layer names by using empty string layer on all entities
    const { entities, bbox } = residentialFloorPlan('')
    expect(validateDxf(entities, bbox).passed).toBe(true)
  })

  test('emits wall-layer warning', () => {
    const { entities, bbox } = residentialFloorPlan('')
    const { warnings } = validateDxf(entities, bbox)
    const layerWarning = warnings.find(w => w.includes('wall layers found'))
    expect(layerWarning).toBeDefined()
    expect(layerWarning).toContain('WALL')
  })

  test('confidence is lower than a named-layer plan', () => {
    const { entities: namedEntities, bbox } = residentialFloorPlan('WALL')
    const { entities: unnamedEntities } = residentialFloorPlan('')
    const namedConf = validateDxf(namedEntities, bbox).confidence
    const unnamedConf = validateDxf(unnamedEntities, bbox).confidence
    expect(unnamedConf).toBeLessThan(namedConf)
  })
})

describe('validateDxf — file size checks', () => {
  test('rejects files over 10 MB with size in message', () => {
    const { entities, bbox } = residentialFloorPlan()
    const { passed, rejectReasons } = validateDxf(entities, bbox, {
      fileSizeBytes: 11 * 1024 * 1024,
    })
    expect(passed).toBe(false)
    const sizeReason = rejectReasons.find(r => r.includes('MB'))
    expect(sizeReason).toBeDefined()
    expect(sizeReason).toContain('10 MB')
  })

  test('warns for files between 1 MB and 10 MB', () => {
    const { entities, bbox } = residentialFloorPlan()
    const { passed, warnings } = validateDxf(entities, bbox, {
      fileSizeBytes: 2 * 1024 * 1024,
    })
    expect(passed).toBe(true)
    expect(warnings.some(w => w.includes('MB') && w.includes('longer'))).toBe(true)
  })

  test('no size warning for files under 1 MB', () => {
    const { entities, bbox } = residentialFloorPlan()
    const { warnings } = validateDxf(entities, bbox, { fileSizeBytes: 500 * 1024 })
    expect(warnings.some(w => w.includes('longer'))).toBe(false)
  })
})

describe('validateDxf — edge cases', () => {
  test('rejects empty entity list', () => {
    const result = validateDxf([], { minX: 0, minY: 0, maxX: 10, maxY: 8 })
    expect(result.passed).toBe(false)
    // message mentions segment count (0) and LINE + LWPOLYLINE entity type
    expect(result.rejectReasons.some(r => r.includes('LINE + LWPOLYLINE') && r.includes('0'))).toBe(true)
  })

  test('rejects bbox diagonal > 500m', () => {
    const { entities } = residentialFloorPlan()
    // Site-plan scale in mm: 600,000 × 400,000 mm = 600m × 400m → diagonal ≈ 721m > 500m
    const wideBbox: BBox = { minX: 0, minY: 0, maxX: 600_000, maxY: 400_000 }
    const { rejectReasons } = validateDxf(entities, wideBbox)
    expect(rejectReasons.some(r => r.includes('500 m'))).toBe(true)
  })

  test('unitScale converts mm coordinates to metres', () => {
    // Same room as residentialFloorPlan but all coordinates ×1000 (mm)
    const { entities: mEntities, bbox: mBbox } = residentialFloorPlan()
    const mmEntities: DxfEntity[] = mEntities.map(e => {
      if (e.type === 'LINE') {
        const l = e as DxfLineEntity
        return {
          ...l,
          start: { x: l.start.x * 1000, y: l.start.y * 1000 },
          end: { x: l.end.x * 1000, y: l.end.y * 1000 },
        }
      }
      if (e.type === 'LWPOLYLINE') {
        const p = e as DxfLwPolylineEntity
        return {
          ...p,
          vertices: p.vertices.map(v => ({ x: v.x * 1000, y: v.y * 1000 })),
        }
      }
      return e
    })
    const mmBbox: BBox = {
      minX: mBbox.minX * 1000,
      minY: mBbox.minY * 1000,
      maxX: mBbox.maxX * 1000,
      maxY: mBbox.maxY * 1000,
    }

    // Without unitScale → auto-infers mm from bbox size (rawMaxDim ≥ 100) → diagonal ≈ 6.8m → pass
    const withoutScale = validateDxf(mmEntities, mmBbox)
    expect(withoutScale.passed).toBe(true)

    // With explicit unitScale=0.001 → same result
    const withScale = validateDxf(mmEntities, mmBbox, { unitScale: 0.001 })
    expect(withScale.passed).toBe(true)
  })
})
