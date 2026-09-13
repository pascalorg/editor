import { describe, expect, test } from 'bun:test'
import type { Fixture, FixtureKind, Member } from '../core/types'
import { feet } from '../core/units'
import type { LumberSize } from '../lumber'
import { DEFAULT_SPEC } from '../core/spec'
import type { WallSlice } from '../core/types'
import { buildFoundation } from './foundation'
import { frameWall, frameWalls } from './wall-framing'
import { computeTakeoff, takeoffCsv, takeoffMarkdown, type TakeoffRow } from './takeoff'

// ---------------------------------------------------------------------------
// Synthetic builders — the takeoff only reads size/length/material/role/
// label/flag/dims, so geometry fields can stay trivial.
// ---------------------------------------------------------------------------

function mem(overrides: Partial<Member> & { length?: number } = {}): Member {
  return {
    system: 'wall-framing',
    role: 'stud',
    size: '2x4',
    dims: [0.038, 2.4, 0.089],
    length: 2.4,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    material: 'lumber',
    sourceId: 'wall_1',
    ...overrides,
  }
}

function lumber(size: LumberSize, lengthM: number, overrides: Partial<Member> = {}): Member {
  return mem({ size, length: lengthM, ...overrides })
}

function concrete(dims: [number, number, number], overrides: Partial<Member> = {}): Member {
  return mem({
    system: 'foundation',
    role: 'footing',
    size: undefined,
    material: 'concrete',
    dims,
    length: dims[0],
    ...overrides,
  })
}

function fixture(kind: FixtureKind, overrides: Partial<Fixture> = {}): Fixture {
  return {
    system: 'electrical',
    kind,
    position: [0, 0.3, 0],
    rotationY: 0,
    sourceId: 'wall_1',
    ...overrides,
  }
}

const find = (rows: TakeoffRow[], item: string, detail?: string): TakeoffRow | undefined =>
  rows.find((r) => r.item === item && (detail === undefined || r.detail === detail))

// ---------------------------------------------------------------------------
// Lumber: stock rounding
// ---------------------------------------------------------------------------

describe('lumber stock rounding', () => {
  test('2.5 m stud (8.2 ft) rounds UP to 10 ft stock, not 8', () => {
    const rows = computeTakeoff([lumber('2x4', 2.5)], [])
    // B21e: the quantity stays the exact member-derived count; the stated
    // +5% cull/damage order figure prints in the detail, never the column.
    expect(find(rows, '2x4', '10 ft stock — +5% waste ≈ 2 pcs')).toEqual({
      section: 'Wall framing',
      item: '2x4',
      detail: '10 ft stock — +5% waste ≈ 2 pcs',
      quantity: 1,
      unit: 'pcs',
    })
    expect(rows.some((r) => r.item === '2x4' && r.detail.startsWith('8 ft stock'))).toBe(false)
  })

  test('an exactly-8-ft cut buys 8 ft stock (no float creep to 10)', () => {
    const rows = computeTakeoff([lumber('2x4', feet(8))], [])
    expect(find(rows, '2x4', '8 ft stock — +5% waste ≈ 2 pcs')?.quantity).toBe(1)
  })

  test('an exactly-20-ft cut buys one 20 ft stick, no splice', () => {
    const rows = computeTakeoff([lumber('2x12', feet(20))], [])
    expect(find(rows, '2x12', '20 ft stock — +5% waste ≈ 2 pcs')?.quantity).toBe(1)
    expect(rows.some((r) => r.detail.includes('splice'))).toBe(false)
  })

  test('a 22-ft girder exceeds stock: two 20-ft sticks, detail notes field splice', () => {
    const rows = computeTakeoff([lumber('2x12', feet(22), { role: 'girder' })], [])
    const splice = rows.find((r) => r.item === '2x12' && r.detail.includes('field splice'))
    expect(splice).toBeDefined()
    expect(splice?.detail).toContain('20 ft stock')
    expect(splice?.quantity).toBe(2)
    expect(splice?.unit).toBe('pcs')
  })

  test('an ENGINEERED wall header books by supplier, never as dimensional sticks', () => {
    // Verify night-6: an over-span header booked 'Wall framing | 4x12 |
    // 12 ft stock + 48 bd-ft' for a stick the flag itself says to replace.
    const rows = computeTakeoff(
      [lumber('4x12', 3.4, { role: 'header', material: 'engineered' })],
      [],
    )
    expect(rows.some((r) => r.section === 'Wall framing' && r.item === '4x12')).toBe(false)
    const sku = find(rows, 'Engineered header (LVL/PSL — by supplier)')
    expect(sku?.quantity).toBe(1)
    expect(sku?.unit).toBe('pcs')
    const lf = rows.find(
      (r) => r.item === 'Engineered header (LVL/PSL — by supplier)' && r.unit === 'lf',
    )
    expect(lf?.quantity).toBeCloseTo(11.2, 1) // 3.4 m ≈ 11.2 lineal ft
    // …but a floor girder tagged 'engineered' KEEPS its dimensional rows —
    // it is drawn at full size (booked == built, verify note on the member)
    const girderRows = computeTakeoff(
      [lumber('4x10', 4, { system: 'floor-framing', role: 'girder', material: 'engineered' })],
      [],
    )
    expect(girderRows.some((r) => r.item === '4x10' && r.unit === 'pcs')).toBe(true)
  })

  test('same size groups across stock lengths; different lengths stay separate rows', () => {
    const rows = computeTakeoff(
      [
        lumber('2x4', 2.3), // 7.5 ft → 8 ft
        lumber('2x4', 2.3), // 7.5 ft → 8 ft
        lumber('2x4', 2.3), // 7.5 ft → 8 ft
        lumber('2x4', 4.0, { role: 'top-plate' }), // 13.1 ft → 14 ft
        lumber('2x4', 4.0, { role: 'bottom-plate' }), // 13.1 ft → 14 ft
      ],
      [],
    )
    expect(find(rows, '2x4', '8 ft stock — +5% waste ≈ 4 pcs')?.quantity).toBe(3)
    expect(find(rows, '2x4', '14 ft stock — +5% waste ≈ 3 pcs')?.quantity).toBe(2)
  })

  test('every stock boundary rounds up correctly', () => {
    const cuts: Array<[number, string]> = [
      [feet(8.01), '10 ft stock'],
      [feet(10.01), '12 ft stock'],
      [feet(12.01), '14 ft stock'],
      [feet(14.01), '16 ft stock'],
      [feet(16.01), '20 ft stock'],
    ]
    for (const [len, expected] of cuts) {
      const rows = computeTakeoff([lumber('2x6', len)], [])
      expect(find(rows, '2x6', `${expected} — +5% waste ≈ 2 pcs`)?.quantity).toBe(1)
    }
  })
})

// ---------------------------------------------------------------------------
// Lumber: board feet (NOMINAL inches on the PURCHASED stick)
// ---------------------------------------------------------------------------

describe('board feet', () => {
  test('2x6 stud at 8 ft stock: 2·6/12 × 8 = 8 bd-ft exactly', () => {
    const rows = computeTakeoff([lumber('2x6', 2.4)], []) // 7.87 ft → 8 ft stock
    expect(find(rows, '2x6', 'board feet')).toEqual({
      section: 'Wall framing',
      item: '2x6',
      detail: 'board feet',
      quantity: 8,
      unit: 'bd-ft',
    })
  })

  test('three 2x4 at 10 ft stock: 3 × (2·4/12) × 10 = 20 bd-ft', () => {
    const studs = [lumber('2x4', 2.5), lumber('2x4', 2.5), lumber('2x4', 2.5)]
    const rows = computeTakeoff(studs, [])
    expect(find(rows, '2x4', 'board feet')?.quantity).toBe(20)
  })

  test('4x10 header at 12 ft stock: 4·10/12 × 12 = 40 bd-ft (nominal, not dressed)', () => {
    const rows = computeTakeoff([lumber('4x10', feet(11), { role: 'header' })], [])
    expect(find(rows, '4x10', 'board feet')?.quantity).toBe(40)
  })

  test('spliced runs bill both purchased sticks: 22 ft 2x12 → 2 × 20 ft = 80 bd-ft', () => {
    const rows = computeTakeoff([lumber('2x12', feet(22))], [])
    // 2 sticks × 20 ft × (2·12/12 = 2 bd-ft/ft) = 80
    expect(find(rows, '2x12', 'board feet')?.quantity).toBe(80)
  })

  test('mixed stock lengths accumulate into one bd-ft row per size', () => {
    const rows = computeTakeoff([lumber('2x4', 2.3), lumber('2x4', 2.5)], []) // 8 ft + 10 ft
    // (2·4/12) × (8 + 10) = 12 bd-ft
    expect(find(rows, '2x4', 'board feet')?.quantity).toBe(12)
    expect(rows.filter((r) => r.item === '2x4' && r.detail === 'board feet')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Lumber: ordering + filtering
// ---------------------------------------------------------------------------

describe('lumber row ordering', () => {
  test('sizes order 2x4 → 2x6 → 4x8 regardless of member order', () => {
    const rows = computeTakeoff(
      [lumber('4x8', 1.2, { role: 'header' }), lumber('2x4', 2.4), lumber('2x6', 2.4)],
      [],
    )
    const sizeOrder = rows.filter((r) => r.detail === 'board feet').map((r) => r.item)
    expect(sizeOrder).toEqual(['2x4', '2x6', '4x8'])
  })

  test('within a size: stock rows ascend, board-feet row comes last', () => {
    const rows = computeTakeoff([lumber('2x4', 2.5), lumber('2x4', 2.3)], []).filter(
      (r) => r.item === '2x4',
    )
    expect(rows.map((r) => r.detail)).toEqual([
      '8 ft stock — +5% waste ≈ 2 pcs',
      '10 ft stock — +5% waste ≈ 2 pcs',
      'board feet',
    ])
  })

  test('pressure-treated mudsills count as lumber ON THEIR OWN PT row; steel and concrete never do', () => {
    const rows = computeTakeoff(
      [
        lumber('2x6', 2.3, { material: 'pt-lumber', role: 'mudsill', system: 'foundation' }),
        mem({ material: 'steel', role: 'anchor-bolt', size: undefined, length: 0.25 }),
        concrete([1, 0.3, 0.4]),
      ],
      [],
    )
    // PT is a different SKU — never blended into the untreated count.
    expect(
      find(rows, '2x6 PT', '8 ft stock (pressure-treated) — +5% waste ≈ 2 pcs')?.quantity,
    ).toBe(1)
    expect(rows.some((r) => r.item === '2x6' && r.detail.startsWith('8 ft stock'))).toBe(false)
    // exactly one lumber size section (one board-feet row)
    expect(rows.filter((r) => r.detail === 'board feet')).toHaveLength(1)
  })

  test('PT and untreated sticks of one size book side by side, PT after untreated', () => {
    const rows = computeTakeoff(
      [
        lumber('2x6', 2.3),
        lumber('2x6', 2.3, { material: 'pt-lumber', role: 'mudsill' }),
      ],
      [],
    )
    expect(find(rows, '2x6', '8 ft stock — +5% waste ≈ 2 pcs')?.quantity).toBe(1)
    expect(
      find(rows, '2x6 PT', '8 ft stock (pressure-treated) — +5% waste ≈ 2 pcs')?.quantity,
    ).toBe(1)
    const items = rows.filter((r) => r.detail.startsWith('8 ft stock')).map((r) => r.item)
    expect(items).toEqual(['2x6', '2x6 PT'])
    expect(rows.filter((r) => r.detail === 'board feet')).toHaveLength(2)
  })

  test('members without a nominal size are not lumber rows', () => {
    const rows = computeTakeoff([mem({ size: undefined, material: 'pvc', role: 'pipe-run' })], [])
    expect(rows.filter((r) => r.detail === 'board feet')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Concrete + CMU
// ---------------------------------------------------------------------------

describe('concrete', () => {
  test('sums member volumes and converts m³ → yd³ at 1.30795, 1 decimal', () => {
    // two footing runs of exactly 1 m³ each → 2 m³ = 2.6159 yd³ → 2.6
    const rows = computeTakeoff([concrete([2, 0.5, 1]), concrete([2, 0.5, 1])], [])
    // B21e: net pour in the quantity column, stated +5% order figure in the
    // detail — CEILED to the 0.1 yd³ ready-mix batch (r1 F1): 2 m³ =
    // 2.6159 yd³ → 2.6 net; × 1.05 = 2.7467 → 2.8 order, never 2.7.
    expect(find(rows, 'Concrete')).toEqual({
      section: 'Foundation',
      item: 'Concrete',
      detail: 'footings — +5% waste ≈ 2.8 yd³',
      quantity: 2.6,
      unit: 'yd³',
    })
  })

  test('foundation pours split by ELEMENT: footing / stemwall / slab field', () => {
    const SLAB_DETAIL = 'slab field (3-1/2" slab-on-grade, R506.1) — +5% waste ≈ 0.3 yd³'
    const rows = computeTakeoff(
      [
        concrete([2, 0.5, 1]), // footing, 1 m³
        concrete([2, 0.4, 0.5], { role: 'stemwall' }), // 0.4 m³
        concrete([2, 0.0889, 1], { role: 'slab' }), // 0.1778 m³ slab-field strip (B17)
      ],
      [],
    )
    expect(find(rows, 'Concrete', 'footings — +5% waste ≈ 1.4 yd³')?.quantity).toBeCloseTo(1.3, 5)
    // stemwall 0.5232 yd³ net → ×1.05 = 0.5493 → batch-ceil 0.6 (round1
    // would have printed 0.5 == net, a factor adding zero — r1 F1)
    expect(find(rows, 'Concrete', 'stemwalls — +5% waste ≈ 0.6 yd³')?.quantity).toBeCloseTo(0.5, 5)
    expect(find(rows, 'Concrete', SLAB_DETAIL)?.quantity).toBeCloseTo(0.2, 5)
    for (const detail of ['footings — +5% waste ≈ 1.4 yd³', 'stemwalls — +5% waste ≈ 0.6 yd³', SLAB_DETAIL]) {
      expect(find(rows, 'Concrete', detail)?.section).toBe('Foundation')
    }
  })

  test('CMU blocks are counted each and excluded from the poured yardage', () => {
    const block = concrete([0.406, 0.203, 0.203], { role: 'block' })
    const rows = computeTakeoff([block, block, block], [])
    expect(find(rows, 'CMU block')?.quantity).toBe(3)
    expect(find(rows, 'CMU block')?.unit).toBe('pcs')
    expect(find(rows, 'Concrete')).toBeUndefined() // blocks alone pour nothing
  })

  test('non-foundation pours (CMU lintels) pool per their own section', () => {
    const rows = computeTakeoff(
      [
        concrete([2, 0.5, 1]), // foundation footing
        concrete([1.2, 0.19, 0.19], { role: 'lintel', system: 'wall-framing' }),
      ],
      [],
    )
    expect(find(rows, 'Concrete', 'footings — +5% waste ≈ 1.4 yd³')?.section).toBe('Foundation')
    // sub-batch pour (net 0.1 == order 0.1): the display-collapse note
    // rides the detail — match on the stable prefix here, wording gated
    // in full in the collapse test below
    const lintelRow = rows.find(
      (r) => r.item === 'Concrete' && r.detail.startsWith('lintels/beams — +5% waste ≈ 0.1 yd³'),
    )
    expect(lintelRow?.section).toBe('Wall framing')
    expect(lintelRow?.quantity).toBe(0.1) // 0.0433 m³ floors at the 0.1 yd³ batch
  })

  test('a real but tiny pour never rounds to 0.0 yd³', () => {
    const rows = computeTakeoff([concrete([0.3, 0.19, 0.19], { role: 'lintel' })], [])
    expect(find(rows, 'Concrete')?.quantity).toBe(0.1)
  })

  test('sub-batch display collapse SAYS WHY the figures meet (B21e r2 advisory)', () => {
    // The '0.6 == buy 0.6' exhibit: 5% of a small pour is smaller than one
    // 0.1 yd³ display step, so net and ceiled order figure PRINT identically
    // and the stated factor read as adding zero. 0.4358 m³ = 0.5700 yd³ →
    // net 0.6; × 1.05 = 0.5985 → ceil 0.6 — a REAL collapse case.
    const m3 = 2 * 0.5 * 0.4358
    const net = Math.max(0.1, Math.round(m3 * 1.30795 * 10) / 10)
    const buy = Math.ceil(m3 * 1.30795 * 1.05 * 10) / 10
    expect(buy).toBe(net) // scenario reality check: both display as 0.6
    const rows = computeTakeoff([concrete([2, 0.5, 0.4358])], [])
    const row = rows.find((r) => r.item === 'Concrete')
    expect(row?.quantity).toBe(net) // zero quantity drift — wording only
    expect(row?.detail).toBe(
      'footings — +5% waste ≈ 0.6 yd³ (waste smaller than the 0.1 yd³ display step — net and order figures meet at display rounding)',
    )
    // …and a pour whose order figure clears the display step stays
    // note-free, byte-for-byte (the non-collapse direction)
    const big = computeTakeoff([concrete([2, 0.5, 1]), concrete([2, 0.5, 1])], [])
    expect(find(big, 'Concrete')?.detail).toBe('footings — +5% waste ≈ 2.8 yd³')
  })
})

describe('LOD-400 B17: slab field + vapor retarder booked == built (S4 parity)', () => {
  const makeWall = (id: string, start: [number, number], end: [number, number]): WallSlice => {
    const dx = end[0] - start[0]
    const dz = end[1] - start[1]
    const length = Math.hypot(dx, dz)
    return {
      id,
      start,
      end,
      length,
      dir: [dx / length, dz / length],
      thickness: 0.15,
      height: 2.5,
      exterior: true,
      openings: [],
      curved: false,
    }
  }
  const walls = [
    makeWall('w_s', [0, 0], [8, 0]),
    makeWall('w_e', [8, 0], [8, 5]),
    makeWall('w_n', [8, 5], [0, 5]),
    makeWall('w_w', [0, 5], [0, 0]),
  ]
  const slab = {
    id: 'slab_b17',
    polygon: [
      [0, 0],
      [8, 0],
      [8, 5],
      [0, 5],
    ],
    holes: [],
    elevation: 0.05,
    thickness: 0.1,
  }
  const members = buildFoundation(walls, [slab as never], DEFAULT_SPEC)
  const rows = computeTakeoff(members, [])
  const M3_TO_YD3 = 1.30795
  const SQFT = 1 / 0.09290304
  const round1 = (n: number) => Math.round(n * 10) / 10

  test('the slab-field yd³ row derives from the MEMBERS, exactly', () => {
    const vol = members
      .filter((m) => m.role === 'slab')
      .reduce((sum, m) => sum + m.dims[0] * m.dims[1] * m.dims[2], 0)
    expect(vol).toBeGreaterThan(0)
    const row = rows.find(
      (r) => r.item === 'Concrete' && r.detail.startsWith('slab field (3-1/2" slab-on-grade, R506.1)'),
    )
    expect(row?.section).toBe('Foundation')
    expect(row?.unit).toBe('yd³')
    // quantity = NET member volume; the stated +5% order figure prints in
    // the detail and derives from the same volume (B21e net preservation)
    expect(row?.quantity).toBe(Math.max(0.1, round1(vol * M3_TO_YD3)))
    expect(row?.detail).toBe(
      `slab field (3-1/2" slab-on-grade, R506.1) — +5% waste ≈ ${Math.ceil(vol * M3_TO_YD3 * 1.05 * 10) / 10} yd³`,
    )
  })

  test('the vapor-retarder sqft row = member plan area × the STATED +10% lap factor', () => {
    const area = members
      .filter((m) => m.role === 'vapor-retarder')
      .reduce((sum, m) => sum + m.dims[0] * m.dims[2], 0)
    expect(area).toBeGreaterThan(0)
    const row = find(rows, 'Vapor retarder 6-mil poly')
    expect(row?.section).toBe('Foundation')
    expect(row?.unit).toBe('sqft')
    expect(row?.detail).toContain('+10%')
    expect(row?.detail).toContain('R506.2.3')
    expect(row?.quantity).toBe(round1(area * 1.1 * SQFT))
    // and the membrane mirrors the slab field's plan area 1:1 (S4)
    const slabArea = members
      .filter((m) => m.role === 'slab')
      .reduce((sum, m) => sum + m.dims[0] * m.dims[2], 0)
    expect(area).toBeCloseTo(slabArea, 6)
  })

  test('footings + stemwalls rows keep their own member-derived pours, unchanged', () => {
    const volOf = (role: string) =>
      members
        .filter((m) => m.role === role)
        .reduce((sum, m) => sum + m.dims[0] * m.dims[1] * m.dims[2], 0)
    const pourRow = (prefix: string) =>
      rows.find((r) => r.item === 'Concrete' && r.detail.startsWith(prefix))
    expect(pourRow('footings')?.quantity).toBe(
      Math.max(0.1, round1(volOf('footing') * M3_TO_YD3)),
    )
    expect(pourRow('stemwalls')?.quantity).toBe(
      Math.max(0.1, round1(volOf('stemwall') * M3_TO_YD3)),
    )
  })

  test('no membrane members → no vapor row (member-derived, never assumed)', () => {
    const bare = computeTakeoff(
      members.filter((m) => m.role !== 'vapor-retarder' && m.role !== 'slab'),
      [],
    )
    expect(find(bare, 'Vapor retarder 6-mil poly')).toBeUndefined()
    expect(
      bare.some((r) => r.item === 'Concrete' && r.detail.startsWith('slab field')),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Steel hardware
// ---------------------------------------------------------------------------

describe('steel hardware', () => {
  const bolt = mem({ role: 'anchor-bolt', material: 'steel', size: undefined, length: 0.25 })
  const hd = mem({ role: 'hold-down', material: 'steel', size: undefined, length: 0.35 })
  const tie = mem({
    system: 'roof-framing',
    role: 'blocking',
    material: 'steel',
    size: undefined,
    length: 0.1,
  })

  test('anchor bolts, hold-downs, and hurricane ties (role+material+system) count each', () => {
    const rows = computeTakeoff([bolt, bolt, bolt, bolt, bolt, hd, hd, tie, tie, tie], [])
    expect(find(rows, 'Anchor bolts')?.quantity).toBe(5)
    expect(find(rows, 'Hold-downs')?.quantity).toBe(2)
    expect(find(rows, 'Hurricane ties')?.quantity).toBe(3)
    for (const item of ['Anchor bolts', 'Hold-downs', 'Hurricane ties']) {
      expect(find(rows, item)?.unit).toBe('pcs')
    }
  })

  test('anchor bolts split per system: foundation sole plate vs mixed-wall seam sill', () => {
    const foundationBolt = mem({
      system: 'foundation',
      role: 'anchor-bolt',
      material: 'steel',
      size: undefined,
      length: 0.25,
    })
    const rows = computeTakeoff([bolt, bolt, foundationBolt, foundationBolt, foundationBolt], [])
    const seam = rows.find((r) => r.item === 'Anchor bolts' && r.section === 'Wall framing')
    const solePlate = rows.find((r) => r.item === 'Anchor bolts' && r.section === 'Foundation')
    expect(seam?.quantity).toBe(2)
    expect(seam?.detail).toBe('seam sill to bond beam (R403.1.6)')
    expect(solePlate?.quantity).toBe(3)
    // LOD-400 B5 text pin: the row names the SOLE PLATE the bolts clamp —
    // no mudsill member exists on slab-on-grade (the old text was a lie).
    expect(solePlate?.detail).toBe('sole plate anchorage (R403.1.6)')
  })

  test('hardware rows are omitted when absent', () => {
    const rows = computeTakeoff([lumber('2x4', 2.4)], [])
    expect(find(rows, 'Anchor bolts')).toBeUndefined()
    expect(find(rows, 'Hold-downs')).toBeUndefined()
    expect(find(rows, 'Hurricane ties')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

describe('flags', () => {
  test('one FLAG row per distinct flag text, quantity = occurrences', () => {
    const engineered = 'ENGINEERED BEAM REQUIRED — exceeds prescriptive header span'
    const rows = computeTakeoff(
      [
        lumber('4x12', 3.2, { role: 'header', flag: engineered }),
        lumber('4x12', 3.4, { role: 'header', flag: engineered }),
        lumber('2x4', 2.4, { flag: 'Curved wall approximated' }),
      ],
      [],
    )
    const flagRows = rows.filter((r) => r.item === 'FLAG')
    expect(flagRows).toHaveLength(2)
    expect(find(rows, 'FLAG', engineered)?.quantity).toBe(2)
    expect(find(rows, 'FLAG', 'Curved wall approximated')?.quantity).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

describe('fixtures', () => {
  test('one row per kind present, counted', () => {
    const rows = computeTakeoff(
      [],
      [
        fixture('receptacle'),
        fixture('receptacle'),
        fixture('receptacle'),
        fixture('receptacle-gfci'),
        fixture('receptacle-gfci'),
        fixture('switch'),
        fixture('light'),
        fixture('light'),
        fixture('smoke-alarm'),
        fixture('register', { system: 'hvac' }),
        fixture('register', { system: 'hvac' }),
      ],
    )
    expect(find(rows, 'Receptacles')?.quantity).toBe(3)
    expect(find(rows, 'GFCI receptacles')?.quantity).toBe(2)
    expect(find(rows, 'Switches')?.quantity).toBe(1)
    expect(find(rows, 'Lights')?.quantity).toBe(2)
    expect(find(rows, 'Smoke alarms')?.quantity).toBe(1)
    expect(find(rows, 'Supply registers')?.quantity).toBe(2)
    expect(rows.every((r) => r.unit === 'pcs')).toBe(true)
  })

  test('absent kinds emit no row', () => {
    const rows = computeTakeoff([], [fixture('receptacle')])
    expect(find(rows, 'Switches')).toBeUndefined()
    // one device row + its 1-gang box row
    expect(rows).toHaveLength(2)
    expect(find(rows, 'Device boxes (1-gang)')?.quantity).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Empty input + serializers
// ---------------------------------------------------------------------------

describe('computeTakeoff — empty', () => {
  test('no members, no fixtures → no rows', () => {
    expect(computeTakeoff([], [])).toEqual([])
  })
})

describe('takeoffCsv', () => {
  test('header + plain rows serialize unquoted', () => {
    const csv = takeoffCsv([
      { section: 'Wall framing', item: '2x4', detail: '8 ft stock', quantity: 3, unit: 'pcs' },
    ])
    expect(csv).toBe('section,item,detail,quantity,unit\nWall framing,2x4,8 ft stock,3,pcs')
  })

  test('commas in detail are quoted (flag text with commas survives)', () => {
    const csv = takeoffCsv([
      {
        section: 'Flags',
        item: 'FLAG',
        detail: 'Span exceeds table, engineer required',
        quantity: 1,
        unit: 'ea',
      },
    ])
    expect(csv.split('\n')[1]).toBe('Flags,FLAG,"Span exceeds table, engineer required",1,ea')
  })

  test('double quotes inside a field are doubled per RFC 4180', () => {
    const csv = takeoffCsv([
      { section: 'Flags', item: 'FLAG', detail: 'Header over "D101", verify', quantity: 1, unit: 'ea' },
    ])
    expect(csv.split('\n')[1]).toBe('Flags,FLAG,"Header over ""D101"", verify",1,ea')
  })

  test('end-to-end: computeTakeoff rows round-trip into parseable CSV lines', () => {
    const rows = computeTakeoff([lumber('2x4', 2.5)], [fixture('receptacle')])
    const lines = takeoffCsv(rows).split('\n')
    expect(lines[0]).toBe('section,item,detail,quantity,unit')
    expect(lines).toContain('Wall framing,2x4,10 ft stock — +5% waste ≈ 2 pcs,1,pcs')
    expect(lines).toContain('Electrical,Receptacles,NEC 210.52 spacing,1,pcs')
  })
})

describe('takeoffMarkdown', () => {
  test('emits a pipe table with header, alignment row, and one line per row', () => {
    const md = takeoffMarkdown([
      { section: 'Wall framing', item: '2x4', detail: '10 ft stock', quantity: 4, unit: 'pcs' },
      { section: 'Wall framing', item: '2x4', detail: 'board feet', quantity: 26.7, unit: 'bd-ft' },
    ])
    const lines = md.split('\n')
    expect(lines[0]).toBe('| Section | Item | Detail | Quantity | Unit |')
    expect(lines[1]).toBe('| --- | --- | --- | ---: | --- |')
    expect(lines[2]).toBe('| Wall framing | 2x4 | 10 ft stock | 4 | pcs |')
    expect(lines[3]).toBe('| Wall framing | 2x4 | board feet | 26.7 | bd-ft |')
  })

  test('pipes inside detail text are escaped so the table cannot break', () => {
    const md = takeoffMarkdown([
      { section: 'Flags', item: 'FLAG', detail: 'a|b', quantity: 1, unit: 'ea' },
    ])
    expect(md.split('\n')[2]).toBe('| Flags | FLAG | a\\|b | 1 | ea |')
  })
})

// ---------------------------------------------------------------------------
// Round-1 fabrication features (sections, sheets, fasteners, MEP lf, cut list)
// ---------------------------------------------------------------------------

import { cutList, cutListCsv } from './takeoff'

describe('per-system sections', () => {
  test('every row carries a section; lumber splits by originating system', () => {
    const rows = computeTakeoff(
      [
        lumber('2x4', 2.4), // wall-framing
        lumber('2x10', 3.5, { system: 'floor-framing', role: 'joist' }),
        lumber('2x6', 4.0, { system: 'roof-framing', role: 'rafter' }),
        concrete([2, 0.5, 1]), // foundation
      ],
      [fixture('receptacle')],
    )
    for (const r of rows) expect(r.section.length).toBeGreaterThan(0)
    expect(find(rows, '2x4', 'board feet')?.section).toBe('Wall framing')
    expect(find(rows, '2x10', 'board feet')?.section).toBe('Floor')
    expect(find(rows, '2x6', 'board feet')?.section).toBe('Roof')
    expect(find(rows, 'Concrete')?.section).toBe('Foundation')
    expect(find(rows, 'Receptacles')?.section).toBe('Electrical')
    // sections come out in canonical order
    const order = rows.map((r) => r.section)
    const wall = order.indexOf('Wall framing')
    const roof = order.indexOf('Roof')
    const elec = order.indexOf('Electrical')
    expect(wall).toBeLessThan(roof)
    expect(roof).toBeLessThan(elec)
  })

  test('CSV keeps the section as the first column', () => {
    const rows = computeTakeoff([lumber('2x4', 2.4)], [])
    const lines = takeoffCsv(rows).split('\n')
    expect(lines[1]?.startsWith('Wall framing,')).toBe(true)
  })
})

describe('sheet goods from gross areas', () => {
  test('wall sheathing / subfloor / drywall sheets = ceil(area / 32 ft²)', () => {
    // 60 m² ≈ 645.8 ft² → 21 sheets; 30 m² → 11; 90 m² → 31
    const rows = computeTakeoff([], [], {
      wallSheathingM2: 60,
      subfloorM2: 30,
      drywallM2: 90,
    })
    expect(find(rows, 'Wall sheathing 7/16" WSP')?.quantity).toBe(Math.ceil(60 / (32 / 10.7639)))
    expect(find(rows, 'Subfloor 3/4" T&G')?.quantity).toBe(Math.ceil(30 / (32 / 10.7639)))
    expect(find(rows, 'Drywall 1/2"')?.quantity).toBe(Math.ceil(90 / (32 / 10.7639)))
    for (const item of ['Wall sheathing 7/16" WSP', 'Subfloor 3/4" T&G', 'Drywall 1/2"']) {
      expect(find(rows, item)?.section).toBe('Sheathing')
      expect(find(rows, item)?.unit).toBe('sheets')
    }
  })

  test('no areas → no sheathing section', () => {
    const rows = computeTakeoff([lumber('2x4', 2.4)], [])
    expect(rows.some((r) => r.section === 'Sheathing')).toBe(false)
  })
})

describe('hardware by role (no label regex)', () => {
  test('joist hangers and plate washers get their own lines', () => {
    const hanger = mem({
      system: 'floor-framing',
      role: 'hanger',
      material: 'steel',
      size: undefined,
      length: 0.08,
    })
    const washer = mem({
      system: 'foundation',
      role: 'plate-washer',
      material: 'steel',
      size: undefined,
      length: 0.08,
    })
    const rows = computeTakeoff([hanger, hanger, hanger, washer, washer], [])
    expect(find(rows, 'Joist hangers')?.quantity).toBe(3)
    expect(find(rows, 'Joist hangers')?.section).toBe('Floor')
    expect(find(rows, 'Plate washers 3x3')?.quantity).toBe(2)
    expect(find(rows, 'Plate washers 3x3')?.section).toBe('Foundation')
  })

  test('steel blocking outside the roof system is NOT a hurricane tie', () => {
    const fireStop = mem({ role: 'blocking', material: 'steel', size: undefined })
    const rows = computeTakeoff([fireStop], [])
    expect(find(rows, 'Hurricane ties')).toBeUndefined()
  })
})

describe('fastener schedule (R602.3(1) data × member counts)', () => {
  test('studs drive 16d pounds: 100 studs × 4 nails / 44 per lb ≈ 9.1 lbs', () => {
    const studs = Array.from({ length: 100 }, () => lumber('2x4', 2.4))
    const rows = computeTakeoff(studs, [])
    const nails = find(rows, 'Nails 16d common')
    expect(nails?.section).toBe('Fasteners')
    expect(nails?.unit).toBe('lbs')
    expect(nails?.quantity).toBeCloseTo(round((100 * 4) / 44), 5)
    expect(nails?.detail).toContain('400 nails')
  })

  test('sheathing sheets add 8d nails; hangers add 10d', () => {
    const hanger = mem({
      system: 'floor-framing',
      role: 'hanger',
      material: 'steel',
      size: undefined,
    })
    const rows = computeTakeoff([hanger], [], { wallSheathingM2: 10 })
    expect(find(rows, 'Nails 8d common')).toBeDefined() // 4 sheets × 44
    expect(find(rows, 'Nails 10d common')?.detail).toContain('10 nails')
  })

  function round(n: number): number {
    return Math.max(0.5, Math.round(n * 10) / 10)
  }
})

describe('MEP linear feet + rebar/grout/mortar', () => {
  test('pipe by size and material, duct by section, wire by gauge', () => {
    const pipe = mem({
      system: 'plumbing',
      role: 'pipe-run',
      material: 'pvc',
      size: undefined,
      dims: [3.048, 0.0762, 0.0762], // 10 ft of 3"
      length: 3.048,
    })
    const supply = mem({
      system: 'plumbing',
      role: 'pipe-run',
      material: 'copper',
      size: undefined,
      dims: [1.524, 0.0127, 0.0127], // 5 ft of ½"
      length: 1.524,
    })
    const trunk = mem({
      system: 'hvac',
      role: 'duct-run',
      material: 'duct',
      size: undefined,
      dims: [6.096, 0.2032, 0.3556], // 20 ft of 14×8
      length: 6.096,
    })
    const wire = mem({
      system: 'electrical',
      role: 'wire-run',
      material: 'copper',
      size: undefined,
      dims: [3.048, 0.0127, 0.0127],
      length: 3.048,
      label: 'NM-B 12/2 w/G — SA-1',
    })
    // Square-section members: a step-down TRUNK stays rectangular sheet
    // metal ('Trunk…' label contract); an unlabeled branch of equal sides
    // is round flex (round-10: shape alone can't tell 8×8 square from 8" ø).
    const squareTrunk = mem({
      system: 'hvac',
      role: 'duct-run',
      material: 'duct',
      size: undefined,
      dims: [3.048, 0.2032, 0.2032], // 10 ft of 8×8
      length: 3.048,
      label: 'Trunk 8"×8"',
    })
    const roundBranch = mem({
      system: 'hvac',
      role: 'duct-run',
      material: 'duct',
      size: undefined,
      dims: [1.524, 0.1524, 0.1524], // 5 ft of 6" round
      length: 1.524,
      label: 'Supply branch — bedroom',
    })
    const rows = computeTakeoff([pipe, supply, trunk, wire, squareTrunk, roundBranch], [])
    expect(find(rows, 'PVC 3"')?.quantity).toBeCloseTo(10, 1)
    expect(find(rows, 'PVC 3"')?.section).toBe('Plumbing')
    expect(find(rows, 'Copper 0.5"')?.quantity).toBeCloseTo(5, 1)
    expect(find(rows, 'Duct 14×8"')?.quantity).toBeCloseTo(20, 1)
    expect(find(rows, 'Duct 14×8"')?.section).toBe('HVAC')
    expect(find(rows, 'Duct 8×8"')?.quantity).toBeCloseTo(10, 1)
    expect(find(rows, 'Duct 8" round')).toBeUndefined()
    expect(find(rows, 'Duct 6" round')?.quantity).toBeCloseTo(5, 1)
    expect(find(rows, 'NM-B 12/2 w/G')?.quantity).toBeCloseTo(10, 1)
    expect(find(rows, 'NM-B 12/2 w/G')?.section).toBe('Electrical')
    for (const item of ['PVC 3"', 'Copper 0.5"', 'Duct 14×8"', 'NM-B 12/2 w/G']) {
      expect(find(rows, item)?.unit).toBe('lf')
    }
  })

  test('rebar linear feet by system; grout + mortar from the block counts', () => {
    const bar = mem({
      system: 'wall-framing',
      role: 'rebar',
      material: 'steel',
      size: undefined,
      dims: [0.0159, 2.1336, 0.0159],
      length: 2.1336, // 7 ft
    })
    const block = concrete([0.397, 0.194, 0.194], { system: 'wall-framing', role: 'block' })
    const grouted = concrete([0.397, 0.194, 0.194], {
      system: 'wall-framing',
      role: 'block',
      label: 'grouted cell + vertical rebar',
      grouted: true,
    })
    // Label-only decoy: grout must key off the dedicated `grouted` field,
    // never off label strings (round-10: label coupling broke on rewording).
    const decoy = concrete([0.397, 0.194, 0.194], {
      system: 'wall-framing',
      role: 'block',
      label: 'mentions grouted but is not',
    })
    const rows = computeTakeoff([bar, bar, block, grouted, decoy], [])
    const rebar = find(rows, 'Rebar')
    expect(rebar?.quantity).toBeCloseTo(14, 1)
    expect(rebar?.section).toBe('Wall framing')
    expect(find(rows, 'Mortar (Type S)')?.quantity).toBe(1) // 3 blocks → 1 bag
    expect(find(rows, 'Grout')?.detail).toContain('1 reinforced cells')
    // Numeric pin: 1 cell × 0.0085 m³ × 1.30795 yd³/m³ = 0.011 → floors at 0.1.
    expect(find(rows, 'Grout')?.quantity).toBe(0.1)
    expect(find(rows, 'Grout')?.unit).toBe('yd³')
    // 100 cells: 100 × 0.0085 × 1.30795 = 1.11175 → rounds to 1.1 yd³.
    const many = computeTakeoff(Array.from({ length: 100 }, () => grouted), [])
    expect(find(many, 'Grout')?.quantity).toBeCloseTo(1.1, 5)
  })
})

describe('electrical circuit rows', () => {
  test('circuit meta on fixtures becomes panel-schedule rows', () => {
    const rec = (circuit: string, extra: Record<string, string | number | boolean> = {}) =>
      fixture('receptacle', {
        meta: { circuit, breakerA: 20, gaugeAwg: 12, va: 180, gfci: true, ...extra },
      })
    const rows = computeTakeoff([], [rec('SA-1'), rec('SA-1'), rec('SA-2')])
    const sa1 = find(rows, 'Circuit SA-1')
    expect(sa1?.quantity).toBe(2)
    expect(sa1?.unit).toBe('devices')
    expect(sa1?.detail).toContain('20A / 12 AWG / 360 VA')
    expect(sa1?.detail).toContain('GFCI')
    expect(sa1?.section).toBe('Electrical')
    expect(find(rows, 'Circuit SA-2')?.quantity).toBe(1)
  })
})

describe('cutList — every wood member, exact lengths, grouped', () => {
  test('groups identical (system, size, role, length) and formats ft-in', () => {
    const rows = cutList([
      lumber('2x4', 2.4384), // 8'-0" stud
      lumber('2x4', 2.4384),
      lumber('2x4', 2.4384, { role: 'king-stud' }),
      lumber('2x10', 3.5, { system: 'floor-framing', role: 'joist' }),
      mem({ material: 'steel', role: 'anchor-bolt', size: undefined }), // not wood
    ])
    const studs = rows.find((r) => r.role === 'stud')
    expect(studs?.qty).toBe(2)
    expect(studs?.lengthLabel).toContain("8'")
    expect(rows.find((r) => r.role === 'king-stud')?.qty).toBe(1)
    expect(rows.find((r) => r.role === 'joist')?.section).toBe('Floor')
    expect(rows).toHaveLength(3)
  })

  test('cutListCsv serializes with a header', () => {
    const csv = cutListCsv(cutList([lumber('2x4', 2.4384)]))
    expect(csv.split('\n')[0]).toBe('section,size,role,length,qty')
    expect(csv.split('\n')[1]).toContain('Wall framing,2x4,stud')
  })
})

// ---------------------------------------------------------------------------
// Round-2 fabrication gaps (fittings, boxes, split nail gauges)
// ---------------------------------------------------------------------------

describe('MEP fittings — elbows at each bend, boots, collars', () => {
  const pipeLeg = (sourceId: string, i: number) =>
    mem({
      system: 'plumbing' as const,
      role: 'pipe-run' as const,
      material: 'pvc' as const,
      size: undefined,
      dims: [1 + i * 0.1, 0.0508, 0.0508], // 2" pipe legs
      length: 1 + i * 0.1,
      sourceId,
    })

  test('a chain of n pipe legs yields n−1 elbows, grouped by size', () => {
    // room A routes in 3 legs (2 bends), room B in 2 legs (1 bend)
    const rows = computeTakeoff(
      [pipeLeg('r_a', 0), pipeLeg('r_a', 1), pipeLeg('r_a', 2), pipeLeg('r_b', 0), pipeLeg('r_b', 1)],
      [],
    )
    const elbows = find(rows, 'PVC 2" fittings')
    expect(elbows?.quantity).toBe(3) // 2 + 1
    expect(elbows?.unit).toBe('pcs')
    expect(elbows?.section).toBe('Plumbing')
    expect(elbows?.detail).toContain('elbows')
  })

  test('single straight legs produce no fitting row', () => {
    const rows = computeTakeoff([pipeLeg('r_a', 0)], [])
    expect(find(rows, 'PVC 2" fittings')).toBeUndefined()
  })

  test('duct bends, register boots, and takeoff collars are counted', () => {
    const trunkLeg = (i: number) =>
      mem({
        system: 'hvac' as const,
        role: 'duct-run' as const,
        material: 'duct' as const,
        size: undefined,
        dims: [2, 0.2032, 0.3556], // 14×8
        length: 2,
        sourceId: 'r_equip',
        label: 'Trunk 14×8" — 1000 cfm',
      })
    const branchLeg = (room: string) =>
      mem({
        system: 'hvac' as const,
        role: 'duct-run' as const,
        material: 'duct' as const,
        size: undefined,
        dims: [1.5, 0.1524, 0.1524], // 6" round
        length: 1.5,
        sourceId: room,
        label: '6" branch — 120 cfm',
      })
    const rows = computeTakeoff(
      [trunkLeg(0), trunkLeg(1), branchLeg('r_bed'), branchLeg('r_kitchen')],
      [
        fixture('register', { system: 'hvac', sourceId: 'r_bed' }),
        fixture('register', { system: 'hvac', sourceId: 'r_kitchen' }),
      ],
    )
    expect(find(rows, 'Duct 14×8" fittings')?.quantity).toBe(1) // 2 trunk legs → 1 bend
    expect(find(rows, 'Register boots')?.quantity).toBe(2)
    expect(find(rows, 'Takeoff collars')?.quantity).toBe(2) // 2 branch chains
    expect(find(rows, 'Register boots')?.section).toBe('HVAC')
  })
})

describe('electrical boxes by type', () => {
  test('gang boxes, ceiling boxes, and panel cans from fixture kinds', () => {
    const rows = computeTakeoff(
      [],
      [
        fixture('receptacle'),
        fixture('receptacle-gfci'),
        fixture('switch'),
        fixture('light'),
        fixture('smoke-alarm'),
        fixture('panel'),
      ],
    )
    expect(find(rows, 'Device boxes (1-gang)')?.quantity).toBe(3)
    expect(find(rows, 'Ceiling boxes')?.quantity).toBe(2)
    expect(find(rows, 'Panel cans')?.quantity).toBe(1)
    for (const item of ['Device boxes (1-gang)', 'Ceiling boxes', 'Panel cans']) {
      expect(find(rows, item)?.section).toBe('Electrical')
    }
  })
})

describe('fastener gauges split per the R602.3(1) schedule', () => {
  test('a joist books 16d rim nails AND 10d toe-nails (pinning test)', () => {
    const joist = lumber('2x10', 3.5, { system: 'floor-framing', role: 'joist' })
    const rows = computeTakeoff([joist], [])
    expect(find(rows, 'Nails 16d common')?.detail).toContain('3 nails')
    expect(find(rows, 'Nails 10d common')?.detail).toContain('3 nails')
  })

  test('a rafter books 16d at the ridge AND 10d at the plate — never 6×16d', () => {
    const rafter = lumber('2x6', 4.2, { system: 'roof-framing', role: 'rafter' })
    const rows = computeTakeoff([rafter], [])
    expect(find(rows, 'Nails 16d common')?.detail).toContain('3 nails')
    expect(find(rows, 'Nails 10d common')?.detail).toContain('3 nails')
  })
})

describe('trunk reducers pinned (round-4/5: label-contract classification)', () => {
  test('a stepped trunk books one reducer per size change — even at the square 8" tail', () => {
    const trunkLeg = (w: number) =>
      mem({
        system: 'hvac' as const,
        role: 'duct-run' as const,
        material: 'duct' as const,
        size: undefined,
        dims: [2, 0.2032, w * 0.0254],
        length: 2,
        sourceId: 'r_equip',
        label: `Trunk ${w}×8" — cfm`,
      })
    const rows = computeTakeoff(
      // 14×8 → 12×8 → 8×8: the square tail is STILL a trunk (round-5 —
      // shape-based classification misread it as a round branch)
      [trunkLeg(14), trunkLeg(12), trunkLeg(8)],
      [fixture('register', { system: 'hvac' })],
    )
    expect(find(rows, 'Trunk reducers')?.quantity).toBe(2)
    expect(find(rows, 'Trunk reducers')?.section).toBe('HVAC')
  })
})

// ---------------------------------------------------------------------------
// Insulation batts + per-cladding rows (full wall engineering panel)
// ---------------------------------------------------------------------------

describe('insulation batts + per-wall cladding rows', () => {
  const batt = (label: string, len = 0.35, h = 2.2): Member =>
    mem({
      role: 'insulation',
      size: undefined,
      dims: [len, h, 0.089],
      length: len,
      label,
    })

  test('batts book by AREA per type + R, in stud-bay detail', () => {
    // 10 bays of 0.35×2.2m ≈ 7.7 m² ≈ 82.9 sqft
    const members = Array.from({ length: 10 }, () => batt('batt R-13 (zone 2A)'))
    const rows = computeTakeoff(members, [])
    const row = find(rows, 'Insulation — batt R-13')
    expect(row).toBeDefined()
    expect(row?.section).toBe('Wall framing')
    expect(row?.unit).toBe('sqft')
    expect(row?.detail).toBe('stud bays, by area')
    expect(row?.quantity).toBeCloseTo(10 * 0.35 * 2.2 * 10.7639, 0)
  })

  test('two walls at different R (or type) buy on separate rows', () => {
    const rows = computeTakeoff(
      [
        batt('batt R-13 (zone 2A)'),
        batt('batt R-21 (zone 5A)'),
        batt('spray-foam R-21 (zone 5A)'),
      ],
      [],
    )
    expect(find(rows, 'Insulation — batt R-13')).toBeDefined()
    expect(find(rows, 'Insulation — batt R-21')).toBeDefined()
    expect(find(rows, 'Insulation — spray-foam R-21')).toBeDefined()
  })

  test('per-wall cladding overrides produce one row per finish family', () => {
    const clad = (label: string): Member =>
      mem({ role: 'cladding', size: undefined, dims: [3, 2.4, 0.02], length: 3, label })
    const rows = computeTakeoff(
      [
        clad('vinyl siding, lap-profile bounding depth (2021 IRC R703.11)'),
        clad('3-coat cement plaster over metal/wire lath: … (2021 IRC R703.7)'),
      ],
      [],
    )
    expect(find(rows, 'Cladding — vinyl siding, lap-profile bounding depth')).toBeDefined()
    expect(
      find(rows, 'Cladding — 3-coat cement plaster over metal/wire lath: …'),
    ).toBeDefined()
    // both keep the existing net-of-openings convention
    for (const r of rows.filter((r) => r.item.startsWith('Cladding'))) {
      expect(r.detail).toBe('net of openings')
    }
  })

  test('no insulation members = no insulation rows (defaults untouched)', () => {
    const rows = computeTakeoff([mem()], [])
    expect(rows.some((r) => r.item.startsWith('Insulation'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// LOD-400 B4 — one row per material (the takeoff double-booking is dead)
// ---------------------------------------------------------------------------

import { FramingNode } from '../framing/schema'
import { computeLevel } from '../framing/compute'

describe('one row per material (LOD-400 B4 — gross rows defer to layer members)', () => {
  const SQFT = 1 / 0.09290304
  const layer = (role: 'sheathing' | 'drywall', len = 3, h = 2.4): Member =>
    mem({ role, size: undefined, dims: [len, h, 0.011], length: len, material: 'lumber' })

  test('a scene with layer members books exactly ONE sheathing row and ONE drywall row', () => {
    // The panel path: members AND gross areas together. Before B4 this
    // booked 'Sheathing | Wall sheathing 34 sheets gross' + 'Wall framing |
    // Sheathing ~33 sheets net' — two disagreeing buy quantities.
    const members = [
      ...Array.from({ length: 10 }, () => layer('sheathing')),
      ...Array.from({ length: 14 }, () => layer('drywall')),
    ]
    const rows = computeTakeoff(members, [], { wallSheathingM2: 100, drywallM2: 140 })
    const sheathingRows = rows.filter((r) => /sheathing/i.test(r.item))
    const drywallRows = rows.filter((r) => r.item === 'Drywall 1/2"')
    expect(sheathingRows).toHaveLength(1)
    expect(drywallRows).toHaveLength(1)
    // …and the survivor is the MEMBER-derived tally (members are truth).
    expect(sheathingRows[0]?.section).toBe('Wall framing')
    expect(sheathingRows[0]?.item).toBe('Sheathing 7/16" WSP')
    expect(sheathingRows[0]?.unit).toBe('sqft')
    expect(drywallRows[0]?.section).toBe('Wall framing')
    expect(drywallRows[0]?.unit).toBe('sqft')
    expect(find(rows, 'Wall sheathing 7/16" WSP')).toBeUndefined()
  })

  test('8d WSP nail poundage derives from the SURVIVING member row, not the dead gross row', () => {
    const members = Array.from({ length: 10 }, () => layer('sheathing'))
    const memberSheets = Math.ceil((10 * 3 * 2.4 * SQFT) / 32)
    const grossSheets = Math.ceil(500 / (32 / 10.7639))
    expect(grossSheets).not.toBe(memberSheets) // the decoy really disagrees
    const rows = computeTakeoff(members, [], { wallSheathingM2: 500 })
    const nails = find(rows, 'Nails 8d common')
    expect(nails?.detail).toContain(`${memberSheets * 44} nails`)
    expect(nails?.detail).not.toContain(`${grossSheets * 44} nails`)
  })

  test('LOD-200 fallback: NO layer members → gross rows still book, nails keyed to them', () => {
    const rows = computeTakeoff([], [], { wallSheathingM2: 60, drywallM2: 90 })
    const grossSheets = Math.ceil(60 / (32 / 10.7639))
    expect(find(rows, 'Wall sheathing 7/16" WSP')?.quantity).toBe(grossSheets)
    expect(find(rows, 'Drywall 1/2"')?.section).toBe('Sheathing')
    expect(find(rows, 'Nails 8d common')?.detail).toContain(`${grossSheets * 44} nails`)
  })

  test('a CMU scene books NO drywall row (the layer engine renders zero gypsum on masonry)', () => {
    // 6×4 shell, every wall CMU (one of them a mixed knee wall — layers
    // follow the CMU treatment whole-wall, v1): gross drywall used to book
    // ~both faces of every wall here while the members carried none.
    const wall = (id: string, start: [number, number], end: [number, number]) => ({
      id,
      type: 'wall',
      parentId: 'level_1',
      start,
      end,
      thickness: 0.2,
      height: 2.5,
      frontSide: 'exterior',
      backSide: 'interior',
      children: [],
    })
    const scene = {
      level_1: { id: 'level_1', type: 'level', level: 0, height: 2.5 },
      w_s: wall('w_s', [0, 0], [6, 0]),
      w_e: wall('w_e', [6, 0], [6, 4]),
      w_n: wall('w_n', [6, 4], [0, 4]),
      w_w: wall('w_w', [0, 4], [0, 0]),
    }
    const config = {
      ...FramingNode.parse({
        jurisdiction: 'INTL',
        detail: '400',
        showWalls: true,
        showFloor: false,
        showRoof: false,
        showFoundation: false,
        showElectrical: false,
        showPlumbing: false,
        showHvac: false,
        wallOverrides: {
          w_s: 'cmu',
          w_e: 'cmu',
          w_n: 'cmu',
          w_w: { construction: 'cmu', cmuHeightM: 1.2 },
        },
      }),
      parentId: 'level_1' as FramingNode['parentId'],
    }
    const result = computeLevel(scene, config)
    expect(result.members.some((m) => m.role === 'block')).toBe(true) // it IS a CMU scene
    expect(result.members.some((m) => m.role === 'drywall')).toBe(false)
    expect(result.areas.drywallM2 ?? 0).toBe(0)
    const rows = computeTakeoff(result.members, result.fixtures, result.areas)
    expect(rows.some((r) => r.item === 'Drywall 1/2"')).toBe(false)
    expect(rows.some((r) => /sheathing/i.test(r.item))).toBe(false)
  })
})

describe('LOD-400 B5: PT sole plates book on their own SKU row (R317.1)', () => {
  const groundWalls = (): WallSlice[] => [
    {
      id: 'w_s',
      start: [0, 0],
      end: [6, 0],
      dir: [1, 0],
      length: 6,
      thickness: 0.114,
      height: 2.44,
      exterior: true,
      openings: [],
      curved: false,
    },
    {
      id: 'w_e',
      start: [6, 0],
      end: [6, 4],
      dir: [0, 1],
      length: 4,
      thickness: 0.114,
      height: 2.44,
      exterior: true,
      openings: [],
      curved: false,
    },
  ]

  test('a ground-level walled scene books the 2x4 PT row; upper storeys book none', () => {
    const ground = computeTakeoff(
      frameWalls(groundWalls(), DEFAULT_SPEC, undefined, { slabBearing: true }),
      [],
    )
    const pt = ground.filter((r) => r.section === 'Wall framing' && r.item === '2x4 PT')
    expect(pt.length).toBeGreaterThan(0) // stock row(s) + bd-ft row
    // exactly the two sole plates' worth of sticks on the PT stock rows
    const ptSticks = pt
      .filter((r) => r.unit === 'pcs')
      .reduce((sum, r) => sum + r.quantity, 0)
    expect(ptSticks).toBe(2)
    expect(pt.every((r) => r.detail.includes('pressure-treated') || r.unit === 'bd-ft')).toBe(true)

    const upper = computeTakeoff(frameWalls(groundWalls(), DEFAULT_SPEC), [])
    expect(upper.some((r) => r.item === '2x4 PT')).toBe(false)
    // the untreated bucket keeps everything on the upper storey
    expect(upper.some((r) => r.item === '2x4')).toBe(true)
  })

  test('PT plates leave the untreated row: total stick count is conserved', () => {
    const count = (rows: TakeoffRow[], item: string) =>
      rows
        .filter((r) => r.section === 'Wall framing' && r.item === item && r.unit === 'pcs')
        .reduce((sum, r) => sum + r.quantity, 0)
    const dry = computeTakeoff(frameWalls(groundWalls(), DEFAULT_SPEC), [])
    const wet = computeTakeoff(
      frameWalls(groundWalls(), DEFAULT_SPEC, undefined, { slabBearing: true }),
      [],
    )
    expect(count(wet, '2x4') + count(wet, '2x4 PT')).toBe(count(dry, '2x4'))
    expect(count(wet, '2x4 PT')).toBe(2)
  })
})

describe('cavity-fit framing flags aggregate (night-4)', () => {
  test('a compressed wall books ONE Flags row with a member count; lumber rows stay nominal', () => {
    const wall: WallSlice = {
      id: 'w_thick',
      start: [0, 0],
      end: [6, 0],
      dir: [1, 0],
      length: 6,
      thickness: 0.15,
      height: 2.44,
      exterior: true,
      openings: [],
      curved: false,
    }
    const members = frameWall(wall, DEFAULT_SPEC)
    const rows = computeTakeoff(members, [])
    const flagRows = rows.filter(
      (r) => r.section === 'Flags' && r.detail.includes('compressed'),
    )
    // one exact string per (size, thickness) class → exactly one row
    expect(flagRows).toHaveLength(1)
    expect(flagRows[0]?.quantity).toBe(members.filter((m) => m.flag?.includes('compressed')).length)
    expect(flagRows[0]?.quantity as number).toBeGreaterThan(5)
    // the LUMBER rows keep their nominal 2x6 identity (no 4.91" fiction)
    const lumberRows = rows.filter((r) => r.item.startsWith('2x6'))
    expect(lumberRows.length).toBeGreaterThan(0)
    expect(rows.filter((r) => r.section !== 'Flags').some((r) => r.item.includes('4.9') || r.detail.includes('4.9'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// LOD-400 B6d: roof deck/underlayment/drip rows + the SYSTEM filter on the
// gross-row suppression gates (the B4 skeptic's advisory)
// ---------------------------------------------------------------------------

import { frameRoofs, type RoofSegmentSlice } from './roof-framing'

describe('LOD-400 B6d: roof package rows are member-derived; wall gates filter by system', () => {
  const SQFT = 1 / 0.09290304
  const roofSeg = (overrides: Partial<RoofSegmentSlice> = {}): RoofSegmentSlice => ({
    id: 'roofseg_b6',
    roofType: 'gable',
    position: [0, 2.5, 0],
    yaw: 0,
    width: 8,
    depth: 6,
    pitch: (40 * Math.PI) / 180,
    overhang: 0.3,
    wallHeight: 0.5,
    ...overrides,
  })
  const roofMembers = frameRoofs([roofSeg()], [], { ...DEFAULT_SPEC, detail: '400' })
  const wallLayer = (role: 'sheathing' | 'drywall' | 'wrb', len = 3, h = 2.4): Member =>
    mem({ role, size: undefined, dims: [len, h, 0.011], length: len, material: 'lumber' })

  test('S4 parity: the roof sheet/underlayment/drip rows equal the member geometry exactly', () => {
    const rows = computeTakeoff(roofMembers, [])
    const deckM2 = roofMembers
      .filter((m) => m.role === 'sheathing')
      .reduce((s, m) => s + m.dims[0] * m.dims[2], 0)
    const underM2 = roofMembers
      .filter((m) => m.role === 'wrb')
      .reduce((s, m) => s + m.dims[0] * m.dims[2], 0)
    const dripLf = roofMembers
      .filter((m) => m.role === 'drip-edge')
      .reduce((s, m) => s + m.length / 0.3048, 0)
    expect(deckM2).toBeGreaterThan(0)
    const deckRow = find(rows, 'Roof sheathing 7/16" WSP')
    expect(deckRow?.section).toBe('Roof')
    expect(deckRow?.quantity).toBeCloseTo(Math.round(deckM2 * SQFT * 10) / 10, 6)
    expect(deckRow?.unit).toBe('sqft')
    expect(deckRow?.detail).toContain(`~${Math.ceil((deckM2 * SQFT) / 32)} 4x8 sheets`)
    const underRow = find(rows, 'Roof underlayment')
    expect(underRow?.section).toBe('Roof')
    // +10% lap factor, STATED on the row
    expect(underRow?.quantity).toBeCloseTo(Math.round(underM2 * 1.1 * SQFT * 10) / 10, 6)
    expect(underRow?.detail).toContain('+10% course laps')
    expect(underRow?.detail).toContain('covering by finish schedule, not booked')
    const dripRow = find(rows, 'Drip edge')
    expect(dripRow?.section).toBe('Roof')
    expect(dripRow?.unit).toBe('lf')
    expect(dripRow?.quantity).toBeCloseTo(Math.round(dripLf * 10) / 10, 6)
  })

  test('system filter direction 1: ROOF deck alone never suppresses the WALL gross rows', () => {
    // A scene with a framed roof but LOD-200 walls (no wall layer members):
    // before the filter the roof deck tripped hasSheathingMembers and the
    // purchaser lost the wall sheathing buy entirely.
    const rows = computeTakeoff(roofMembers, [], { wallSheathingM2: 60, drywallM2: 90 })
    const grossSheets = Math.ceil(60 / (32 / 10.7639))
    expect(find(rows, 'Wall sheathing 7/16" WSP')?.quantity).toBe(grossSheets)
    expect(find(rows, 'Drywall 1/2"')?.section).toBe('Sheathing')
    // the WALL 8d nails still key off the surviving gross row
    expect(find(rows, 'Nails 8d common')?.detail).toContain(`${grossSheets * 44} nails`)
  })

  test('system filter direction 2: roof sqft never lands in the wall member rows', () => {
    const walls = [
      ...Array.from({ length: 10 }, () => wallLayer('sheathing')),
      ...Array.from({ length: 4 }, () => wallLayer('wrb')),
    ]
    const rows = computeTakeoff([...walls, ...roofMembers], [], { wallSheathingM2: 100 })
    // wall member rows book the WALL area only (10 × 3 × 2.4 m²)
    const wallRow = find(rows, 'Sheathing 7/16" WSP')
    expect(wallRow?.section).toBe('Wall framing')
    expect(wallRow?.quantity).toBeCloseTo(Math.round(10 * 3 * 2.4 * SQFT * 10) / 10, 6)
    const wrbRow = find(rows, 'WRB (housewrap/felt)')
    expect(wrbRow?.quantity).toBeCloseTo(Math.round(4 * 3 * 2.4 * SQFT * 10) / 10, 6)
    // gross row still suppressed by the WALL members (B4 unchanged)
    expect(find(rows, 'Wall sheathing 7/16" WSP')).toBeUndefined()
    // and the roof rows book the roof geometry, untouched by the walls
    const deckM2 = roofMembers
      .filter((m) => m.role === 'sheathing')
      .reduce((s, m) => s + m.dims[0] * m.dims[2], 0)
    expect(find(rows, 'Roof sheathing 7/16" WSP')?.quantity).toBeCloseTo(
      Math.round(deckM2 * SQFT * 10) / 10,
      6,
    )
  })

  test('drywall gate symmetry: a non-wall drywall member never kills the gross drywall row', () => {
    const alien = mem({
      system: 'roof-framing',
      role: 'drywall',
      size: undefined,
      dims: [3, 2.4, 0.0127],
      length: 3,
      material: 'lumber',
    })
    const rows = computeTakeoff([alien], [], { drywallM2: 90 })
    const grossSheets = Math.ceil(90 / (32 / 10.7639))
    expect(find(rows, 'Drywall 1/2"', '4x8 sheets, gross — both faces of interior walls')?.quantity).toBe(
      grossSheets,
    )
  })

  test('8d re-key: roof deck nails book their OWN row, never merged into the wall 8d row', () => {
    const walls = Array.from({ length: 9 }, () => wallLayer('sheathing'))
    const rows = computeTakeoff([...walls, ...roofMembers], [])
    const wall8d = find(rows, 'Nails 8d common')
    const roof8d = find(rows, 'Nails 8d common (roof deck)')
    const wallSheets = Math.ceil((9 * 3 * 2.4 * SQFT) / 32)
    const deckM2 = roofMembers
      .filter((m) => m.role === 'sheathing')
      .reduce((s, m) => s + m.dims[0] * m.dims[2], 0)
    const roofSheets = Math.ceil((deckM2 * SQFT) / 32)
    expect(wall8d?.detail).toContain(`${wallSheets * 44} nails`)
    expect(roof8d?.detail).toContain(`${roofSheets * 44} nails`)
    // the counts genuinely differ — the split is proven, not vacuous
    expect(wallSheets).not.toBe(roofSheets)
  })

  test('no roof members → no roof rows (member-derived, no gross fallback)', () => {
    const rows = computeTakeoff([mem()], [], { wallSheathingM2: 60 })
    expect(find(rows, 'Roof sheathing 7/16" WSP')).toBeUndefined()
    expect(find(rows, 'Roof underlayment')).toBeUndefined()
    expect(find(rows, 'Drip edge')).toBeUndefined()
  })
})

describe('LOD-400 B9: portal hardware books member-derived (B4 convention)', () => {
  const T9 = 0.0381
  const garageWall = (): WallSlice => {
    const len = 6.1
    return {
      id: 'garage_front',
      start: [0, 0],
      end: [len, 0],
      length: len,
      dir: [1, 0],
      thickness: 0.15,
      height: 2.5,
      exterior: true,
      curved: false,
      openings: [
        {
          id: 'garage_door',
          kind: 'door',
          u: len / 2,
          width: feet(16) - T9,
          height: 2.13,
          sillHeight: 0,
          roughWidth: feet(16),
          roughHeight: 2.13 + T9,
        },
      ],
    }
  }

  test('Portal straps row == strap member count; absent when no portal frames', () => {
    const seismic = frameWall(garageWall(), { ...DEFAULT_SPEC, seismicHoldDowns: true })
    const rows = computeTakeoff(seismic, [])
    const strapRow = rows.find((r) => r.item === 'Portal straps 1000 lb')
    expect(strapRow?.quantity).toBe(seismic.filter((m) => m.role === 'strap').length)
    expect(strapRow?.quantity).toBe(2)
    expect(strapRow?.section).toBe('Wall framing')
    expect(strapRow?.detail).toContain('R602.10.6.4')
    // No portal frames → no phantom row (member-derived, never invented).
    const intlRows = computeTakeoff(frameWall(garageWall(), DEFAULT_SPEC), [])
    expect(intlRows.find((r) => r.item === 'Portal straps 1000 lb')).toBeUndefined()
  })

  test('portal hold-down posts ride the ordinary lumber rows: pcs delta == member delta', () => {
    const seismic = frameWall(garageWall(), { ...DEFAULT_SPEC, seismicHoldDowns: true })
    const intl = frameWall(garageWall(), DEFAULT_SPEC)
    const pcs = (rows: TakeoffRow[]): number =>
      rows
        .filter((r) => r.section === 'Wall framing' && r.item === '2x6' && r.unit === 'pcs')
        .reduce((sum, r) => sum + r.quantity, 0)
    const sticks = (members: Member[]): number =>
      members.filter((m) => m.size === '2x6' && m.material === 'lumber').length
    // every 2x6 in this wall cuts from one stick, so piece deltas track
    // member deltas exactly: +4 posts (no grid stud falls inside a post
    // keep-out on this standalone wall — corner-inset scenes can yield one)
    expect(pcs(computeTakeoff(seismic, [])) - pcs(computeTakeoff(intl, []))).toBe(
      sticks(seismic) - sticks(intl),
    )
    expect(sticks(seismic) - sticks(intl)).toBe(4)
  })

  test('bracing flags surface on the Flags rows with counts (INTL narrow returns)', () => {
    const rows = computeTakeoff(frameWall(garageWall(), DEFAULT_SPEC), [])
    const flagRows = rows.filter(
      (r) => r.section === 'Flags' && r.detail.includes('portal frame (R602.10.6.4)'),
    )
    expect(flagRows).toHaveLength(1) // symmetric returns share ONE exact string
    expect(flagRows[0]?.quantity).toBe(2) // …aggregated across both kings
  })

  test('hold-down row stays member-derived when the foundation joins the compose', () => {
    const seismicSpec = { ...DEFAULT_SPEC, detail: '400' as const, seismicHoldDowns: true }
    const walls = [garageWall()]
    const members = [
      ...frameWalls(walls, seismicSpec, undefined, { slabBearing: true }),
      ...buildFoundation(
        walls,
        [
          {
            id: 'slab_g',
            polygon: [
              [0, 0],
              [6.1, 0],
              [6.1, 4],
              [0, 4],
            ],
            holes: [],
            elevation: 0,
            thickness: 0.2,
          },
        ],
        seismicSpec,
      ),
    ]
    const rows = computeTakeoff(members, [])
    const hdRow = rows.find((r) => r.item === 'Hold-downs')
    expect(hdRow?.quantity).toBe(members.filter((m) => m.role === 'hold-down').length)
    expect(hdRow?.quantity).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// LOD-400 B11: snow-deepened headers shift the lumber rows — ONLY in
// deepened states, and by exactly the header member delta.
// ---------------------------------------------------------------------------

import { inches as inchesB11 } from '../core/units'
import { applyJurisdiction as applyJurisdictionB11, profileFor as profileForB11 } from '../jurisdiction/profiles'

describe('LOD-400 B11: takeoff lumber rows follow the header snow band', () => {
  const wall56 = (): WallSlice => {
    const ro = inchesB11(56)
    return {
      id: 'w_b11',
      start: [0, 0],
      end: [6, 0],
      length: 6,
      dir: [1, 0],
      thickness: 0.114,
      height: 2.7,
      exterior: false,
      openings: [
        {
          id: 'n_b11',
          kind: 'window',
          u: 3,
          width: ro - inchesB11(1.5),
          height: 1.0,
          sillHeight: 0.9,
          roughWidth: ro,
          roughHeight: 1.0 + inchesB11(1.5),
        },
      ],
      curved: false,
    }
  }
  const rowsAt = (code: string): TakeoffRow[] => {
    const spec = applyJurisdictionB11({ ...DEFAULT_SPEC, detail: '400' as const }, profileForB11(code))
    return computeTakeoff(frameWall(wall56(), spec), [])
  }
  const wallLumber = (rows: TakeoffRow[]): TakeoffRow[] =>
    rows.filter((r) => r.section === 'Wall framing' && /^\dx\d/.test(r.item))

  test('VT books the deepened 4x10 header stick; INTL books the 4x8 — nothing else moves', () => {
    const vt = wallLumber(rowsAt('VT'))
    const intl = wallLumber(rowsAt('INTL'))
    const item = (rows: TakeoffRow[], name: string): TakeoffRow | undefined =>
      rows.find((r) => r.item === name)
    expect(item(intl, '4x8')?.quantity).toBe(1)
    expect(item(intl, '4x10')).toBeUndefined()
    expect(item(vt, '4x10')?.quantity).toBe(1)
    expect(item(vt, '4x8')).toBeUndefined()
    // every non-header row is identical — the header SKU is the whole delta
    const others = (rows: TakeoffRow[]): TakeoffRow[] =>
      rows.filter((r) => r.item !== '4x8' && r.item !== '4x10')
    expect(others(vt)).toEqual(others(intl))
  })

  test('low-snow states book rows byte-equal to INTL (TX/CA pin)', () => {
    const intl = rowsAt('INTL')
    expect(rowsAt('TX')).toEqual(intl)
    expect(rowsAt('CA')).toEqual(intl)
  })

  test('round 2: a past-cap VT span books the SUPPLIER line, never a 4x12 stick (the cap reaches the buy list)', () => {
    // 76" RO: past the 70-psf column's 2-2x12 cell (74") — VT routes to
    // the engineered path; INTL (cap untouched at 10 ft) still buys the
    // prescriptive 4x10 stick.
    const wall76 = (): WallSlice => {
      const w = wall56()
      const ro = inchesB11(76)
      const op = w.openings[0] as (typeof w.openings)[number]
      op.roughWidth = ro
      op.width = ro - inchesB11(1.5)
      return w
    }
    const at = (code: string): TakeoffRow[] => {
      const spec = applyJurisdictionB11(
        { ...DEFAULT_SPEC, detail: '400' as const },
        profileForB11(code),
      )
      return computeTakeoff(frameWall(wall76(), spec), [])
    }
    const vt = at('VT')
    const intl = at('INTL')
    expect(vt.find((r) => r.item.startsWith('Engineered header'))?.quantity).toBe(1)
    expect(vt.find((r) => r.item === '4x12')).toBeUndefined()
    expect(intl.find((r) => r.item === '4x10')?.quantity).toBe(1)
    expect(intl.find((r) => r.item.startsWith('Engineered header'))).toBeUndefined()
  })
})

describe('LOD-400 B10: uplift hardware books member-derived (B4 convention)', () => {
  const T10 = 0.0381
  const laWall = (): WallSlice => {
    const len = 6
    return {
      id: 'w_uplift',
      start: [0, 0],
      end: [len, 0],
      length: len,
      dir: [1, 0],
      thickness: 0.15,
      height: 2.5,
      exterior: true,
      curved: false,
      openings: [
        {
          id: 'door_1',
          kind: 'door',
          u: 2,
          width: 0.9,
          height: 2.1,
          sillHeight: 0,
          roughWidth: 0.9 + T10,
          roughHeight: 2.1 + T10,
        },
        {
          id: 'win_1',
          kind: 'window',
          u: 4.4,
          width: 1.2,
          height: 1.2,
          sillHeight: 0.9,
          roughWidth: 1.2 + T10,
          roughHeight: 1.2 + T10,
        },
      ],
    }
  }
  const laSpec10 = { ...DEFAULT_SPEC, highWindUplift: true }

  test('three dedicated rows == role counts; absent when no hardware (S4 both directions)', () => {
    const members = frameWall(laWall(), laSpec10, { slabBearing: true })
    const rows = computeTakeoff(members, [])
    const count = (role: string): number => members.filter((m) => m.role === role).length
    const row = (item: string): TakeoffRow | undefined => rows.find((r) => r.item === item)

    const connectors = row('Stud-to-plate connectors')
    expect(count('uplift-connector')).toBeGreaterThan(0)
    expect(connectors?.quantity).toBe(count('uplift-connector'))
    expect(connectors?.section).toBe('Wall framing')
    expect(connectors?.unit).toBe('pcs')
    expect(connectors?.detail).toContain('R802.11/WFCM')
    expect(connectors?.detail).toContain('install per schedule')

    const straps = row('Header uplift straps')
    expect(count('uplift-strap')).toBe(4)
    expect(straps?.quantity).toBe(4)
    expect(straps?.detail).toContain('install per schedule')

    const fdn = row('Foundation uplift straps')
    expect(count('foundation-strap')).toBeGreaterThan(0)
    expect(fdn?.quantity).toBe(count('foundation-strap'))
    // The dedupe convention is STATED on the buy row — a purchaser sees
    // why the count is lower than the bare 48" arithmetic would suggest.
    expect(fdn?.detail).toContain('deduped where an R403.1.6 bolt/hold-down anchors')

    // Member-derived, never invented: no hardware → no rows.
    const intlRows = computeTakeoff(frameWall(laWall(), DEFAULT_SPEC, { slabBearing: true }), [])
    expect(intlRows.find((r) => r.item === 'Stud-to-plate connectors')).toBeUndefined()
    expect(intlRows.find((r) => r.item === 'Header uplift straps')).toBeUndefined()
    expect(intlRows.find((r) => r.item === 'Foundation uplift straps')).toBeUndefined()
  })

  test('the LA takeoff delta is EXACTLY the three rows — no nail poundage, no lumber leak (B9 fastener rule)', () => {
    const la = computeTakeoff(frameWall(laWall(), laSpec10, { slabBearing: true }), [])
    const intl = computeTakeoff(frameWall(laWall(), DEFAULT_SPEC, { slabBearing: true }), [])
    const UPLIFT_ITEMS = new Set([
      'Stud-to-plate connectors',
      'Header uplift straps',
      'Foundation uplift straps',
    ])
    expect(la.filter((r) => !UPLIFT_ITEMS.has(r.item))).toEqual(intl)
    expect(la.filter((r) => UPLIFT_ITEMS.has(r.item))).toHaveLength(3)
  })

  test("B9's portal-strap census is untouched: uplift straps never book as portal straps", () => {
    // HI-style spec: seismic AND high-wind — both hardware families on one
    // garage wall. Each row counts ITS role only.
    const garage: WallSlice = {
      id: 'garage_hi',
      start: [0, 0],
      end: [6.1, 0],
      length: 6.1,
      dir: [1, 0],
      thickness: 0.15,
      height: 2.5,
      exterior: true,
      curved: false,
      openings: [
        {
          id: 'garage_door',
          kind: 'door',
          u: 3.05,
          width: feet(16) - T10,
          height: 2.13,
          sillHeight: 0,
          roughWidth: feet(16),
          roughHeight: 2.13 + T10,
        },
      ],
    }
    const hi = { ...DEFAULT_SPEC, seismicHoldDowns: true, highWindUplift: true }
    const members = frameWall(garage, hi, { slabBearing: true })
    const rows = computeTakeoff(members, [])
    expect(rows.find((r) => r.item === 'Portal straps 1000 lb')?.quantity).toBe(
      members.filter((m) => m.role === 'strap').length,
    )
    expect(rows.find((r) => r.item === 'Header uplift straps')?.quantity).toBe(
      members.filter((m) => m.role === 'uplift-strap').length,
    )
    expect(members.filter((m) => m.role === 'strap').length).toBe(2)
    expect(members.filter((m) => m.role === 'uplift-strap').length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// LOD-400 B21e: stated waste factors + sheet-goods convention honesty
// ---------------------------------------------------------------------------

import { baselineConfig, baselineScene } from '../framing/baseline-scene'
import { frameRoofs as frameRoofsB21e, type RoofSegmentSlice as RoofSegB21e } from './roof-framing'

describe('LOD-400 B21e: stated waste factors never inflate member truth (S4)', () => {
  const SQ = 1 / 0.09290304
  const SHEET = 32 / 10.7639
  const round1 = (n: number) => Math.round(n * 10) / 10
  /** The ONE stated-waste shape every factor row prints: '+X% waste ≈ …'. */
  const WASTE_RE = /\+\d+% waste ≈ /
  const wallLayer = (role: 'sheathing' | 'drywall' | 'wrb', len = 3, h = 2.4): Member =>
    mem({ role, size: undefined, dims: [len, h, 0.011], length: len, material: 'lumber' })
  const deckPanel = (len = 1.2192, w = 2.4384): Member =>
    mem({
      system: 'floor-framing',
      role: 'subfloor',
      size: undefined,
      dims: [len, 0.018, w],
      length: len,
      material: 'engineered',
    })
  const roofSeg = (overrides: Partial<RoofSegB21e> = {}): RoofSegB21e => ({
    id: 'roofseg_b21e',
    roofType: 'gable',
    position: [0, 2.5, 0],
    yaw: 0,
    width: 8,
    depth: 6,
    pitch: (40 * Math.PI) / 180,
    overhang: 0.3,
    wallHeight: 0.5,
    ...overrides,
  })

  test('wall sheathing + drywall member rows: NET quantity column, +10% buy DERIVED from the same net', () => {
    const members = [
      ...Array.from({ length: 10 }, () => wallLayer('sheathing')),
      ...Array.from({ length: 14 }, () => wallLayer('drywall')),
    ]
    const rows = computeTakeoff(members, [], { wallSheathingM2: 100, drywallM2: 140 })
    for (const [item, count] of [
      ['Sheathing 7/16" WSP', 10],
      ['Drywall 1/2"', 14],
    ] as const) {
      const netSqft = count * 3 * 2.4 * SQ
      const row = find(rows, item)
      // NET preservation: the quantity column IS the member arithmetic —
      // a waste factor that silently scaled it would fail here
      expect(row?.quantity).toBe(round1(netSqft))
      // …and the stated order figure derives from the SAME net: net sheet
      // count visible, buy = ceil(net × 1.10 / 32) — pinned at +10%
      expect(row?.detail).toContain(`(~${Math.ceil(netSqft / 32)} 4x8 sheets)`)
      expect(row?.detail).toContain(`+10% waste ≈ ${Math.ceil((netSqft * 1.1) / 32)} sheets`)
    }
  })

  test('lumber pcs rows: exact member stick count in the column, +5% order figure in the detail', () => {
    // 43 sticks: ceil(43 × 1.05) = 46 — the ceil really bites (45.15 → 46)
    const rows = computeTakeoff(
      Array.from({ length: 43 }, () => lumber('2x4', 2.3)),
      [],
    )
    const row = find(rows, '2x4', '8 ft stock — +5% waste ≈ 46 pcs')
    expect(row?.quantity).toBe(43)
    // the bd-ft row stays factor-free: the drop is already bought via
    // stock rounding, and the pcs rows carry the class's stated allowance
    expect(find(rows, '2x4', 'board feet')?.detail).toBe('board feet')
  })

  test('concrete pour rows: NET yd³ in the column, +5% order CEILED to the 0.1 yd³ batch', () => {
    const vol = 2 * 0.5 * 1 // 1 m³
    const rows = computeTakeoff([concrete([2, 0.5, 1])], [])
    const row = find(rows, 'Concrete')
    expect(row?.quantity).toBe(Math.max(0.1, round1(vol * 1.30795)))
    expect(row?.detail).toBe(
      `footings — +5% waste ≈ ${Math.ceil(vol * 1.30795 * 1.05 * 10) / 10} yd³`,
    )
    // the batch-ceil is NON-VACUOUS (r1 F1): a pour whose +5% would round
    // back DOWN onto the net figure must still buy the next 0.1 batch —
    // 0.7354 m³ = 0.9619 yd³ → net prints 1.0; ×1.05 = 1.0100 → round1
    // collapses to 1.0 (stated factor adds zero), batch-ceil buys 1.1
    const tight = find(computeTakeoff([concrete([2, 0.3677, 1])], []), 'Concrete')
    expect(tight?.quantity).toBe(1)
    expect(tight?.detail).toBe('footings — +5% waste ≈ 1.1 yd³')
  })

  test('roof deck row: NET sqft quantity + stated +10% buy; LAP rows never say waste (B6 reconcile)', () => {
    const members = frameRoofsB21e([roofSeg()], [], { ...DEFAULT_SPEC, detail: '400' })
    const rows = computeTakeoff(members, [])
    const deckM2 = members
      .filter((m) => m.role === 'sheathing')
      .reduce((s, m) => s + m.dims[0] * m.dims[2], 0)
    const deckRow = find(rows, 'Roof sheathing 7/16" WSP')
    expect(deckRow?.quantity).toBeCloseTo(round1(deckM2 * SQ), 6)
    expect(deckRow?.detail).toContain(
      `+10% waste ≈ ${Math.ceil((deckM2 * SQ * 1.1) / 32)} sheets`,
    )
    // LAP ≠ WASTE: the underlayment quantity INCLUDES its +10% course laps
    // (installed overlap) and the row says 'laps', never 'waste'
    const underM2 = members
      .filter((m) => m.role === 'wrb')
      .reduce((s, m) => s + m.dims[0] * m.dims[2], 0)
    const underRow = find(rows, 'Roof underlayment')
    expect(underRow?.quantity).toBeCloseTo(round1(underM2 * 1.1 * SQ), 6)
    expect(underRow?.detail).toContain('+10% course laps')
    expect(WASTE_RE.test(underRow?.detail ?? '')).toBe(false)
  })

  test('subfloor label fix: member path says net + stated waste; only the area fallback says gross', () => {
    // MEMBER path (B3): net deck area, quantity = net sheet count, stated buy
    const deck = Array.from({ length: 9 }, () => deckPanel())
    const netM2 = 9 * 1.2192 * 2.4384
    const memberRows = computeTakeoff(deck, [], { subfloorM2: 60 }) // decoy area ignored
    const memberRow = find(memberRows, 'Subfloor 3/4" T&G')
    expect(memberRow?.quantity).toBe(Math.ceil(netM2 / SHEET))
    expect(memberRow?.detail).toBe(
      `4x8 sheets from deck members, net — +10% waste ≈ ${Math.ceil((netM2 * 1.1) / SHEET)} sheets`,
    )
    // FALLBACK path (LOD-200): NOT gross — compute.ts deducts slab holes
    // (stairwells), so the row states its net-of-floor-openings basis and
    // carries the stated factor too (r1 F2: '4x8 sheets, gross' sat on a
    // hole-deducted number — the same mislabel class as the member path)
    const fallbackRow = find(computeTakeoff([], [], { subfloorM2: 30 }), 'Subfloor 3/4" T&G')
    expect(fallbackRow?.detail).toBe(
      `4x8 sheets from slab area, net of floor openings — +10% waste ≈ ${Math.ceil((30 * 1.1) / SHEET)} sheets`,
    )
    expect(fallbackRow?.quantity).toBe(Math.ceil(30 / SHEET))
  })

  test("header honesty: 'gross' prints ONLY on LOD-200 fallback rows, and those carry NO stacked factor", () => {
    // fully member-derived demo compose → no row may claim a gross buy
    const result = computeLevel(baselineScene(), baselineConfig('TX'))
    const rows = computeTakeoff(result.members, result.fixtures, result.areas)
    expect(rows.some((r) => r.detail.includes('gross'))).toBe(false)
    // LOD-200 fallback → 'gross' is exactly the WALL fallbacks (WSP +
    // drywall faceArea sums, openings never deducted — the drywall row
    // states that basis since B21e) and neither stacks a waste factor on
    // the openings-not-deducted allowance
    const fallback = computeTakeoff([], [], { wallSheathingM2: 60, subfloorM2: 30, drywallM2: 90 })
    const grossRows = fallback.filter((r) => r.detail.includes('gross'))
    expect(grossRows.map((r) => r.item).sort()).toEqual([
      'Drywall 1/2"',
      'Wall sheathing 7/16" WSP',
    ])
    for (const r of grossRows) {
      expect(WASTE_RE.test(r.detail)).toBe(false)
    }
    // the SUBFLOOR fallback is hole-deducted NET (r1 F2), never 'gross' —
    // it states its basis and carries the stated waste factor instead
    const sub = fallback.find((r) => r.item === 'Subfloor 3/4" T&G')
    expect(sub?.detail).toContain('net of floor openings')
    expect(sub?.detail).not.toContain('gross')
    expect(WASTE_RE.test(sub?.detail ?? '')).toBe(true)
  })

  test('expected-diff enumeration: on the demo compose the waste-stated rows are EXACTLY the enumerated classes', () => {
    const result = computeLevel(baselineScene(), baselineConfig('TX'))
    const rows = computeTakeoff(result.members, result.fixtures, result.areas)
    const stated = rows.filter((r) => WASTE_RE.test(r.detail))
    const isLumberPcs = (r: TakeoffRow) =>
      r.unit === 'pcs' && /^\d+x\d+( PT)?$/.test(r.item) && / ft stock/.test(r.detail)
    const isBoardGood = (r: TakeoffRow) =>
      r.item === 'Sheathing 7/16" WSP' || r.item === 'Drywall 1/2"'
    const isPour = (r: TakeoffRow) => r.item === 'Concrete'
    // every stated row belongs to an enumerated class…
    for (const r of stated) {
      expect(isLumberPcs(r) || isBoardGood(r) || isPour(r)).toBe(true)
    }
    // …and every row of those classes states its factor (uniform, both ways)
    for (const r of rows) {
      if (isLumberPcs(r) || isPour(r) || (isBoardGood(r) && r.section === 'Wall framing')) {
        expect(WASTE_RE.test(r.detail)).toBe(true)
      }
    }
    // the demo compose really exercises all three classes (non-vacuous)
    expect(stated.some(isLumberPcs)).toBe(true)
    expect(stated.some(isBoardGood)).toBe(true)
    expect(stated.some(isPour)).toBe(true)
    // LAP rows keep the opposite convention and never read as waste
    const vapor = find(rows, 'Vapor retarder 6-mil poly')
    expect(vapor?.detail).toContain('+10% seam laps')
    expect(WASTE_RE.test(vapor?.detail ?? '')).toBe(false)
    // net preservation, whole-compose: no factor row's quantity is a
    // waste-scaled figure — the lumber pcs columns are integers (counts)
    for (const r of stated.filter(isLumberPcs)) {
      expect(Number.isInteger(r.quantity)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// CMU face bury — takeoff truth (the painted-host z-fight fix, 2026-08-23)
// ---------------------------------------------------------------------------

import { cmuWall } from './cmu'

describe('CMU face bury — count/length takeoff rows are bury-independent', () => {
  // The bury shrinks block DEPTH only; blocks/mortar/grout/rebar book by
  // count and long-dim, so these rows are pinned to the exact values the
  // PRE-BURY engine produced (captured at base 1719674 on this wall). The
  // one row that legitimately moves is the CONCRETE pour (bond beam):
  // pours book yd³ from member volume (S4 member-truth) — its net still
  // prints 0.1 yd³ here, but the +5% BUY figure drops 0.2 → 0.1 and gains
  // the display-collapse note. Enumerated in
  // docs/plans/CMU-BURY-EXPECTED-DIFF.md.
  const wall: WallSlice = {
    id: 'w1',
    start: [0, 0],
    end: [4, 0],
    length: 4,
    dir: [1, 0],
    thickness: 0.1, // the host default — the prod flicker configuration
    height: 2.4384,
    exterior: true,
    openings: [],
    curved: false,
  }
  const rows = computeTakeoff(cmuWall(wall, DEFAULT_SPEC), [])
  const row = (item: string) => rows.find((r) => r.item === item)

  test('block / mortar / grout / rebar rows byte-equal to the pre-bury capture', () => {
    expect(row('CMU block')?.quantity).toBe(115)
    expect(row('CMU block')?.unit).toBe('pcs')
    expect(row('CMU block')?.detail).toBe('8x8x16 running bond')
    expect(row('Mortar (Type S)')?.quantity).toBe(6)
    expect(row('Grout')?.quantity).toBe(0.5)
    expect(row('Grout')?.detail).toBe('44 reinforced cells (R606.12)')
    expect(row('Rebar')?.quantity).toBe(43.8)
    expect(row('Rebar')?.detail).toBe('5 bars, laps not included')
  })

  test('the bond-beam pour follows the buried member volume (S4 member-truth)', () => {
    const pour = row('Concrete')
    expect(pour?.detail).toContain('lintels/beams')
    expect(pour?.quantity).toBe(0.1) // net unchanged at display rounding
    // Pre-bury the buy printed '≈ 0.2 yd³'; the buried beam is 10% slimmer
    // and the ceiled buy meets the net at the 0.1 yd³ batch step.
    expect(pour?.detail).toContain('≈ 0.1 yd³')
    expect(pour?.detail).toContain('display rounding')
  })
})
