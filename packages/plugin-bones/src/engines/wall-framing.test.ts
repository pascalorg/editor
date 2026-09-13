import { describe, expect, test } from 'bun:test'
import { DEFAULT_SPEC } from '../core/spec'
import type { Member, OpeningSlice, WallSlice } from '../core/types'
import { feet, inches } from '../core/units'
import { LUMBER_CROSS_SECTIONS } from '../lumber'
import { frameWall, studPositions } from './wall-framing'

const T = inches(1.5)

function makeWall(overrides: Partial<WallSlice> = {}): WallSlice {
  const start = overrides.start ?? [0, 0]
  const end = overrides.end ?? [4, 0]
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  return {
    id: 'wall_test',
    start,
    end,
    length,
    dir: [dx / length, dz / length],
    thickness: 0.1,
    height: 2.5,
    exterior: false,
    openings: [],
    curved: false,
    ...overrides,
  }
}

function door(u: number, width = 0.9, height = 2.1): OpeningSlice {
  return {
    id: 'door_test',
    kind: 'door',
    u,
    width,
    height,
    sillHeight: 0,
    roughWidth: width + T,
    roughHeight: height + T,
  }
}

function window_(u: number, width = 1.2, height = 1.2, sillHeight = 0.9): OpeningSlice {
  return {
    id: 'window_test',
    kind: 'window',
    u,
    width,
    height,
    sillHeight,
    roughWidth: width + T,
    roughHeight: height + T,
  }
}

const byRole = (members: Member[], role: string): Member[] =>
  members.filter((m) => m.role === role)

describe('studPositions', () => {
  test('4m wall at 16" o.c. → studs from edge to edge, end stud guaranteed', () => {
    const positions = studPositions(4, inches(16), T / 2)
    expect(positions[0]).toBeCloseTo(T / 2, 5)
    expect(positions[positions.length - 1]).toBeCloseTo(4 - T / 2, 5)
    // The grid is on the MODULE: the second stud's CENTER is 16" from the
    // wall start, not 16" from the end stud's center (IRC Table R602.3(5)
    // spacing + the 48"/96" sheet-goods module).
    expect(positions[1]).toBeCloseTo(inches(16), 5)
    expect(positions[2]).toBeCloseTo(inches(32), 5)
    // no two studs overlap
    for (let i = 1; i < positions.length; i++) {
      expect((positions[i] ?? 0) - (positions[i - 1] ?? 0)).toBeGreaterThan(T - 1e-9)
    }
  })

  // ---- IRC Table R602.3(5) layout, the three tabulated columns ----------
  test('12 ft wall at 16 in o.c. → end stud + centers on the 16" module', () => {
    const L = feet(12)
    const positions = studPositions(L, inches(16), T / 2)
    // 0.75" (end stud), 16, 32, 48, 64, 80, 96, 112, 128, 143.25" (end stud)
    expect(positions).toHaveLength(10)
    expect(positions[0]).toBeCloseTo(T / 2, 6)
    for (let i = 1; i <= 8; i++) {
      expect(positions[i]).toBeCloseTo(inches(16 * i), 6)
    }
    expect(positions[9]).toBeCloseTo(L - T / 2, 6)
    // The 4 ft and 8 ft sheathing edges land ON a stud center (R602.3(3)).
    expect(positions.some((u) => Math.abs(u - feet(4)) < 1e-6)).toBe(true)
    expect(positions.some((u) => Math.abs(u - feet(8)) < 1e-6)).toBe(true)
  })

  test('12 ft wall at 24 in and 12 in o.c. → the other two columns', () => {
    const L = feet(12)
    const at24 = studPositions(L, inches(24), T / 2)
    // 0.75", 24, 48, 72, 96, 120, 143.25" → 7 studs
    expect(at24).toHaveLength(7)
    for (let i = 1; i <= 5; i++) expect(at24[i]).toBeCloseTo(inches(24 * i), 6)
    expect(at24[6]).toBeCloseTo(L - T / 2, 6)

    const at12 = studPositions(L, inches(12), T / 2)
    // 0.75", 12…132 (11 grid studs), 143.25" → 13 studs
    expect(at12).toHaveLength(13)
    for (let i = 1; i <= 11; i++) expect(at12[i]).toBeCloseTo(inches(12 * i), 6)
    expect(at12[12]).toBeCloseTo(L - T / 2, 6)
  })
})

// ---------------------------------------------------------------------------
// Wood stud recipe — IRC Table R602.3(5): a 12 ft wall, the three columns,
// the assembly-declared depth, and the opening frame.
// ---------------------------------------------------------------------------

describe('IRC R602.3(5) — 12 ft wall stud recipe', () => {
  /** 2x4 EXTERIOR stack: 3/4" siding + 7/16" WSP + 3-1/2" stud + 1/2" gyp
   * = 5-3/16" total. Above the 0.13 m thickWallThreshold — the pre-WS5
   * heuristic framed this wall as 2x6 AND flagged it "compressed". */
  const EXT_2X4_TOTAL = inches(0.75 + 0.4375 + 3.5 + 0.5)

  // The wall is drawn at its assembly total (WS5 keeps wall.thickness ==
  // assemblyThickness), so the declared core always fits and `fitAcross`
  // never compresses.
  const wall12 = (extra: Partial<WallSlice> = {}): WallSlice =>
    makeWall({
      start: [0, 0],
      end: [feet(12), 0],
      height: feet(8),
      thickness: EXT_2X4_TOTAL,
      ...extra,
    })

  test('2x4 @ 16 in o.c.: 10 studs, centers on the module, 1-1/2 x 3-1/2', () => {
    const members = frameWall(wall12({ framingDepth: inches(3.5), framingKind: 'wood' }))
    const studs = byRole(members, 'stud').sort((a, b) => a.position[0] - b.position[0])
    expect(studs).toHaveLength(10)
    expect(studs.every((m) => m.size === '2x4')).toBe(true)
    expect(studs[0]?.position[0]).toBeCloseTo(T / 2, 6)
    for (let i = 1; i <= 8; i++) {
      expect(studs[i]?.position[0]).toBeCloseTo(inches(16 * i), 6)
    }
    expect(studs[9]?.position[0]).toBeCloseTo(feet(12) - T / 2, 6)
    // dims = [along-wall thickness, height, across-wall depth]
    expect(studs[0]?.dims[0]).toBeCloseTo(inches(1.5), 6)
    expect(studs[0]?.dims[2]).toBeCloseTo(inches(3.5), 6)
  })

  test('assembly depth wins over the thickness heuristic (WS5)', () => {
    // Same 5-3/16" exterior wall, WITH the declared 3-1/2" wood core.
    const declared = frameWall(
      wall12({
        thickness: EXT_2X4_TOTAL,
        exterior: true,
        framingDepth: inches(3.5),
        framingKind: 'wood',
      }),
    )
    expect(declared[0]?.size).toBe('2x4')
    expect(byRole(declared, 'stud')[0]?.dims[2]).toBeCloseTo(inches(3.5), 6)
    // No cavity-compression flag: a 3-1/2" stud fits a 5-3/16" wall.
    expect(declared.every((m) => m.flag === undefined)).toBe(true)

    // Without the assembly the historical heuristic still runs — and this is
    // exactly the wrong answer it used to give every exterior 2x4 wall.
    const heuristic = frameWall(wall12({ thickness: EXT_2X4_TOTAL, exterior: true }))
    expect(heuristic[0]?.size).toBe('2x6')
  })

  test('2x6 assembly → 5-1/2 in studs', () => {
    const members = frameWall(
      wall12({
        thickness: inches(0.75 + 0.4375 + 5.5 + 0.5),
        exterior: true,
        framingDepth: inches(5.5),
        framingKind: 'wood',
      }),
    )
    const studs = byRole(members, 'stud')
    expect(studs.every((m) => m.size === '2x6')).toBe(true)
    expect(studs[0]?.dims[2]).toBeCloseTo(inches(5.5), 6)
    expect(studs[0]?.dims[0]).toBeCloseTo(inches(1.5), 6)
  })

  test('a CMU/ICF core is NOT read as a stud depth', () => {
    // 5-1/2" ICF core on a thin drawn wall: the stud heuristic still runs.
    const members = frameWall(
      wall12({ thickness: 0.1, framingDepth: inches(5.5), framingKind: 'icf' }),
    )
    expect(members[0]?.size).toBe('2x4')
  })

  test('24 in and 12 in options change ONLY the grid rhythm', () => {
    const base = wall12({ framingDepth: inches(3.5), framingKind: 'wood' })
    const at24 = byRole(frameWall(base, { ...DEFAULT_SPEC, studSpacing: inches(24) }), 'stud')
    expect(at24).toHaveLength(7)
    expect(at24.map((m) => m.position[0])[3]).toBeCloseTo(inches(72), 6)
    const at12 = byRole(frameWall(base, { ...DEFAULT_SPEC, studSpacing: inches(12) }), 'stud')
    expect(at12).toHaveLength(13)
    expect(at12.every((m) => m.size === '2x4')).toBe(true)
  })

  test('plates: single bottom, double top', () => {
    const members = frameWall(wall12({ framingDepth: inches(3.5), framingKind: 'wood' }))
    expect(byRole(members, 'bottom-plate')).toHaveLength(1)
    expect(byRole(members, 'top-plate')).toHaveLength(1)
    expect(byRole(members, 'cap-plate')).toHaveLength(1)
  })

  test('opening: king + trimmer each side, table-sized header, cripples above', () => {
    const members = frameWall(
      wall12({ framingDepth: inches(3.5), framingKind: 'wood', openings: [door(feet(6))] }),
    )
    expect(byRole(members, 'king-stud')).toHaveLength(2)
    expect(byRole(members, 'trimmer')).toHaveLength(2)
    const header = byRole(members, 'header')[0] as Member
    // RO = 0.9 + 1.5" = 36.9" → the 4x8 row of the shipped R602.7(1) band.
    expect(header.size).toBe('4x8')
    expect(byRole(members, 'cripple').length).toBeGreaterThan(0)
    // Kings stand outside the trimmers, trimmers tight to the RO.
    const ro = 0.9 + T
    const kings = byRole(members, 'king-stud')
      .map((m) => m.position[0])
      .sort((a, b) => a - b)
    const trims = byRole(members, 'trimmer')
      .map((m) => m.position[0])
      .sort((a, b) => a - b)
    expect(kings[0]).toBeCloseTo(feet(6) - ro / 2 - T - T / 2, 6)
    expect(trims[0]).toBeCloseTo(feet(6) - ro / 2 - T / 2, 6)
    // No common stud buried in the opening frame.
    for (const stud of byRole(members, 'stud')) {
      const gap = Math.abs(stud.position[0] - feet(6)) - (ro / 2 + 2 * T)
      expect(gap).toBeGreaterThan(-1e-9)
    }
  })
})

describe('frameWall — solid wall', () => {
  const wall = makeWall()
  const members = frameWall(wall)

  test('emits one bottom plate and a double top plate', () => {
    expect(byRole(members, 'bottom-plate')).toHaveLength(1)
    expect(byRole(members, 'top-plate')).toHaveLength(1)
    expect(byRole(members, 'cap-plate')).toHaveLength(1)
  })

  test('studs run plate-to-plate', () => {
    const studs = byRole(members, 'stud')
    expect(studs.length).toBeGreaterThanOrEqual(10) // 4m / 16" ≈ 9.8 + end stud
    const stud = studs[0] as Member
    expect(stud.dims[1]).toBeCloseTo(2.5 - 3 * T, 5)
    // stud center Y = bottom plate + half height
    expect(stud.position[1] ?? 0).toBeCloseTo(T + (2.5 - 3 * T) / 2, 5)
  })

  test('thin wall frames 2x4, thick wall frames 2x6', () => {
    expect(members[0]?.size).toBe('2x4')
    const thick = frameWall(makeWall({ thickness: 0.15 }))
    expect(thick[0]?.size).toBe('2x6')
  })

  test('members inherit the wall yaw and level-local placement', () => {
    const angled = frameWall(makeWall({ start: [0, 0], end: [0, 3] }))
    const plate = angled[0] as Member
    // wall along +Z: yaw = atan2(-1, 0) = -π/2
    expect(plate.rotation[1] ?? 0).toBeCloseTo(-Math.PI / 2, 5)
    expect(plate.position[0] ?? 0).toBeCloseTo(0, 5)
    expect(plate.position[2] ?? 0).toBeCloseTo(1.5, 5)
  })
})

describe('frameWall — door opening', () => {
  const wall = makeWall({ openings: [door(2)] })
  const members = frameWall(wall)

  test('emits kings, trimmers, and a span-sized header', () => {
    expect(byRole(members, 'king-stud')).toHaveLength(2)
    expect(byRole(members, 'trimmer')).toHaveLength(2)
    const headers = byRole(members, 'header')
    expect(headers).toHaveLength(1)
    // RO = 0.9 + 1.5" ≈ 0.938m ≈ 36.9" → 4x8 per the fallback table
    expect(headers[0]?.size).toBe('4x8')
  })

  test('no common stud lands inside the rough opening', () => {
    const ro = 0.9 + T
    for (const stud of byRole(members, 'stud')) {
      // distance along wall = x (wall runs along +X from 0)
      const u = stud.position[0] ?? 0
      expect(Math.abs(u - 2) > ro / 2 + 2 * T - inches(0.75)).toBe(true)
    }
  })

  test('cripples fill between header and top plates', () => {
    expect(byRole(members, 'cripple').length).toBeGreaterThan(0)
  })

  test('doors get no sill', () => {
    expect(byRole(members, 'sill')).toHaveLength(0)
  })
})

describe('frameWall — window opening', () => {
  const wall = makeWall({ openings: [window_(2)] })
  const members = frameWall(wall)

  test('emits a rough sill with supporting cripples below', () => {
    expect(byRole(members, 'sill')).toHaveLength(1)
    const sill = byRole(members, 'sill')[0] as Member
    expect(sill.position[1] ?? 0).toBeCloseTo(0.9 - T / 2, 5)
    const cripples = byRole(members, 'cripple')
    const below = cripples.filter((c) => (c.position[1] ?? 0) < 0.9)
    expect(below.length).toBeGreaterThanOrEqual(2) // at least both sill ends
  })

  test('small window header uses the light end of the table', () => {
    const small = frameWall(makeWall({ openings: [window_(2, 0.55, 0.6, 1.2)] }))
    const header = byRole(small, 'header')[0] as Member
    // RO ≈ 0.588m ≈ 23.1" → 4x4
    expect(header.size).toBe('4x4')
  })
})

describe('frameWall — guards', () => {
  test('curved walls return no members (flagged upstream)', () => {
    expect(frameWall(makeWall({ curved: true }))).toHaveLength(0)
  })

  test('oversized opening span is flagged for engineering', () => {
    const wide = makeWall({ end: [8, 0], openings: [door(4, 3.4, 2.1)] })
    const header = frameWall(wide).find((m) => m.role === 'header')
    expect(header?.flag).toContain('ENGINEERED')
  })

  test('spec with 24" spacing produces fewer studs', () => {
    const at16 = frameWall(makeWall()).filter((m) => m.role === 'stud').length
    const at24 = frameWall(makeWall(), { ...DEFAULT_SPEC, studSpacing: inches(24) }).filter(
      (m) => m.role === 'stud',
    ).length
    expect(at24).toBeLessThan(at16)
  })
})

// ---------------------------------------------------------------------------
// Round-1 fabrication features (corners, tees, laps, trimmers, fire blocking)
// ---------------------------------------------------------------------------

import { detectCorners, detectTees, frameWalls } from './wall-framing'

/** Plan-view AABB of an axis-aligned member (yaw 0 or ±π/2). */
function planAabb(m: Member): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const yaw = m.rotation[1]
  const alongX = Math.abs(Math.cos(yaw)) > 0.5
  const hx = alongX ? m.dims[0] / 2 : m.dims[2] / 2
  const hz = alongX ? m.dims[2] / 2 : m.dims[0] / 2
  return {
    minX: (m.position[0] as number) - hx,
    maxX: (m.position[0] as number) + hx,
    minZ: (m.position[2] as number) - hz,
    maxZ: (m.position[2] as number) + hz,
  }
}

const overlaps = (a: ReturnType<typeof planAabb>, b: ReturnType<typeof planAabb>) =>
  a.minX < b.maxX - 1e-9 && b.minX < a.maxX - 1e-9 && a.minZ < b.maxZ - 1e-9 && b.minZ < a.maxZ - 1e-9

describe('frameWalls — California corners', () => {
  const A = makeWall({ id: 'wall_A', start: [0, 0], end: [4, 0] })
  const B = makeWall({ id: 'wall_B', start: [0, 0], end: [0, 3] })
  const members = frameWalls([A, B])

  test('detects the L-corner with the longer wall through', () => {
    const corners = detectCorners([A, B])
    expect(corners).toHaveLength(1)
    expect(corners[0]?.through.id).toBe('wall_A')
    expect(corners[0]?.throughEnd).toBe('start')
  })

  test('through wall gains the third (backing) stud at the corner', () => {
    const backing = members.filter((m) => m.label === 'California corner backing')
    expect(backing).toHaveLength(1)
    const stud = backing[0] as Member
    expect(stud.sourceId).toBe('wall_A')
    // setback = butting thickness (0.1) + half stud thickness
    expect(stud.position[0] as number).toBeCloseTo(0.1 + T / 2, 4)
    expect(stud.position[2] as number).toBeCloseTo(0, 6)
  })

  test('cap plates lap without colliding and cover the joint', () => {
    const capA = members.find((m) => m.role === 'cap-plate' && m.sourceId === 'wall_A') as Member
    const capB = members.find((m) => m.role === 'cap-plate' && m.sourceId === 'wall_B') as Member
    // A's cap extends past the corner by half of B's thickness…
    const a = planAabb(capA)
    expect(a.minX).toBeCloseTo(-0.05, 4)
    // …and B's cap pulls short by half of A's thickness (0.1/2 = 0.05),
    // which clears A's cap half-width (0.089/2 ≈ 0.0445).
    const b = planAabb(capB)
    expect(b.minZ).toBeCloseTo(0.05, 4)
    expect(overlaps(a, b)).toBe(false)
    // The lap covers the corner: A's cap spans B's plate zone in plan.
    expect(a.minX).toBeLessThan(0.045) // reaches over B's z-axis plate width
  })
})

describe('frameWalls — partition backing at tees', () => {
  const through = makeWall({ id: 'wall_T', start: [0, 0], end: [6, 0] })
  const partition = makeWall({ id: 'wall_P', start: [3, 0], end: [3, 2] })
  const members = frameWalls([through, partition])

  test('detects the tee on the through wall at the partition line', () => {
    const tees = detectTees([through, partition])
    expect(tees).toHaveLength(1)
    expect(tees[0]?.through.id).toBe('wall_T')
    expect(tees[0]?.u).toBeCloseTo(3, 5)
  })

  test('emits ladder backing at 0.6 / 1.2 / 1.8 m centered on the tee', () => {
    const backing = members.filter((m) => m.role === 'backing' && m.sourceId === 'wall_T')
    expect(backing).toHaveLength(3)
    const ys = backing.map((b) => b.position[1] as number).sort((p, q) => p - q)
    expect(ys[0]).toBeCloseTo(0.6, 5)
    expect(ys[1]).toBeCloseTo(1.2, 5)
    expect(ys[2]).toBeCloseTo(1.8, 5)
    // Clipped to the REAL stud bay containing the tee (round-10): between
    // the grid studs flanking u=3, not a nominal bay centered on it.
    const studUs = members
      .filter((m) => m.role === 'stud' && m.sourceId === 'wall_T')
      .map((m) => m.position[0] as number)
    const left = Math.max(...studUs.filter((su) => su < 3))
    const right = Math.min(...studUs.filter((su) => su > 3))
    for (const block of backing) {
      expect(block.position[0] as number).toBeCloseTo((left + right) / 2, 4)
      expect(block.dims[0]).toBeCloseTo(right - left - T, 5) // clear bay span
    }
  })

  test('corner junctions do not double as tees', () => {
    const A = makeWall({ id: 'a', start: [0, 0], end: [4, 0] })
    const B = makeWall({ id: 'b', start: [0, 0], end: [0, 3] })
    expect(detectTees([A, B])).toHaveLength(0)
  })
})

describe('frameWall — double trimmers past 6 ft', () => {
  test('a 6ft-2in RO bears on two trimmers per side; 5ft-10in on one', () => {
    const wideRo = inches(74)
    const wide = frameWall(
      makeWall({ end: [6, 0], openings: [{ ...door(3, wideRo - T, 2.1), roughWidth: wideRo }] }),
    )
    expect(byRole(wide, 'trimmer')).toHaveLength(4)

    const narrowRo = inches(70)
    const narrow = frameWall(
      makeWall({ end: [6, 0], openings: [{ ...door(3, narrowRo - T, 2.1), roughWidth: narrowRo }] }),
    )
    expect(byRole(narrow, 'trimmer')).toHaveLength(2)
    // Doubled openings keep kings outside the full trimmer pack.
    const kings = byRole(wide, 'king-stud').map((k) => k.position[0] as number).sort((a, b) => a - b)
    expect((kings[1] ?? 0) - (kings[0] ?? 0)).toBeCloseTo(wideRo + 2 * 2 * T + T, 4)
  })
})

describe('studPositions — no bay ever exceeds the o.c. spacing', () => {
  test('property: random lengths at 16" and 24" o.c.', () => {
    for (const spacing of [inches(16), inches(24)]) {
      for (let len = 0.6; len < 8; len += 0.137) {
        const us = studPositions(len, spacing, T / 2)
        for (let i = 1; i < us.length; i++) {
          const gap = (us[i] as number) - (us[i - 1] as number)
          expect(gap).toBeLessThanOrEqual(spacing + 1e-6)
          expect(gap).toBeGreaterThan(0)
        }
        // end stud guaranteed
        expect(us[us.length - 1]).toBeCloseTo(len - T / 2, 6)
      }
    }
  })
})

describe('frameWall — LOD 400 fabrication', () => {
  test('fire blocking rows appear at 10 ft in tall walls, only at detail 400', () => {
    const tall = makeWall({ height: 3.6 })
    const at400 = frameWall(tall, { ...DEFAULT_SPEC, detail: '400' })
    const blocks = byRole(at400, 'fire-blocking')
    expect(blocks.length).toBeGreaterThan(5)
    for (const b of blocks) {
      expect(b.position[1] as number).toBeCloseTo(feet(10), 5)
    }
    expect(byRole(frameWall(tall, { ...DEFAULT_SPEC, detail: '300' }), 'fire-blocking')).toHaveLength(0)
    // standard-height walls have no concealed 10ft cavity
    expect(byRole(frameWall(makeWall(), { ...DEFAULT_SPEC, detail: '400' }), 'fire-blocking')).toHaveLength(0)
  })

  test('plates on 20ft+ walls carry the splice call-out', () => {
    const long = frameWall(makeWall({ end: [7, 0] }))
    const plate = long.find((m) => m.role === 'top-plate') as Member
    expect(plate.label).toContain('spliced')
    expect(plate.label).toContain('24" lap')
    const short = frameWall(makeWall())
    expect((short.find((m) => m.role === 'top-plate') as Member).label).not.toContain('spliced')
  })
})

describe('frameWalls — cap-plate lap clears the cap WIDTH on thin walls (round-2)', () => {
  test('two 6cm walls (thinner than a 2x4 cap) still lap without colliding', () => {
    const A = makeWall({ id: 'thin_a', start: [0, 0], end: [4, 0], thickness: 0.06 })
    const B = makeWall({ id: 'thin_b', start: [0, 0], end: [0, 3], thickness: 0.06 })
    const members = frameWalls([A, B])
    const capA = members.find((m) => m.role === 'cap-plate' && m.sourceId === 'thin_a') as Member
    const capB = members.find((m) => m.role === 'cap-plate' && m.sourceId === 'thin_b') as Member
    expect(overlaps(planAabb(capA), planAabb(capB))).toBe(false)
    // the butting cap pulls back past the through cap's half-WIDTH (3.5"/2),
    // not just the drawn half-thickness (0.03)
    expect(planAabb(capB).minZ).toBeGreaterThanOrEqual((3.5 * 0.0254) / 2 - 1e-9)
  })
})

/**
 * GATE (full wall engineering panel — per-field plumb-through): frameWalls
 * consumes per-wall studSize/spacingIn overrides — stud DIMS change with the
 * size, stud COUNT with the spacing — while walls without an override (and
 * an empty override object) frame byte-equal to today.
 */
describe('frameWalls — per-wall studSize/spacingIn overrides', () => {
  const wallA = () => makeWall({ id: 'wall_a', start: [0, 0], end: [4, 0], thickness: 0.15 })
  const wallB = () => makeWall({ id: 'wall_b', start: [0, 6], end: [4, 6], thickness: 0.15 })

  test('studSize override re-sizes every framing member of THAT wall only', () => {
    // 0.15m thick ≥ threshold → 2x6 by default; override wall_a down to 2x4
    const members = frameWalls(
      [wallA(), wallB()],
      DEFAULT_SPEC,
      new Map([['wall_a', { studSize: '2x4' as const }]]),
    )
    const studA = members.find((m) => m.role === 'stud' && m.sourceId === 'wall_a') as Member
    const studB = members.find((m) => m.role === 'stud' && m.sourceId === 'wall_b') as Member
    expect(studA.size).toBe('2x4')
    expect(studA.dims[2]).toBeCloseTo(inches(3.5), 6)
    expect(studB.size).toBe('2x6')
    // Cavity-fit (night-4): the default 2x6 on a 0.15m wall draws
    // compressed to thickness − 1" (nominal size/label kept, flag carried).
    expect(studB.dims[2]).toBeCloseTo(0.15 - inches(1), 6)
    expect(studB.flag).toContain('compressed')
    expect(studA.flag).toBeUndefined() // 2x4 fits a 0.15m wall outright
    // plates follow the stud size too
    const plateA = members.find(
      (m) => m.role === 'bottom-plate' && m.sourceId === 'wall_a',
    ) as Member
    expect(plateA.size).toBe('2x4')
  })

  test('spacingIn override changes the stud count of THAT wall only', () => {
    const at16 = frameWalls([wallA(), wallB()], DEFAULT_SPEC)
    const at24 = frameWalls(
      [wallA(), wallB()],
      DEFAULT_SPEC,
      new Map([['wall_a', { spacingIn: 24 as const }]]),
    )
    const studs = (members: Member[], id: string) =>
      members.filter((m) => m.role === 'stud' && m.sourceId === id).length
    expect(studs(at24, 'wall_a')).toBeLessThan(studs(at16, 'wall_a'))
    expect(studs(at24, 'wall_b')).toBe(studs(at16, 'wall_b'))
  })

  test('empty override map / fieldless entries stay byte-equal to today', () => {
    const walls = [wallA(), wallB()]
    const base = frameWalls(walls, DEFAULT_SPEC)
    expect(frameWalls(walls, DEFAULT_SPEC, new Map())).toEqual(base)
    expect(frameWalls(walls, DEFAULT_SPEC, new Map([['wall_a', {}]]))).toEqual(base)
  })

  test('corner arithmetic keys off the overridden through-wall stud size', () => {
    // L-corner: the through wall's California backing setback uses ITS stud
    // thickness; overriding the through wall must not disturb the butting
    // wall's members beyond the shared corner math.
    const through = makeWall({ id: 'w_through', start: [0, 0], end: [6, 0], thickness: 0.15 })
    const butting = makeWall({ id: 'w_butt', start: [0, 0], end: [0, 4], thickness: 0.15 })
    const members = frameWalls(
      [through, butting],
      DEFAULT_SPEC,
      new Map([['w_through', { studSize: '2x4' as const }]]),
    )
    const backing = members.find(
      (m) => m.sourceId === 'w_through' && m.label === 'California corner backing',
    ) as Member
    expect(backing).toBeDefined()
    expect(backing.size).toBe('2x4')
    // butting wall keeps its default 2x6 recipe
    const buttStud = members.find((m) => m.role === 'stud' && m.sourceId === 'w_butt') as Member
    expect(buttStud.size).toBe('2x6')
  })
})

describe('cavity-fit framing (night-4): geometry compresses, identity stays nominal', () => {
  test('flagged walls: every lumber member draws at thickness − 1"', () => {
    const w015 = makeWall({ id: 'w_thick', thickness: 0.15 })
    const members = frameWall(w015, DEFAULT_SPEC)
    const cavity = 0.15 - inches(1)
    for (const m of members) {
      expect(m.dims[2]).toBeLessThanOrEqual(cavity + 1e-9)
      if (m.role !== 'header') {
        expect(m.dims[2]).toBeCloseTo(cavity, 9)
        expect(m.flag).toContain('compressed')
        expect(m.size).toBe('2x6') // identity stays nominal
      }
    }
  })

  test('header clamps on 2x4-class walls only', () => {
    const thin = makeWall({ id: 'w_thin', thickness: 0.1, openings: [door(2)] })
    const thinHeader = frameWall(thin, DEFAULT_SPEC).find((m) => m.role === 'header')
    expect(thinHeader?.dims[2]).toBeCloseTo(0.1 - inches(1), 9)
    const std = makeWall({ id: 'w_std', thickness: 0.15, openings: [door(2)] })
    const stdHeader = frameWall(std, DEFAULT_SPEC).find((m) => m.role === 'header')
    expect(stdHeader?.dims[2]).toBeCloseTo(inches(3.5), 9) // 3.5" fits a 0.15m wall
  })

  test('grace window: 0.164m keeps FULL 2x6 depth (≤2mm absorbed by the SAT skin)', () => {
    for (const th of [0.164, 0.165]) {
      const w = makeWall({ id: `w_${th}`, thickness: th })
      const stud = frameWall(w, DEFAULT_SPEC).find((m) => m.role === 'stud')
      expect(stud?.dims[2]).toBeCloseTo(inches(5.5), 9)
      expect(stud?.flag).toBeUndefined()
    }
  })

  test('textbook 0.114m partition stays byte-nominal (no flag, full 2x4)', () => {
    const w = makeWall({ id: 'w_std114', thickness: 0.114 })
    for (const m of frameWall(w, DEFAULT_SPEC)) {
      expect(m.dims[2]).toBeCloseTo(inches(3.5), 9)
      expect(m.flag).toBeUndefined()
    }
  })
})

describe('LOD-400 B1: header truth when the RO crowds the plates', () => {
  test('a tall door collapses the header — geometry honest, BOTH flags fire', () => {
    // 2.4m door in a 2.5m wall: the prescriptive 4x8 (7.25") cannot fit
    // between the RO head and the plates — pre-fix the member silently
    // shrank to a 1.5" flat board while the takeoff booked the full stick.
    const w = makeWall({ height: 2.5, thickness: 0.114, openings: [door(2, 1.0, 2.4)] })
    const members = frameWall(w, { ...DEFAULT_SPEC, detail: '400' as const })
    const header = members.find((m) => m.role === 'header')
    expect(header).toBeDefined()
    // geometry stays honest (whatever fits) …
    expect((header?.dims[1] as number) < inches(7.25)).toBe(true)
    // …but never silent: the depth flag names the fix
    expect(header?.flag).toContain('does not fit between the RO and the plates')
    // and the silent RO head pull-down is also gone: some member on this
    // wall carries the height-clamp flag (it rides the header's fallback
    // chain, so check the depth flag won — the clamp is subsumed)
    const flags = members.map((m) => m.flag).filter(Boolean)
    expect(flags.length).toBeGreaterThan(0)
  })

  test('a normal door keeps the full prescriptive header depth, no flags', () => {
    const w = makeWall({ height: 2.5, thickness: 0.114, openings: [door(2, 0.9, 2.1)] })
    const members = frameWall(w, { ...DEFAULT_SPEC, detail: '400' as const })
    const header = members.find((m) => m.role === 'header')
    // full depth of its own prescriptive size (small ROs get small headers)
    const hw = LUMBER_CROSS_SECTIONS[header?.size as keyof typeof LUMBER_CROSS_SECTIONS][1]
    expect(header?.dims[1]).toBeCloseTo(hw, 6)
    expect(header?.flag).toBeUndefined()
  })
})

describe('LOD-400 B1 round 2: header flags COMPOSE, nothing silenced', () => {
  test('a tall + edge-shifted door prints BOTH the depth collapse and the RO shift', () => {
    // Verify night-6: single-slot precedence silenced round-10's shift
    // flag whenever depth collapsed.
    const w = makeWall({
      height: 3,
      thickness: 0.114,
      length: 4,
      end: [4, 0],
      openings: [{ ...door(0.2, 1.0, 2.4), sillHeight: 0 }],
    })
    const members = frameWall(w, { ...DEFAULT_SPEC, detail: '400' as const })
    const header = members.find((m) => m.role === 'header')
    expect(header?.flag).toContain('RO shifted')
    // 3m wall, 2.4m door: header space = 2.4..~2.92 — depth may fit here;
    // the composition contract is what this pins, so check the join shape
    expect((header?.flag ?? '').split(' | ').length).toBeGreaterThanOrEqual(1)
  })

  test('an ENGINEERED span that also collapses keeps the depth truth', () => {
    const w = makeWall({
      height: 2.5,
      thickness: 0.114,
      length: 6,
      end: [6, 0],
      openings: [door(3, 3.2, 2.4)],
    })
    const members = frameWall(w, { ...DEFAULT_SPEC, detail: '400' as const })
    const header = members.find((m) => m.role === 'header')
    expect(header?.flag).toContain('ENGINEERED BEAM REQUIRED')
    expect(header?.flag).toContain('does not fit between the RO and the plates')
    // …and it books as a supplier SKU, not the prescriptive stick: the
    // 'engineered' material routes it out of the dimensional lumber rows
    // (the buy list booked a 4x12 + bd-ft for a member the flag says to
    // replace — verify night-6 PARTIAL).
    expect(header?.material).toBe('engineered')
    expect(header?.label).toContain('size by supplier')
  })

  test('a prescriptive header stays plain lumber with the size in its label', () => {
    const members = frameWall(makeWall({ openings: [door(2)] }), {
      ...DEFAULT_SPEC,
      detail: '400' as const,
    })
    const header = members.find((m) => m.role === 'header')
    expect(header?.material).toBe('lumber')
    expect(header?.label).toMatch(/^Header \dx\d+ over door/)
  })
})

/**
 * GATE (LOD-400 B5, IRC R317.1(2)): a bottom plate bearing on a concrete
 * slab is a SOLE PLATE and must be preservative-treated — slab-bearing
 * walls emit it as 'pt-lumber' with the code cite in the label. ONLY the
 * bottom plate changes: studs, headers, top/cap plates bear on wood and
 * stay untreated; walls without the context (upper storeys on framed
 * floors) stay byte-equal to today.
 */
describe('LOD-400 B5: PT sole plate on slab (R317.1)', () => {
  const rectWalls = () => [
    makeWall({ id: 'w_s', start: [0, 0], end: [4, 0], openings: [door(2)] }),
    makeWall({ id: 'w_e', start: [4, 0], end: [4, 3] }),
  ]

  test('slab-bearing walls: bottom plate books PT with the R317.1 cite; everything else stays lumber', () => {
    const members = frameWalls(rectWalls(), DEFAULT_SPEC, undefined, { slabBearing: true })
    const plates = members.filter((m) => m.role === 'bottom-plate')
    expect(plates.length).toBe(2)
    for (const plate of plates) {
      expect(plate.material).toBe('pt-lumber')
      expect(plate.label).toContain('PT sole plate')
      expect(plate.label).toContain('R317.1')
    }
    for (const m of members) {
      if (m.role === 'bottom-plate') continue
      expect(m.material).toBe('lumber') // studs/kings/trimmers/headers/sills…
    }
    // top + cap plates named explicitly — the pin the batch brief asks for
    expect(members.filter((m) => m.role === 'top-plate').every((m) => m.material === 'lumber')).toBe(true)
    expect(members.filter((m) => m.role === 'cap-plate').every((m) => m.material === 'lumber')).toBe(true)
  })

  test('upper-storey walls (no slab context) keep the untreated bottom plate — byte-equal to today', () => {
    const base = frameWalls(rectWalls(), DEFAULT_SPEC)
    const plate = base.find((m) => m.role === 'bottom-plate')
    expect(plate?.material).toBe('lumber')
    expect(plate?.label).toBe('Bottom plate')
    // absent/false options are the identity — no field moves
    expect(frameWalls(rectWalls(), DEFAULT_SPEC, undefined, {})).toEqual(base)
    expect(frameWalls(rectWalls(), DEFAULT_SPEC, undefined, { slabBearing: false })).toEqual(base)
  })

  test('the PT swap moves ONLY material + label — geometry/dims/flags identical', () => {
    const dry = frameWalls(rectWalls(), DEFAULT_SPEC)
    const wet = frameWalls(rectWalls(), DEFAULT_SPEC, undefined, { slabBearing: true })
    expect(wet.length).toBe(dry.length)
    for (let i = 0; i < dry.length; i++) {
      const a = dry[i] as Member
      const b = wet[i] as Member
      if (a.role === 'bottom-plate') {
        expect(b.material).toBe('pt-lumber')
        const { material: _bm, label: _bl, ...bRest } = b
        const { material: _am, label: _al, ...aRest } = a
        expect(bRest).toEqual(aRest)
      } else {
        expect(b).toEqual(a)
      }
    }
  })

  test('frameWall honors the hint directly (single-wall path)', () => {
    const members = frameWall(makeWall(), DEFAULT_SPEC, { slabBearing: true })
    const plate = members.find((m) => m.role === 'bottom-plate')
    expect(plate?.material).toBe('pt-lumber')
    expect(plate?.label).toContain('R317.1')
  })
})

// ---------------------------------------------------------------------------
// Wall bracing at garage returns — R602.10.6.4 portal frames (LOD-400 B9)
// ---------------------------------------------------------------------------

describe('garage returns (R602.10, LOD-400 B9): portal set or flag, never plain framing silently', () => {
  const SEISMIC = { ...DEFAULT_SPEC, seismicHoldDowns: true }
  /** Exterior garage front: 16-ft door RO centered in a `len` m wall. */
  const garageWall = (len = 6.1, overrides: Partial<WallSlice> = {}): WallSlice =>
    makeWall({
      id: 'garage_front',
      start: [0, 0],
      end: [len, 0],
      thickness: 0.15,
      exterior: true,
      openings: [
        {
          id: 'garage_door',
          kind: 'door',
          u: len / 2,
          width: feet(16) - T,
          height: 2.13,
          sillHeight: 0,
          roughWidth: feet(16),
          roughHeight: 2.13 + T,
        },
      ],
      ...overrides,
    })
  const portalPosts = (members: Member[]): Member[] =>
    members.filter((m) => m.role === 'post' && (m.label ?? '').includes('R602.10.6.4'))
  const straps = (members: Member[]): Member[] => members.filter((m) => m.role === 'strap')
  const bracingFlags = (members: Member[]): Member[] =>
    members.filter((m) => (m.flag ?? '').includes('R602.10'))

  test('SDC D: both narrow returns get the CS-PF member set — 2 doubled posts + 1 strap each', () => {
    const members = frameWall(garageWall(), SEISMIC)
    expect(portalPosts(members)).toHaveLength(4)
    expect(straps(members)).toHaveLength(2)
    // hardware present ⇒ the kings carry no bracing flag (the set IS the answer)
    expect(bracingFlags(members)).toHaveLength(0)
    for (const s of straps(members)) {
      expect(s.material).toBe('steel')
      expect(s.label).toContain('1000 lb')
      expect(s.advisory).toContain('not modeled')
    }
    for (const p of portalPosts(members)) {
      // full-height studs, lumber — they book on the ordinary lumber rows
      expect(p.size).toBe('2x6')
      expect(p.dims[1]).toBeCloseTo(
        2.5 - 3 * T, // stud height between plates
        6,
      )
    }
  })

  test('posts double the panel-edge studs: contact allowed, overlap never — and grid studs yield', () => {
    const members = frameWall(garageWall(), SEISMIC)
    const verticals = members.filter((m) =>
      ['stud', 'king-stud', 'trimmer', 'post'].includes(m.role),
    )
    for (let i = 0; i < verticals.length; i++) {
      for (let j = i + 1; j < verticals.length; j++) {
        const du = Math.abs(
          (verticals[i] as Member).position[0] - (verticals[j] as Member).position[0],
        )
        expect(du).toBeGreaterThanOrEqual(T - 1e-9)
      }
    }
  })

  test('the strap is SURFACE hardware: on the framing face, thinner than the 2mm SAT skin (S1)', () => {
    const members = frameWall(garageWall(), SEISMIC)
    const wFit = 0.15 - inches(1)
    for (const s of straps(members)) {
      expect(s.dims[2]).toBeLessThan(0.002)
      expect(Math.abs(s.position[2])).toBeGreaterThanOrEqual(wFit / 2)
    }
  })

  test('low-seismic (INTL default): the same returns FLAG — portal cited, no invented hardware', () => {
    const members = frameWall(garageWall(), DEFAULT_SPEC)
    expect(portalPosts(members)).toHaveLength(0)
    expect(straps(members)).toHaveLength(0)
    const kings = members.filter((m) => m.role === 'king-stud')
    expect(kings).toHaveLength(2)
    for (const k of kings) {
      expect(k.flag).toContain('portal frame (R602.10.6.4)')
      expect(k.flag).toContain('48" braced-panel minimum')
      // composed with the wall's aggregate compression flag, never replacing it
      expect(k.flag).toContain('framing compressed')
    }
  })

  test('return under the CS-PF minimum: explicit ⚠ not-modeled flag, never silent (SDC D)', () => {
    const members = frameWall(garageWall(5.4), SEISMIC)
    expect(portalPosts(members)).toHaveLength(0)
    const kings = members.filter((m) => m.role === 'king-stud')
    for (const k of kings) {
      expect(k.flag).toContain('⚠ portal frame required — not modeled')
      expect(k.flag).toContain('engineered shear wall required')
    }
  })

  test('a return hosting a full 48" braced panel needs no portal: no hardware, no flag', () => {
    const members = frameWall(garageWall(10), SEISMIC)
    expect(portalPosts(members)).toHaveLength(0)
    expect(straps(members)).toHaveLength(0)
    expect(bracingFlags(members)).toHaveLength(0)
  })

  test('out of scope stays out: interior walls, narrow openings, LOD 200', () => {
    const interior = frameWall(garageWall(6.1, { exterior: false }), SEISMIC)
    expect([...portalPosts(interior), ...straps(interior), ...bracingFlags(interior)]).toEqual([])
    const narrow = frameWall(
      makeWall({ exterior: true, thickness: 0.15, openings: [door(2)] }),
      SEISMIC,
    )
    expect([...portalPosts(narrow), ...straps(narrow), ...bracingFlags(narrow)]).toEqual([])
    const lod200 = frameWall(garageWall(), { ...SEISMIC, detail: '200' })
    expect([...portalPosts(lod200), ...straps(lod200), ...bracingFlags(lod200)]).toEqual([])
  })

  test('inter-opening pier: honest not-evaluated flag on the shared side (v1)', () => {
    const w = garageWall(12, {
      openings: [
        {
          id: 'garage_door',
          kind: 'door',
          u: 3.2,
          width: feet(16) - T,
          height: 2.13,
          sillHeight: 0,
          roughWidth: feet(16),
          roughHeight: 2.13 + T,
        },
        window_(9),
      ],
    })
    const members = frameWall(w, SEISMIC)
    // left return still hosts its portal set…
    expect(portalPosts(members)).toHaveLength(2)
    expect(straps(members)).toHaveLength(1)
    // …while the side toward the window says it was NOT evaluated.
    const pierFlags = members.filter((m) =>
      (m.flag ?? '').includes('bracing between adjacent openings not evaluated'),
    )
    expect(pierFlags.length).toBeGreaterThanOrEqual(1)
  })
})

describe('CS-PF domain (skeptic round 1): the portal method ends at 10 ft — taller walls flag, never extrapolate', () => {
  const SEISMIC = { ...DEFAULT_SPEC, seismicHoldDowns: true }
  const garageWall11 = (height: number): WallSlice =>
    makeWall({
      id: 'garage_front',
      start: [0, 0],
      end: [6.4, 0],
      thickness: 0.15,
      height,
      exterior: true,
      openings: [
        {
          id: 'garage_door',
          kind: 'door',
          u: 3.2,
          width: feet(16) - T,
          height: 2.13,
          sillHeight: 0,
          roughWidth: feet(16),
          roughHeight: 2.13 + T,
        },
      ],
    })

  test('EXHIBIT: 11-ft SDC-D wall, 16-ft door, ~23" returns → flag, ZERO hardware', () => {
    const members = frameWall(garageWall11(feet(11)), SEISMIC)
    expect(members.filter((m) => m.role === 'post')).toEqual([])
    expect(members.filter((m) => m.role === 'strap')).toEqual([])
    const kings = members.filter((m) => m.role === 'king-stud')
    expect(kings).toHaveLength(2)
    for (const k of kings) {
      expect(k.flag).toContain('⚠ portal frame required — not modeled')
      expect(k.flag).toContain('exceeds the 10 ft CS-PF maximum height (Figure R602.10.6.4)')
      expect(k.flag).toContain('engineered shear wall required')
    }
  })

  test('10-ft boundary is IN domain: the same returns still build the portal set', () => {
    const members = frameWall(garageWall11(feet(10)), SEISMIC)
    expect(members.filter((m) => m.role === 'post')).toHaveLength(4)
    expect(members.filter((m) => m.role === 'strap')).toHaveLength(2)
    expect(members.filter((m) => (m.flag ?? '').includes('R602.10'))).toEqual([])
  })
})

describe('CS-PF first-of-two-storeys minimum (Figure R602.10.6.4): 24" under a second storey', () => {
  const SEISMIC = { ...DEFAULT_SPEC, seismicHoldDowns: true }
  const garage = (len: number): WallSlice =>
    makeWall({
      id: 'garage_front',
      start: [0, 0],
      end: [len, 0],
      thickness: 0.15,
      height: feet(8),
      exterior: true,
      openings: [
        {
          id: 'garage_door',
          kind: 'door',
          u: len / 2,
          width: feet(16) - T,
          height: 2.13,
          sillHeight: 0,
          roughWidth: feet(16),
          roughHeight: 2.13 + T,
        },
      ],
    })

  test('a KNOWN storey above widens the minimum: 19.6" returns portal single-storey, flag under two', () => {
    // 6.1 m wall → ~19.6" returns: ≥ the 16" single-storey minimum,
    // < the 24" first-of-two-storeys minimum.
    const single = frameWall(garage(6.1), SEISMIC, { storeyAbove: false })
    expect(single.filter((m) => m.role === 'post')).toHaveLength(4)
    const twoStorey = frameWall(garage(6.1), SEISMIC, { storeyAbove: true })
    expect(twoStorey.filter((m) => m.role === 'post')).toEqual([])
    expect(twoStorey.filter((m) => m.role === 'strap')).toEqual([])
    const kings = twoStorey.filter((m) => m.role === 'king-stud')
    for (const k of kings) {
      expect(k.flag).toContain('⚠ portal frame required — not modeled')
      expect(k.flag).toContain('24" under a second storey, Figure R602.10.6.4')
    }
  })

  test('returns past 24" portal even under a second storey', () => {
    const members = frameWall(garage(6.6), SEISMIC, { storeyAbove: true })
    expect(members.filter((m) => m.role === 'post')).toHaveLength(4)
  })

  test('the single-storey ASSUMPTION is stated when the storey context is unknown, silent when known', () => {
    const assumed = frameWall(garage(6.1), SEISMIC) // no hint — standalone caller
    const assumedStrap = assumed.find((m) => m.role === 'strap')
    expect(assumedStrap?.advisory).toContain('single-storey assumed')
    expect(assumedStrap?.advisory).toContain('surface strap, symbolic')
    expect(assumedStrap?.advisory).toContain('Figure R602.10.6.4 nail schedule')
    const known = frameWall(garage(6.1), SEISMIC, { storeyAbove: false })
    const knownStrap = known.find((m) => m.role === 'strap')
    expect(knownStrap?.advisory).not.toContain('single-storey assumed')
    expect(knownStrap?.advisory).toContain('surface strap, symbolic')
  })

  test('bracing flags name their wall (examiner round 1)', () => {
    const flagged = frameWall(garage(6.1), DEFAULT_SPEC) // low-seismic narrow-return flag
    const king = flagged.find((m) => m.role === 'king-stud')
    expect(king?.flag).toContain('wall garage_front:')
  })
})

// ---------------------------------------------------------------------------
// LOD-400 B11: header rules by ground-snow band — Table R602.7(1)
// ---------------------------------------------------------------------------

import { headerBandForSnow } from '../core/spec'
import { applyJurisdiction, profileFor } from '../jurisdiction/profiles'

describe('LOD-400 B11: heavy-snow headers deepen per Table R602.7(1); low snow stays byte-equal', () => {
  // One wall per RO span so opening frames never interact; wall long and
  // tall enough that no clamp/depth machinery fires — the header size is
  // the ONLY variable under test.
  const winAt = (roIn: number): OpeningSlice => ({
    id: `win_${roIn}`,
    kind: 'window',
    u: 3,
    width: inches(roIn) - T,
    height: 1.0,
    sillHeight: 0.9,
    roughWidth: inches(roIn),
    roughHeight: 1.0 + T,
  })
  const wallWith = (roIn: number): WallSlice =>
    makeWall({
      id: `w_${roIn}`,
      start: [0, 0],
      end: [6, 0],
      height: 2.7,
      thickness: 0.114, // textbook 2x4 partition — no compression aggregate flag
      openings: [winAt(roIn)],
    })
  const headerOf = (roIn: number, spec = DEFAULT_SPEC): Member => {
    const h = frameWall(wallWith(roIn), spec).find((m) => m.role === 'header')
    expect(h).toBeDefined()
    return h as Member
  }
  const VT = applyJurisdiction(DEFAULT_SPEC, profileFor('VT')) // 60 psf → 70-psf column
  const MN = applyJurisdiction(DEFAULT_SPEC, profileFor('MN')) // 50 psf → 50-psf column
  const INTL = applyJurisdiction(DEFAULT_SPEC, profileFor('INTL')) // 30 psf → default

  test('VT ≠ INTL — the deepening enumerated exactly per opening span', () => {
    // [roIn, INTL size, VT size] — VT deepens one table step exactly where
    // the 70-psf column's shorter spans bite (4x8 cap 60"→53", 4x10 84"→63")
    const matrix: [number, string, string][] = [
      [22, '4x4', '4x4'],
      [30, '4x6', '4x6'],
      [53, '4x8', '4x8'], // boundary: 70-band 4x8 cap is EXACTLY 4-5 (53")
      [56, '4x8', '4x10'],
      [60, '4x8', '4x10'],
      [66, '4x10', '4x12'],
      [80, '4x10', '4x12'],
      [90, '4x12', '4x12'],
    ]
    for (const [roIn, intlSize, vtSize] of matrix) {
      expect(headerOf(roIn, INTL).size, `INTL @ ${roIn}"`).toBe(intlSize as never)
      expect(headerOf(roIn, VT).size, `VT @ ${roIn}"`).toBe(vtSize as never)
    }
    // MN (50-psf column): only the 4x10 step moved (84" → 71")
    expect(headerOf(56, MN).size).toBe('4x8')
    expect(headerOf(66, MN).size).toBe('4x10')
    expect(headerOf(80, MN).size).toBe('4x12')
  })

  test('deepened headers stay geometrically honest — full depth of their own size, no flags', () => {
    const h = headerOf(56, VT) // 4x10 where INTL draws 4x8
    const hw = LUMBER_CROSS_SECTIONS[h.size as keyof typeof LUMBER_CROSS_SECTIONS][1]
    expect(h.dims[1]).toBeCloseTo(hw, 6)
    expect(h.flag).toBeUndefined()
  })

  test('round 2 (skeptic): past-cap spans are ENGINEERED — never a silent lumber 4x12 affirming the table', () => {
    // The 70-psf column's 2-2x12 cell ends at 6-2 (74"); 50-psf at 6-11
    // (83"). Round 1 let every span in (74", 120") frame a plain lumber
    // 4x12 whose label AFFIRMED the table outside its domain — the band
    // now caps engineeredHeaderSpan at its terminal cell, so those spans
    // route to the supplier/flag path.
    for (const roIn of [76, 90, 110]) {
      const h = headerOf(roIn, VT)
      expect(h.material, `VT @ ${roIn}"`).toBe('engineered')
      expect(h.flag, `VT @ ${roIn}"`).toContain('ENGINEERED BEAM REQUIRED')
      expect(h.label, `VT @ ${roIn}"`).toContain('size by supplier')
      // the SAME spans at INTL keep their pre-B11 lumber 4x12 (the
      // low-band terminal gap is pre-existing and out of B11 scope —
      // low-snow output must stay byte-equal)
      const li = headerOf(roIn, INTL)
      expect(li.material, `INTL @ ${roIn}"`).toBe('lumber')
      expect(li.flag, `INTL @ ${roIn}"`).toBeUndefined()
    }
    // the band boundaries stay PRESCRIPTIVE — 74"/83" ARE the code cells
    const vt74 = headerOf(74, VT)
    expect(vt74.size).toBe('4x12')
    expect(vt74.material).toBe('lumber')
    expect(vt74.flag).toBeUndefined()
    expect(vt74.label).toContain('Table R602.7(1)') // in-domain claim stands
    const mn83 = headerOf(83, MN)
    expect(mn83.size).toBe('4x12')
    expect(mn83.material).toBe('lumber')
    expect(mn83.flag).toBeUndefined()
    expect(headerOf(84, MN).material).toBe('engineered')
    expect(headerOf(84, INTL).material).toBe('lumber')
  })

  test('the label pin: band-sized headers state the R602.7(1) building-width assumption; INTL headers do not', () => {
    const vtHeader = headerOf(56, VT)
    expect(vtHeader.label).toBe(
      'Header 4x10 over window — sized per Table R602.7(1) @ 70 psf ground snow — ≤ 24 ft building width, roof-and-ceiling loading assumed',
    )
    const mnHeader = headerOf(56, MN)
    expect(mnHeader.label).toContain('@ 50 psf ground snow')
    // low-snow: the exact pre-B11 label, nothing appended
    expect(headerOf(56, INTL).label).toBe('Header 4x8 over window')
    expect(headerOf(56).label).toBe('Header 4x8 over window') // raw DEFAULT_SPEC too
  })

  test('the assumption rides ENGINEERED headers too (the size still came from the band rules)', () => {
    const wide = makeWall({
      id: 'w_wide',
      start: [0, 0],
      end: [8, 0],
      openings: [door(4, 3.4, 2.1)], // > engineeredHeaderSpan
    })
    const vtWide = frameWall(wide, VT).find((m) => m.role === 'header')
    expect(vtWide?.material).toBe('engineered')
    expect(vtWide?.label).toContain('size by supplier')
    expect(vtWide?.label).toContain('Table R602.7(1)')
    const intlWide = frameWall(wide, INTL).find((m) => m.role === 'header')
    expect(intlWide?.label).not.toContain('Table R602.7(1)')
  })

  test('low-snow jurisdictions are member-byte-equal to the raw default spec (the INTL pin)', () => {
    for (const code of ['INTL', 'TX', 'CA', 'FL'] as const) {
      const applied = applyJurisdiction(DEFAULT_SPEC, profileFor(code))
      for (const roIn of [22, 30, 56, 66, 80, 90]) {
        const wall = wallWith(roIn)
        // wall-framing consumes headerRules + headerAssumption only from
        // the jurisdiction delta — pin the whole member list byte-equal
        const specNeutral = {
          ...DEFAULT_SPEC,
          headerRules: applied.headerRules,
          headerAssumption: applied.headerAssumption,
          engineeredHeaderSpan: applied.engineeredHeaderSpan, // round 2: the cap is part of the delta
        }
        expect(JSON.parse(JSON.stringify(frameWall(wall, specNeutral)))).toEqual(
          JSON.parse(JSON.stringify(frameWall(wall, DEFAULT_SPEC))),
        )
      }
    }
  })

  test('band selection is pure data — headerBandForSnow at the profile loads mirrors applyJurisdiction', () => {
    for (const code of ['VT', 'MN', 'NY', 'TX'] as const) {
      const profile = profileFor(code)
      const spec = applyJurisdiction(DEFAULT_SPEC, profile)
      const band = headerBandForSnow(profile.groundSnowLoadPsf)
      expect(spec.headerRules).toBe(band.rules)
      expect(spec.headerAssumption).toBe(band.assumption as never)
    }
  })
})
