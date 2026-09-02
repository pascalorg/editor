import { describe, expect, test } from 'bun:test'
import { DEFAULT_SPEC } from '../core/spec'
import type { RoomSlice, WallSlice } from '../core/types'
import { exteriorSide, layoutWallLayers, type WallLayerOverride } from './wall-layers'

const spec400 = { ...DEFAULT_SPEC, detail: '400' as const }

function wall(overrides: Partial<WallSlice> = {}): WallSlice {
  const start = overrides.start ?? [0, 0]
  const end = overrides.end ?? [6, 0]
  const dx = (end[0] ?? 0) - (start[0] ?? 0)
  const dz = (end[1] ?? 0) - (start[1] ?? 0)
  const length = Math.hypot(dx, dz)
  return {
    id: 'wall_L',
    start,
    end,
    dir: [dx / length, dz / length],
    length,
    thickness: 0.114,
    height: 2.44,
    exterior: true,
    openings: [],
    curved: false,
    ...overrides,
  }
}

/** Room ABOVE the default wall (z ∈ [0, 4]) — interior is side +1. */
const roomAbove: RoomSlice = {
  id: 'room_a',
  name: 'living',
  category: 'other',
  polygon: [
    [0, 0],
    [6, 0],
    [6, 4],
    [0, 4],
  ],
  boundaryWallIds: ['wall_L'],
  ceilingHeight: 2.7,
}

describe('exteriorSide', () => {
  test('FLOORING decides without any rooms: slab on +1 side → exterior −1', () => {
    // Round-13 user feedback: inside has flooring, outside does not — works
    // on blank-canvas scenes before zones exist.
    const slab = {
      id: 'slab_1',
      polygon: [[0, 0], [6, 0], [6, 4], [0, 4]] as [number, number][],
      holes: [],
      elevation: 0,
      thickness: 0.2,
    }
    expect(exteriorSide(wall(), [], [slab])).toBe(-1)
    // slab overrides an ambiguous / missing room signal
    expect(exteriorSide(wall(), [roomAbove], [slab])).toBe(-1)
  })

  test('room on +1 side → exterior faces −1; interior walls → null', () => {
    expect(exteriorSide(wall(), [roomAbove])).toBe(-1)
    expect(exteriorSide(wall({ exterior: false }), [roomAbove])).toBe(null)
    // rooms on both sides → ambiguous → null
    const roomBelow: RoomSlice = { ...roomAbove, id: 'room_b', polygon: [[0, -4], [6, -4], [6, 0], [0, 0]] }
    expect(exteriorSide(wall(), [roomAbove, roomBelow])).toBe(null)
  })
})

describe('layoutWallLayers', () => {
  test('interior partition: gypsum on BOTH faces, half inch, nothing else', () => {
    const layers = layoutWallLayers([wall({ exterior: false })], [roomAbove], spec400, 'NY')
    const drywall = layers.filter((m) => m.role === 'drywall')
    expect(drywall.length).toBe(2)
    expect(layers.filter((m) => m.role === 'sheathing')).toHaveLength(0)
    expect(layers.filter((m) => m.role === 'wrb')).toHaveLength(0)
    expect(layers.filter((m) => m.role === 'cladding')).toHaveLength(0)
    for (const d of drywall) {
      expect(d.dims[2]).toBeCloseTo(0.0127, 4) // 1/2"
      // Stacks start at the STUD face (2x4 depth 3.5in), so the gypsum sits
      // INSIDE the drawn envelope — its outer face flush-ish with the drawn
      // wall face instead of fattening it (round-14).
      // 0.114m wall ≥ thick threshold → 2x6 studs (0.1397) clamped to the
      // envelope minus 1": origin (0.114−0.0254)/2, gypsum centered outside.
      expect(Math.abs(d.position[2] as number)).toBeCloseTo((0.114 - 0.0254) / 2 + 0.0127 / 2, 5)
      expect(d.face).toBeDefined()
      expect(d.label).toContain('R702')
    }
    // opposite faces
    const zs = drywall.map((d) => d.position[2] as number)
    expect(Math.sign(zs[0] as number)).not.toBe(Math.sign(zs[1] as number))
  })

  test('exterior wall (NY→vinyl): gypsum inside; sheathing→WRB→cladding outside, stacked outward', () => {
    const layers = layoutWallLayers([wall()], [roomAbove], spec400, 'NY')
    const bySide = (side: number) => layers.filter((m) => Math.sign(m.position[2] as number) === side)
    // interior face (+1, toward the room): gypsum only
    const inside = bySide(1)
    expect(inside.every((m) => m.role === 'drywall')).toBe(true)
    // exterior face (−1): sheathing then wrb then cladding, increasing offset
    const outside = bySide(-1)
    const roleOrder = ['sheathing', 'wrb', 'cladding']
    for (const role of roleOrder) {
      expect(outside.some((m) => m.role === role)).toBe(true)
    }
    const offsetOf = (role: string) =>
      Math.abs(
        (outside.find((m) => m.role === role)?.position[2] as number) ?? 0,
      )
    expect(offsetOf('sheathing')).toBeLessThan(offsetOf('wrb'))
    expect(offsetOf('wrb')).toBeLessThan(offsetOf('cladding'))
    // sheathing is the researched 7/16" WSP
    const sheathing = outside.find((m) => m.role === 'sheathing')
    expect(sheathing?.dims[2]).toBeCloseTo(0.4375 * 0.0254, 5)
    expect(sheathing?.label).toContain('R602.3(3)')
    // WRB cites R703.2; climate note rides the stack labels
    expect(outside.find((m) => m.role === 'wrb')?.label).toContain('R703.2')
    // exterior members carry the outward face normal (−1 side → [0, −1])
    for (const m of outside) expect(m.face?.[1]).toBeCloseTo(-1, 6)
  })

  test('FL defaults to stucco with a DOUBLED WRB (R703.7.3)', () => {
    const layers = layoutWallLayers([wall()], [roomAbove], spec400, 'FL')
    const wrbs = layers.filter((m) => m.role === 'wrb')
    expect(wrbs).toHaveLength(2)
    const cladding = layers.find((m) => m.role === 'cladding')
    // FL stucco = 3-coat cement plaster (ASTM C926), 7/8" thick
    expect(cladding?.label?.toLowerCase()).toContain('cement plaster')
    expect(cladding?.dims[2]).toBeCloseTo(0.875 * 0.0254, 5)
  })

  test('openings punch through every layer (band segments, none inside the RO)', () => {
    const w = wall({
      openings: [
        {
          id: 'win_1',
          kind: 'window',
          u: 3,
          width: 1.2,
          roughWidth: 1.25,
          height: 1.2,
          roughHeight: 1.25,
          sillHeight: 0.9,
        },
      ],
    })
    const layers = layoutWallLayers([w], [roomAbove], spec400, 'NY')
    // no layer box's u-extent+y-extent sits inside the RO interior
    for (const m of layers) {
      const u = m.position[0] as number
      const y = m.position[1] as number
      const halfLen = m.dims[0] / 2
      const halfH = m.dims[1] / 2
      const insideU = u - halfLen > 3 - 1.25 / 2 + 0.001 && u + halfLen < 3 + 1.25 / 2 - 0.001
      const insideY = y - halfH > 0.9 + 0.001 && y + halfH < 0.9 + 1.25 - 0.001
      expect(insideU && insideY).toBe(false)
    }
    // under-sill and over-header bands exist
    expect(layers.some((m) => (m.position[1] as number) < 0.5)).toBe(true)
    expect(layers.some((m) => (m.position[1] as number) > 2.2)).toBe(true)
  })

  test('LOD 200 emits no layers', () => {
    expect(layoutWallLayers([wall()], [roomAbove], { ...DEFAULT_SPEC, detail: '200' }, 'NY')).toEqual([])
  })
})

/**
 * GATE (full wall engineering panel — cladding plumb-through): a per-wall
 * cladding override swaps THAT wall's finish family (incl. the stucco
 * double-WRB rule), other walls keep the state default, and an override-less
 * call stays byte-equal to today.
 */
describe('layoutWallLayers — per-wall cladding override', () => {
  test('stucco override on one wall: cement plaster + doubled WRB there only', () => {
    const wallB = wall({ id: 'wall_B', start: [0, 8], end: [6, 8] })
    const roomB: RoomSlice = { ...roomAbove, id: 'room_b2', polygon: [[0, 8], [6, 8], [6, 12], [0, 12]], boundaryWallIds: ['wall_B'] }
    const layers = layoutWallLayers(
      [wall(), wallB],
      [roomAbove, roomB],
      spec400,
      'NY',
      [],
      new Map([['wall_B', { cladding: 'stucco' }]]),
    )
    const of = (id: string, role: string) => layers.filter((m) => m.sourceId === id && m.role === role)
    // overridden wall: stucco cladding, TWO wrb layers (R703.7.3)
    expect(of('wall_B', 'cladding')[0]?.label?.toLowerCase()).toContain('cement plaster')
    expect(of('wall_B', 'wrb')).toHaveLength(2)
    // untouched wall keeps the NY default (vinyl) and a single WRB
    expect(of('wall_L', 'cladding')[0]?.label?.toLowerCase()).toContain('vinyl')
    expect(of('wall_L', 'wrb')).toHaveLength(1)
  })

  test('unknown cladding key falls back to the state default', () => {
    const layers = layoutWallLayers(
      [wall()],
      [roomAbove],
      spec400,
      'NY',
      [],
      new Map([['wall_L', { cladding: 'chrome' }]]),
    )
    expect(layers.find((m) => m.role === 'cladding')?.label?.toLowerCase()).toContain('vinyl')
  })

  test('empty/fieldless override map stays byte-equal to the default call', () => {
    const base = layoutWallLayers([wall()], [roomAbove], spec400, 'NY')
    expect(layoutWallLayers([wall()], [roomAbove], spec400, 'NY', [], new Map())).toEqual(base)
    expect(
      layoutWallLayers([wall()], [roomAbove], spec400, 'NY', [], new Map([['wall_L', {}]])),
    ).toEqual(base)
  })
})

/**
 * GATE (full wall engineering panel — insulation batts): insulation ≠ 'none'
 * fills the stud bays with role-'insulation' members labeled type + R +
 * zone ('batt R-30 (zone 5A)' for NY); batts live BETWEEN the studs the
 * framing emits (never across one), clear opening frames, cap their depth
 * at the stud bay, and 'none'/absent emits nothing (defaults byte-equal).
 */
describe('layoutWallLayers — insulation batts', () => {
  const battMap = (o: WallLayerOverride = {}) =>
    new Map<string, WallLayerOverride>([['wall_L', { insulation: 'batt', ...o }]])

  test("absent by default; explicit 'none' also emits nothing", () => {
    expect(
      layoutWallLayers([wall()], [roomAbove], spec400, 'NY').filter((m) => m.role === 'insulation'),
    ).toHaveLength(0)
    expect(
      layoutWallLayers(
        [wall()],
        [roomAbove],
        spec400,
        'NY',
        [],
        new Map([['wall_L', { insulation: 'none' as const }]]),
      ).filter((m) => m.role === 'insulation'),
    ).toHaveLength(0)
  })

  test('batt override fills the bays, labeled with type + code-min R + zone', () => {
    const layers = layoutWallLayers([wall()], [roomAbove], spec400, 'NY', [], battMap())
    const batts = layers.filter((m) => m.role === 'insulation')
    expect(batts.length).toBeGreaterThan(5) // one per clear bay on a 6m wall
    // NY primary zone 5A → prescriptive R-30 (2021 IECC); the 5.5" zone
    // batt in a 2x4 bay is a real 2" squeeze — flagged, label stays clean.
    for (const b of batts) expect(b.label).toBe('batt R-30 (zone 5A)')
    for (const b of batts) expect(b.flag).toContain('compressed')
    // depth caps at the stud bay (0.114m wall → 2x4 bay, 3.5")
    for (const b of batts) expect(b.dims[2]).toBeLessThanOrEqual(3.5 * 0.0254 + 1e-9)
    // system/sourceId ride like every other wall member
    for (const b of batts) {
      expect(b.system).toBe('wall-framing')
      expect(b.sourceId).toBe('wall_L')
    }
  })

  test('insulationR override re-labels; blown/spray-foam name their type', () => {
    const r15 = layoutWallLayers(
      [wall()],
      [roomAbove],
      spec400,
      'NY',
      [],
      battMap({ insulationR: 15 }),
    ).find((m) => m.role === 'insulation')
    expect(r15?.label).toBe('batt R-15 (zone 5A)')
    const foam = layoutWallLayers(
      [wall()],
      [roomAbove],
      spec400,
      'NY',
      [],
      new Map([['wall_L', { insulation: 'spray-foam' as const }]]),
    ).find((m) => m.role === 'insulation')
    expect(foam?.label).toBe('spray-foam R-30 (zone 5A)')
  })

  test('batts sit BETWEEN studs and clear the opening frame', () => {
    const w = wall({
      openings: [
        {
          id: 'win_1',
          kind: 'window',
          u: 3,
          width: 1.2,
          roughWidth: 1.25,
          height: 1.2,
          roughHeight: 1.25,
          sillHeight: 0.9,
        },
      ],
    })
    const layers = layoutWallLayers([w], [roomAbove], spec400, 'NY', [], battMap())
    const batts = layers.filter((m) => m.role === 'insulation')
    expect(batts.length).toBeGreaterThan(0)
    // no batt reaches into the opening-frame span (RO + trimmers + kings)
    const t = 1.5 * 0.0254
    const frameLo = 3 - 1.25 / 2 - 2 * t
    const frameHi = 3 + 1.25 / 2 + 2 * t
    for (const b of batts) {
      const lo = (b.position[0] as number) - b.dims[0] / 2
      const hi = (b.position[0] as number) + b.dims[0] / 2
      expect(lo >= frameHi - 1e-6 || hi <= frameLo + 1e-6).toBe(true)
    }
    // batts never span an o.c. grid stud: each fits inside one 16" bay
    for (const b of batts) expect(b.dims[0]).toBeLessThanOrEqual(16 * 0.0254 - t + 1e-6)
  })

  test('interior partitions take sound batts too (per-wall ask)', () => {
    const layers = layoutWallLayers(
      [wall({ exterior: false })],
      [roomAbove],
      spec400,
      'NY',
      [],
      battMap(),
    )
    expect(layers.some((m) => m.role === 'insulation')).toBe(true)
  })
})

describe('cladding families all emit members (verify round: brick/EIFS were bare)', () => {
  for (const fam of ['brickVeneer', 'eifs', 'stucco', 'vinyl', 'wood', 'fiberCement']) {
    test(`${fam} emits at least one cladding member`, () => {
      const overrides = new Map<string, WallLayerOverride>([['wall_L', { cladding: fam }]])
      const layers = layoutWallLayers([wall()], [roomAbove], spec400, 'NY', [], overrides)
      expect(layers.some((m) => m.role === 'cladding')).toBe(true)
    })
  }
})

describe('INTL fallback parity (verify S6: hint said R-30, members said R-13)', () => {
  test('zone-less jurisdictions label batts with the SAME assumed-zone-4 R as the panel hint', () => {
    const DATA = require('../../data/wall-assemblies.json')
    const zone4R = Number.parseInt(
      (DATA.exterior.insulationByClimateZone['4'].value as string).replace(/^R/i, ''),
      10,
    )
    const overrides = new Map<string, WallLayerOverride>([
      ['wall_L', { insulation: 'batt' }],
    ])
    const layers = layoutWallLayers([wall()], [roomAbove], spec400, 'INTL', [], overrides)
    const batts = layers.filter((m) => m.role === 'insulation')
    expect(batts.length).toBeGreaterThan(0)
    for (const b of batts) {
      expect(b.label).toContain(`R-${zone4R}`)
    }
  })
})

describe('climate-zone labels live (LOD-400 B4 rider: the raw-value zone lookup was dead)', () => {
  // stateClimateZone values are labels ('6A', '3A (2A coast)') while the
  // insulation/vapor maps are keyed '1'..'8'/'4M' — before the normalized
  // lookup, cavity-R and vapor-retarder labels appeared in ZERO of the 51
  // jurisdictions (scratch-verified across CT/TX/VT/FL/CA/NY/WA/AK).
  test('VT (zone 6A): sheathing carries the cavity-R note, gypsum the vapor class', () => {
    const layers = layoutWallLayers([wall()], [roomAbove], spec400, 'VT')
    const sheathing = layers.filter((m) => m.role === 'sheathing')
    expect(sheathing.length).toBeGreaterThan(0)
    for (const s of sheathing) expect(s.label).toContain('cavity R30 (zone 6A)')
    const gypsum = layers.filter((m) => m.role === 'drywall')
    expect(gypsum.length).toBeGreaterThan(0)
    for (const g of gypsum) expect(g.label).toContain('vapor retarder Class I or II, R702.7')
    // the note rides the INNERMOST rendered layer only — WRB/cladding labels
    // (and the takeoff items split off them) stay clean
    for (const m of layers.filter((m) => m.role === 'cladding' || m.role === 'wrb')) {
      expect(m.label).not.toContain('cavity')
    }
  })

  test('WA (marine 4C) resolves the 4M data row, labeled with its own 4C tag', () => {
    const layers = layoutWallLayers([wall()], [roomAbove], spec400, 'WA')
    expect(layers.find((m) => m.role === 'sheathing')?.label).toContain('cavity R30 (zone 4C)')
    expect(layers.find((m) => m.role === 'drywall')?.label).toContain(
      'vapor retarder Class I or II',
    )
  })

  test('TX (zone 2A): warm-zone truth — R13 cavity, vapor retarder none', () => {
    const layers = layoutWallLayers([wall()], [roomAbove], spec400, 'TX')
    expect(layers.find((m) => m.role === 'sheathing')?.label).toContain('cavity R13 (zone 2A)')
    expect(layers.find((m) => m.role === 'drywall')?.label).toContain('vapor retarder none')
  })

  test('INTL (no zone data) stays unlabeled — the zone-less fallback is byte-equal', () => {
    const layers = layoutWallLayers([wall()], [roomAbove], spec400, 'INTL')
    expect(layers.some((m) => m.label?.includes('cavity'))).toBe(false)
    expect(layers.some((m) => m.label?.includes('vapor retarder'))).toBe(false)
  })

  test('interior partitions never carry climate notes (gypsum both faces, plain)', () => {
    const layers = layoutWallLayers([wall({ exterior: false })], [roomAbove], spec400, 'VT')
    expect(layers.some((m) => m.label?.includes('cavity'))).toBe(false)
    expect(layers.some((m) => m.label?.includes('vapor retarder'))).toBe(false)
  })

  // CANADA (2026-08-24, PR #1 adoption): the contributor's found-bug note
  // was exactly this dead-key class — the CA-* rows must never re-open it.
  test('every stateClimateZone entry (67 rows incl. CA-*) parses AND resolves a live insulation row', () => {
    const data = require('../../data/wall-assemblies.json') as {
      exterior: {
        stateClimateZone: Record<string, string>
        insulationByClimateZone: Record<string, { value?: string }>
      }
    }
    const insul = data.exterior.insulationByClimateZone
    for (const [code, raw] of Object.entries(data.exterior.stateClimateZone)) {
      const m = /^(\d)([ABC])?/.exec(raw.trim())
      expect(m, `${code}: '${raw}' must parse`).not.toBeNull()
      const key = m?.[1] === '4' && m?.[2] === 'C' ? '4M' : (m?.[1] as string)
      expect(insul[key]?.value, `${code}: zone key '${key}' must be live`).toBeDefined()
    }
  })

  test('CA-SK (zone 7) and CA-BC (4C → the 4M marine row) label live through the layer engine', () => {
    const sk = layoutWallLayers([wall()], [roomAbove], spec400, 'CA-SK')
    expect(sk.find((m) => m.role === 'sheathing')?.label).toContain('cavity R30 (zone 7)')
    const bc = layoutWallLayers([wall()], [roomAbove], spec400, 'CA-BC')
    expect(bc.find((m) => m.role === 'sheathing')?.label).toContain('cavity R30 (zone 4C)')
    // NBC 9.25 requires a warm-side vapour barrier throughout Canada —
    // stricter than the IECC-equivalent class these approximate zones imply
    // (documented in wall-assemblies.json stateClimateZoneCitation); the
    // IRC-cited label below is generic practice, confessed by the compute
    // -level non-IRC warning (canada.test.ts).
    expect(sk.find((m) => m.role === 'drywall')?.label).toContain('vapor retarder Class I or II')
  })
})

describe('brick veneer air gap occupies space (verify S9: collapsed airspace)', () => {
  test('the wythe sits a full 1" gap beyond the WRB face', () => {
    const overrides = new Map<string, WallLayerOverride>([
      ['wall_L', { cladding: 'brickVeneer' }],
    ])
    const layers = layoutWallLayers([wall()], [roomAbove], spec400, 'NY', [], overrides)
    const wrb = layers.find((m) => m.role === 'wrb')
    const veneer = layers.find((m) => m.role === 'cladding')
    expect(wrb).toBeDefined()
    expect(veneer).toBeDefined()
    // distance between member centers along the wall normal = half the WRB +
    // the FULL 1" airspace + half the wythe
    const gap =
      Math.abs((veneer?.position[2] as number) - (wrb?.position[2] as number)) -
      ((wrb?.dims[2] as number) + (veneer?.dims[2] as number)) / 2
    expect(gap).toBeCloseTo(0.0254, 3)
  })
})
