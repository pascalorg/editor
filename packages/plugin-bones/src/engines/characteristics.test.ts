import { describe, expect, test } from 'bun:test'
import { DEFAULT_SPEC } from '../core/spec'
import type { OpeningSlice, RoomSlice, SlabSlice, WallSlice } from '../core/types'
import {
  COOLING_M2_PER_TON,
  DESIGN_DELTA_T_K,
  R_IMPERIAL_TO_RSI,
  REFERENCE_UA_DENSITY,
  U_IMPERIAL_TO_SI,
  WINDOW_U_IMPERIAL,
  characteristicsCsv,
  characteristicsRows,
  computeCharacteristics,
} from './characteristics'
import { manualJLite } from './manual-j'

// ---- synthetic 8 × 5 m room, 2.5 m walls, one 1.5×1.2 window + one door ----

const wall = (
  id: string,
  start: readonly [number, number],
  end: readonly [number, number],
  openings: OpeningSlice[] = [],
): WallSlice => {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  return {
    id,
    start,
    end,
    length,
    dir: [dx / length, dz / length],
    thickness: 0.114,
    height: 2.5,
    exterior: true,
    openings,
    curved: false,
  }
}

const WINDOW: OpeningSlice = {
  id: 'win1',
  kind: 'window',
  u: 4,
  width: 1.5,
  height: 1.2,
  sillHeight: 0.9,
  roughWidth: 1.538,
  roughHeight: 1.238,
}
const DOOR: OpeningSlice = {
  id: 'door1',
  kind: 'door',
  u: 2.5,
  width: 0.9,
  height: 2.0,
  sillHeight: 0,
  roughWidth: 0.938,
  roughHeight: 2.038,
}

const WALLS: WallSlice[] = [
  wall('s', [0, 0], [8, 0], [WINDOW]),
  wall('e', [8, 0], [8, 5], [DOOR]),
  wall('n', [8, 5], [0, 5]),
  wall('w', [0, 5], [0, 0]),
]

const ROOM: RoomSlice = {
  id: 'r1',
  name: 'Great room',
  category: 'other',
  polygon: [
    [0, 0],
    [8, 0],
    [8, 5],
    [0, 5],
  ],
  boundaryWallIds: ['s', 'e', 'n', 'w'],
  ceilingHeight: 2.7,
}

describe('computeCharacteristics — geometry', () => {
  const c = computeCharacteristics(WALLS, [ROOM], [], DEFAULT_SPEC, 'FL')
  if (!c) throw new Error('expected characteristics')

  test('floor area is the exact room polygon area', () => {
    expect(c.floorAreaM2).toBeCloseTo(40, 9)
  })

  test('volume is room area × ceiling height', () => {
    expect(c.volumeM3).toBeCloseTo(40 * 2.7, 9)
  })

  test('envelope = perimeter × height minus opening areas', () => {
    // 26 m × 2.5 m = 65 − window 1.8 − door 1.8 = 61.4
    expect(c.envelopeAreaM2).toBeCloseTo(61.4, 9)
  })

  test('opening census', () => {
    expect(c.windowCount).toBe(1)
    expect(c.windowAreaM2).toBeCloseTo(1.8, 9)
    expect(c.doorCount).toBe(1)
  })
})

describe('computeCharacteristics — insulation lookup by state', () => {
  const fl = computeCharacteristics(WALLS, [ROOM], [], DEFAULT_SPEC, 'FL')
  const mn = computeCharacteristics(WALLS, [ROOM], [], DEFAULT_SPEC, 'MN')
  if (!fl || !mn) throw new Error('expected characteristics')

  test('FL (zone 2) gets R-13, MN (zone 6) gets R-30 — they differ', () => {
    expect(fl.insulation.climateZone).toBe('2A')
    expect(fl.insulation.wallR).toBe(13)
    expect(mn.insulation.climateZone).toBe('6A')
    expect(mn.insulation.wallR).toBe(30)
    expect(fl.insulation.wallR).not.toBe(mn.insulation.wallR)
  })

  test('R lookup carries its IECC citation', () => {
    expect(fl.insulation.citation).toContain('R402.1.3')
  })

  test('unknown state falls back to zone 4 with an explicit note', () => {
    const intl = computeCharacteristics(WALLS, [ROOM], [], DEFAULT_SPEC, 'INTL')
    expect(intl?.insulation.climateZone).toBe('4 (assumed)')
    expect(intl?.notes.some((n) => n.includes('Climate zone unknown'))).toBe(true)
  })

  test('batt-vs-stud-bay mismatch is flagged (R-30 batt in a 2x4 bay)', () => {
    const thin = computeCharacteristics(
      WALLS,
      [ROOM],
      [],
      { ...DEFAULT_SPEC, exteriorStudSize: '2x4' },
      'MN',
    )
    expect(thin?.notes.some((n) => n.includes('2x4'))).toBe(true)
  })
})

describe('computeCharacteristics — UA and design loads', () => {
  const c = computeCharacteristics(WALLS, [ROOM], [], DEFAULT_SPEC, 'FL')
  if (!c) throw new Error('expected characteristics')

  test('UA matches the hand computation within 1%', () => {
    // walls: 61.4 m² / (R13 × 0.1761) + windows: 1.8 m² × (0.32 × 5.678263)
    const hand = 61.4 / (13 * R_IMPERIAL_TO_RSI) + 1.8 * (WINDOW_U_IMPERIAL * U_IMPERIAL_TO_SI)
    expect(Math.abs(c.uaWPerK - hand) / hand).toBeLessThan(0.01)
    expect(c.uaWPerK).toBeCloseTo(30.091, 2)
  })

  test('design heat loss is UA × ΔT 22 K', () => {
    expect(c.designHeatLossW).toBeCloseTo(c.uaWPerK * DESIGN_DELTA_T_K, 6)
  })

  test('cooling row = the Manual-J-lite SENSIBLE load when it computes (M1401.3)', () => {
    // the SAME figure the HVAC engine sizes equipment from — one load, two
    // consumers (cross-engine coherence; the load's own hand-computed gate
    // lives in manual-j.test.ts)
    const mj = manualJLite(WALLS, [ROOM], 'FL')
    expect(mj.ok).toBe(true)
    if (!mj.ok) return
    expect(c.coolingBasis).toBe('manual-j-lite')
    expect(c.coolingTonsEstimate).toBeCloseTo(mj.loadTons, 12)
    // every load term's basis rides the notes verbatim
    for (const note of mj.notes) expect(c.notes).toContain(note)
  })

  test('cooling FALLS BACK to the rule of thumb when the zone cannot resolve — trigger stated', () => {
    const intl = computeCharacteristics(WALLS, [ROOM], [], DEFAULT_SPEC, 'INTL')
    if (!intl) throw new Error('expected characteristics')
    expect(intl.coolingBasis).toBe('rule-of-thumb')
    const base = 40 / COOLING_M2_PER_TON
    const factor = Math.min(1.2, Math.max(0.8, intl.uaWPerK / 40 / REFERENCE_UA_DENSITY))
    expect(intl.coolingTonsEstimate).toBeCloseTo(base * factor, 6)
    // INTL assumes zone 4 → R-30 walls → this tight little box clamps at −20%
    expect(factor).toBe(0.8)
    expect(
      intl.notes.some(
        (n) => n.includes('RULE OF THUMB') && n.includes('Manual J-lite unavailable'),
      ),
    ).toBe(true)
    // and the row NAMES the basis it kept
    const rows = characteristicsRows(intl)
    expect(rows.some((r) => r.metric === 'Cooling estimate (rule of thumb)')).toBe(true)
    expect(rows.some((r) => r.metric.includes('Manual J-lite'))).toBe(false)
  })

  test('every assumption is cited in notes', () => {
    const all = c.notes.join('\n')
    expect(all).toContain('R402.1.3') // wall R
    expect(all).toContain('R402.1.2') // window U
    expect(all).toContain('Manual J-lite SENSIBLE load') // cooling basis
    expect(all).toContain('verify local design conditions') // design-temp caveat
    expect(all).toContain(`ΔT = ${DESIGN_DELTA_T_K} K`) // heat loss
    expect(all).toContain('infiltration excluded') // UA row scope
  })
})

describe('computeCharacteristics — fallbacks', () => {
  test('no rooms → floor area from slab polygons minus holes', () => {
    const slab: SlabSlice = {
      id: 'slab1',
      polygon: [
        [0, 0],
        [8, 0],
        [8, 5],
        [0, 5],
      ],
      holes: [
        [
          [1, 1],
          [3, 1],
          [3, 2],
          [1, 2],
        ],
      ],
      elevation: 0,
      thickness: 0.1,
    }
    const c = computeCharacteristics(WALLS, [], [slab], DEFAULT_SPEC, 'FL')
    expect(c?.floorAreaM2).toBeCloseTo(40 - 2, 9)
    expect(c?.notes.some((n) => n.includes('slab outlines'))).toBe(true)
    // volume estimated from wall height (2.5 m), and says so
    expect(c?.volumeM3).toBeCloseTo(38 * 2.5, 9)
    expect(c?.notes.some((n) => n.includes('Volume estimated'))).toBe(true)
  })

  test('nothing to measure → null', () => {
    expect(computeCharacteristics([], [], [], DEFAULT_SPEC, 'FL')).toBeNull()
  })
})

describe('characteristicsRows — slab-less n/a (round-3 scorecard C5)', () => {
  test('zero floor area prints n/a for the area-derived metrics, numbers elsewhere', () => {
    const c = computeCharacteristics(WALLS, [ROOM], [], DEFAULT_SPEC, 'FL')
    if (!c) throw new Error('expected characteristics')
    const zero = { ...c, floorAreaM2: 0, volumeM3: 0, coolingTonsEstimate: 0 }
    const rows = characteristicsRows(zero)
    const val = (metric: string) => rows.find((r) => r.metric === metric)?.value
    const NA = 'n/a — no floor slabs (see flags)'
    expect(val('Floor area')).toBe(NA)
    expect(val('Volume')).toBe(NA)
    // the spread keeps c's Manual-J-lite basis — the n/a row names IT
    expect(val('Cooling load (Manual J-lite)')).toBe(NA)
    // envelope metrics keep their numbers; the pinned 11-row order holds
    expect(val('Envelope area (net)')).toBe('61.4')
    expect(val('Envelope UA')).toBe('30.1')
    expect(rows).toHaveLength(11)
    // no zero ever leaks into the drawer for those metrics
    expect(rows.some((r) => r.value === '0.0')).toBe(false)
  })
})

describe('characteristics CSV — pinned shape', () => {
  const c = computeCharacteristics(WALLS, [ROOM], [], DEFAULT_SPEC, 'FL')
  if (!c) throw new Error('expected characteristics')

  test('one row per metric, metric,value,unit header, notes appended', () => {
    const csv = characteristicsCsv(c)
    const lines = csv.split('\n')
    expect(lines[0]).toBe('metric,value,unit')
    expect(lines).toContain('Floor area,40.0,m2')
    expect(lines).toContain('Volume,108.0,m3')
    expect(lines).toContain('Envelope area (net),61.4,m2')
    expect(lines).toContain('Windows,1,count')
    expect(lines).toContain('Window area,1.8,m2')
    expect(lines).toContain('Doors,1,count')
    expect(lines).toContain('Climate zone,2A,IECC')
    expect(lines).toContain('Wall insulation,R-13,ft2·F·h/BTU')
    expect(lines).toContain('Envelope UA,30.1,W/K')
    expect(lines).toContain('Design heat loss (dT 22K),662,W')
    const mj = manualJLite(WALLS, [ROOM], 'FL')
    if (!mj.ok) throw new Error('expected load')
    // the row VALUE shows sensible + allowance + total (skeptic F1)
    expect(lines).toContain(
      `Cooling load (Manual J-lite),${mj.loadTons.toFixed(2)} (${mj.sensibleTons.toFixed(2)} sensible × 1.25 latent A),tons`,
    )
    // notes ride along as Note rows (csv-escaped)
    expect(csv).toContain('Note,')
    // 11 metric rows exactly, in this order
    expect(characteristicsRows(c).map((r) => r.metric)).toEqual([
      'Floor area',
      'Volume',
      'Envelope area (net)',
      'Windows',
      'Window area',
      'Doors',
      'Climate zone',
      'Wall insulation',
      'Envelope UA',
      'Design heat loss (dT 22K)',
      'Cooling load (Manual J-lite)',
    ])
  })
})
