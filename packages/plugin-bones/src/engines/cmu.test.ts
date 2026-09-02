import { describe, expect, test } from 'bun:test'
import { Euler, Vector3 } from 'three'
import { DEFAULT_SPEC } from '../core/spec'
import type { Member, OpeningSlice, WallSlice } from '../core/types'
import { inches } from '../core/units'
import {
  BLOCK_DEPTH_ACTUAL,
  BLOCK_LENGTH,
  CELL_CENTER,
  CMU_FACE_BURY,
  COURSE_HEIGHT,
  LINTEL_BEARING,
  MORTAR_JOINT,
  REBAR_SIZE,
  VERT_BAR_SPACING,
  cmuDowelPositions,
  cmuWall,
  cmuWalls,
  mixedCmuWall,
  mixedWallInsets,
  courseIntervals,
  snapCmuHeight,
  verticalBarPositions,
  THIN_BURY_FLAG,
} from './cmu'

// The 8" module in meters — spelled out so the assertions read as numbers.
const H = COURSE_HEIGHT // 0.2032
const B = BLOCK_LENGTH // 0.4064
const M = MORTAR_JOINT // 0.009525
const PAD = inches(1.5) // rough-opening pad used by the test openings

function makeWall(overrides: Partial<WallSlice> = {}): WallSlice {
  const start = overrides.start ?? [0, 0]
  const end = overrides.end ?? [4, 0]
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  return {
    id: 'wall_cmu',
    start,
    end,
    length,
    dir: [dx / length, dz / length],
    thickness: 0.2,
    height: 2.4,
    exterior: true,
    openings: [],
    curved: false,
    ...overrides,
  }
}

function window_(u: number, width = 1.2, height = 1.0, sillHeight = 0.7): OpeningSlice {
  return {
    id: 'win_cmu',
    kind: 'window',
    u,
    width,
    height,
    sillHeight,
    roughWidth: width + PAD,
    roughHeight: height + PAD,
  }
}

function door(u: number, width = 0.9, height = 2.1): OpeningSlice {
  return {
    id: 'door_cmu',
    kind: 'door',
    u,
    width,
    height,
    sillHeight: 0,
    roughWidth: width + PAD,
    roughHeight: height + PAD,
  }
}

const byRole = (members: Member[], role: string): Member[] =>
  members.filter((m) => m.role === role)

/** Blocks of one course, identified by their Y center, sorted along the wall. */
function course(members: Member[], c: number): Member[] {
  return byRole(members, 'block')
    .filter((m) => Math.abs((m.position[1] ?? 0) - (c * H + H / 2)) < 1e-6)
    .sort((a, b) => (a.position[0] ?? 0) - (b.position[0] ?? 0))
}

describe('courseIntervals — running-bond layout math', () => {
  test('even course on a 4m wall: 9 full blocks + one cut closer', () => {
    const iv = courseIntervals(4, false)
    expect(iv).toHaveLength(10)
    expect(iv[0]?.a).toBeCloseTo(0, 9)
    expect(iv[0]?.b).toBeCloseTo(B, 9)
    // interior units are all full 16" modules
    for (let i = 0; i < 9; i++) expect((iv[i]?.b ?? 0) - (iv[i]?.a ?? 0)).toBeCloseTo(B, 9)
    // closer cut to the wall length: 4 − 9·0.4064 = 0.3424
    expect(iv[9]?.b).toBeCloseTo(4, 9)
    expect((iv[9]?.b ?? 0) - (iv[9]?.a ?? 0)).toBeCloseTo(0.3424, 6)
  })

  test('odd course starts with a half block (head joints land mid-unit below)', () => {
    const iv = courseIntervals(4, true)
    expect(iv).toHaveLength(11)
    expect((iv[0]?.b ?? 0) - (iv[0]?.a ?? 0)).toBeCloseTo(B / 2, 9)
    // every joint is offset half a module from the even-course joints
    expect(iv[1]?.a).toBeCloseTo(B / 2, 9)
    expect(iv[1]?.b).toBeCloseTo(B / 2 + B, 9)
  })

  test('unlayable slivers (< 2") are dropped, not emitted as chips', () => {
    const iv = courseIntervals(B + inches(0.5), false)
    expect(iv).toHaveLength(1) // the ½" remainder is not a block
    expect(iv[0]?.b).toBeCloseTo(B, 9)
  })
})

describe('cmuWall — solid 4m × 2.4m wall', () => {
  const wall = makeWall()
  const members = cmuWall(wall, DEFAULT_SPEC)
  const blocks = byRole(members, 'block')

  test('masonry is concrete, reinforcing is steel — all on the wall-framing system', () => {
    expect(members.length).toBeGreaterThan(0)
    for (const m of members) {
      expect(m.system).toBe('wall-framing')
      expect(m.material).toBe(m.role === 'rebar' ? 'steel' : 'concrete')
      expect(m.sourceId).toBe('wall_cmu')
    }
    for (const b of blocks) expect(b.size).toBeUndefined() // blocks are not lumber
  })

  test('10 block courses + 1 bond-beam course (11 full courses fit in 2.4m)', () => {
    // floor(2.4 / 0.2032) = 11 total courses; the top one is the bond beam.
    const yCenters = new Set(blocks.map((b) => (b.position[1] ?? 0).toFixed(6)))
    expect(yCenters.size).toBe(10)
    for (let c = 0; c < 10; c++) expect(course(members, c).length).toBeGreaterThan(0)
    expect(byRole(members, 'bond-beam')).toHaveLength(1)
  })

  test('block count is the hand-tallied 105 (5 even × 10 + 5 odd × 11)', () => {
    expect(course(members, 0)).toHaveLength(10) // 9 full + cut closer
    expect(course(members, 1)).toHaveLength(11) // half starter + 9 full + closer
    expect(blocks).toHaveLength(105)
  })

  test('running bond: odd-course head joints offset half a block', () => {
    const c0 = course(members, 0)
    const c1 = course(members, 1)
    // course 0 starts with a full block centered at 8"
    expect(c0[0]?.position[0]).toBeCloseTo(B / 2, 6)
    // course 1 starts with a HALF block centered at 4"
    expect(c1[0]?.position[0]).toBeCloseTo(B / 4, 6)
    expect(c1[0]?.dims[0]).toBeCloseTo(B / 2 - M, 6)
    // interior full blocks sit exactly half a module over the course below
    expect((c1[1]?.position[0] ?? 0) - (c0[0]?.position[0] ?? 0)).toBeCloseTo(B / 2, 6)
    // and courses two apart stack plumb (bond repeats every 2 courses)
    const c2 = course(members, 2)
    expect(c2[0]?.position[0]).toBeCloseTo(c0[0]?.position[0] ?? -1, 9)
  })

  test('blocks shrink 3/8" in length and height — the visual mortar joint', () => {
    const full = course(members, 0)[1] as Member // an interior full block
    expect(full.dims[0]).toBeCloseTo(B - M, 6) // 15.625" face
    expect(full.dims[1]).toBeCloseTo(H - M, 6) // 7.625" face
    // centered in its course cell: center Y = course line + 4"
    expect(full.position[1]).toBeCloseTo(H / 2, 6)
    // takeoff cut length = the unit's long dimension
    expect(full.length).toBeCloseTo(B - M, 6)
  })

  test('block depth clamps to min(thickness − 2×face bury, 7-5/8" actual)', () => {
    // 0.2m wall → the drawn thickness less CMU_FACE_BURY each side, so the
    // block faces sit strictly inside the host wall's drawn face planes
    // (the painted-host z-fight fix — the true 7-5/8" unit only fits
    // un-buried past 0.2037m).
    expect(blocks[0]?.dims[2]).toBeCloseTo(0.2 - 2 * CMU_FACE_BURY, 6)
    // 0.15m architectural wall → 6"-style unit, clamped inside the bury
    const thin = cmuWall(makeWall({ thickness: 0.15 }), DEFAULT_SPEC)
    expect(byRole(thin, 'block')[0]?.dims[2]).toBeCloseTo(0.15 - 2 * CMU_FACE_BURY, 6)
    // A wall deeper than the unit + both buries keeps the TRUE 7-5/8" unit
    // — today's behavior preserved where the natural clearance ≥ the bury.
    const deep = cmuWall(makeWall({ thickness: 0.21 }), DEFAULT_SPEC)
    expect(byRole(deep, 'block')[0]?.dims[2]).toBeCloseTo(BLOCK_DEPTH_ACTUAL, 6)
  })

  test('bond beam caps the wall: top course, full length, grouted label', () => {
    const beam = byRole(members, 'bond-beam')[0] as Member
    expect(beam.label).toBe('bond beam — grouted + rebar')
    expect(beam.dims[0]).toBeCloseTo(4, 6) // continuous — no head joints
    expect(beam.position[0]).toBeCloseTo(2, 6)
    // occupies the 11th course cell: [2.032, 2.2352], center 2.1336
    expect(beam.position[1]).toBeCloseTo(10 * H + H / 2, 6)
    // nothing pokes above the architectural wall height
    expect((beam.position[1] ?? 0) + (beam.dims[1] ?? 0) / 2).toBeLessThanOrEqual(wall.height)
    // no plain block sits above the bond beam bottom
    for (const b of blocks) expect(b.position[1] ?? 0).toBeLessThan(10 * H)
  })

  test('cells holding a vertical bar are marked grouted (4 per course, 40 total)', () => {
    // Bars land at 0.1016 / 1.3208 / 2.54 / 3.8984 → 4 grouted cells a course.
    const grouted = blocks.filter((b) => b.grouted)
    expect(grouted).toHaveLength(40)
    // The dedicated field and the human label always travel together —
    // takeoff keys off `grouted`, never the label string (round-10).
    for (const b of grouted) expect(b.label).toBe('grouted cell + vertical rebar')
    for (let c = 0; c < 10; c++) {
      const row = course(members, c)
      expect(row[0]?.grouted).toBe(true)
      expect(row[row.length - 1]?.grouted).toBe(true)
      // barless cells stay unmarked
      expect(row[1]?.grouted).toBeUndefined()
      expect(row[1]?.label).toBeUndefined()
    }
  })
})

describe('cmuWall — window opening', () => {
  // Window 1.2 × 1.0 at u=2, sill 0.7 → RO u ∈ [1.381, 2.619], y ∈ [0.7, 1.738]
  const opening = window_(2)
  const wall = makeWall({ openings: [opening] })
  const members = cmuWall(wall, DEFAULT_SPEC)
  const blocks = byRole(members, 'block')
  const u0 = 2 - opening.roughWidth / 2
  const u1 = 2 + opening.roughWidth / 2
  const roTop = opening.sillHeight + opening.roughHeight

  test('no block invades the rough opening rectangle', () => {
    for (const b of blocks) {
      const yLo = (b.position[1] ?? 0) - H / 2 // nominal course cell
      const yHi = (b.position[1] ?? 0) + H / 2
      if (yHi <= opening.sillHeight + 1e-9 || yLo >= roTop - 1e-9) continue
      const left = (b.position[0] ?? 0) - b.dims[0] / 2
      const right = (b.position[0] ?? 0) + b.dims[0] / 2
      expect(right <= u0 + 1e-6 || left >= u1 - 1e-6).toBe(true)
    }
  })

  test('jamb blocks are cut tight: face lands half a joint off the RO line', () => {
    // course 4 cell [0.813, 1.016] is fully inside the RO band
    const row = course(members, 4)
    const leftJamb = row.filter((b) => (b.position[0] ?? 0) < u0).pop() as Member
    expect((leftJamb.position[0] ?? 0) + leftJamb.dims[0] / 2).toBeCloseTo(u0 - M / 2, 6)
    const rightJamb = row.find((b) => (b.position[0] ?? 0) > u1) as Member
    expect((rightJamb.position[0] ?? 0) - rightJamb.dims[0] / 2).toBeCloseTo(u1 + M / 2, 6)
  })

  test('fewer blocks than the solid wall, but the field is still laid', () => {
    expect(blocks.length).toBeLessThan(105)
    expect(blocks.length).toBeGreaterThan(70)
  })

  test('precast lintel: 8" tall, RO + 2×8" long, bearing 8" past each jamb', () => {
    const lintels = byRole(members, 'lintel')
    expect(lintels).toHaveLength(1)
    const lintel = lintels[0] as Member
    expect(lintel.material).toBe('concrete')
    expect(lintel.size).toBeUndefined()
    expect(lintel.dims[0]).toBeCloseTo(opening.roughWidth + 2 * LINTEL_BEARING, 6)
    expect(lintel.dims[1]).toBeCloseTo(H - M, 6) // 7-5/8" actual precast height
    expect(lintel.position[0]).toBeCloseTo(2, 6) // centered on the opening
    // sits DIRECTLY above the RO: bottom of its course cell = RO top
    expect(lintel.position[1]).toBeCloseTo(roTop + H / 2, 6)
    // bearing extents: 8" past each side of the rough opening
    expect((lintel.position[0] ?? 0) - lintel.dims[0] / 2).toBeCloseTo(u0 - LINTEL_BEARING, 6)
    expect((lintel.position[0] ?? 0) + lintel.dims[0] / 2).toBeCloseTo(u1 + LINTEL_BEARING, 6)
    expect(lintel.length).toBeCloseTo(lintel.dims[0], 9)
    expect(lintel.label).toContain('lintel')
  })

  test('blocks butt the lintel — none overlap its bearing band', () => {
    const la = u0 - LINTEL_BEARING
    const lb = u1 + LINTEL_BEARING
    for (const b of blocks) {
      const yLo = (b.position[1] ?? 0) - H / 2
      const yHi = (b.position[1] ?? 0) + H / 2
      if (yHi <= roTop + 1e-9 || yLo >= roTop + H - 1e-9) continue
      const left = (b.position[0] ?? 0) - b.dims[0] / 2
      const right = (b.position[0] ?? 0) + b.dims[0] / 2
      expect(right <= la + 1e-6 || left >= lb - 1e-6).toBe(true)
    }
  })

  test('bond beam still runs continuous over the opening', () => {
    expect(byRole(members, 'bond-beam')).toHaveLength(1)
    expect(byRole(members, 'bond-beam')[0]?.dims[0]).toBeCloseTo(4, 6)
  })
})

describe('cmuWall — door opening (head within one course of the top)', () => {
  // Door head at 2.138m in a 2.4m wall: RO top is ABOVE the bond-beam bottom
  // (2.032m), so the tie beam doubles as the lintel — the FL standard detail.
  const wall = makeWall({ openings: [door(2)] })
  const members = cmuWall(wall, DEFAULT_SPEC)

  test('no separate lintel — the bond beam is the structural head', () => {
    expect(byRole(members, 'lintel')).toHaveLength(0)
    expect(byRole(members, 'bond-beam')).toHaveLength(1)
  })

  test('door RO cuts every body course down to the floor', () => {
    const u0 = 2 - (0.9 + PAD) / 2
    const u1 = 2 + (0.9 + PAD) / 2
    for (const b of byRole(members, 'block')) {
      const left = (b.position[0] ?? 0) - b.dims[0] / 2
      const right = (b.position[0] ?? 0) + b.dims[0] / 2
      expect(right <= u0 + 1e-6 || left >= u1 - 1e-6).toBe(true)
    }
  })

  test('a taller wall restores the full-height precast lintel over the door', () => {
    const tall = cmuWall(makeWall({ height: 2.7, openings: [door(2)] }), DEFAULT_SPEC)
    const lintel = byRole(tall, 'lintel')[0] as Member
    expect(lintel.dims[1]).toBeCloseTo(H - M, 6)
    expect(lintel.position[1]).toBeCloseTo(2.1 + PAD + H / 2, 6)
  })
})

describe('cmuWall — placement and rotation follow the wall-framing convention', () => {
  test('yaw maps the +X block axis onto the wall direction', () => {
    const wall = makeWall({ start: [0, 0], end: [0, 3] }) // runs along +Z
    const members = cmuWall(wall, DEFAULT_SPEC)
    const block = members[0] as Member
    expect(block.rotation[1]).toBeCloseTo(-Math.PI / 2, 6)
    // verify with a real rotation: +X rotated by the member euler → wall dir
    const dir = new Vector3(1, 0, 0).applyEuler(new Euler(...block.rotation))
    expect(dir.x).toBeCloseTo(wall.dir[0], 6)
    expect(dir.z).toBeCloseTo(wall.dir[1], 6)
    // level-local placement: first block of course 0 centers 8" up the wall
    const first = course(members, 0)[0] as Member
    expect(first.position[0]).toBeCloseTo(0, 6)
    expect(first.position[2]).toBeCloseTo(B / 2, 6)
    expect(first.position[1]).toBeCloseTo(H / 2, 6)
  })

  test('walls starting off-origin place blocks from their start point', () => {
    const wall = makeWall({ start: [10, 5], end: [14, 5] })
    const first = course(cmuWall(wall, DEFAULT_SPEC), 0)[0] as Member
    expect(first.position[0]).toBeCloseTo(10 + B / 2, 6)
    expect(first.position[2]).toBeCloseTo(5, 6)
  })
})

describe('cmuWall — guards', () => {
  test('wall shorter than one course → empty (nothing to lay)', () => {
    expect(cmuWall(makeWall({ height: 0.15 }), DEFAULT_SPEC)).toHaveLength(0)
  })

  test('wall exactly one course tall → just the bond beam, no plain blocks', () => {
    const members = cmuWall(makeWall({ height: 0.21 }), DEFAULT_SPEC)
    expect(byRole(members, 'block')).toHaveLength(0)
    expect(byRole(members, 'bond-beam')).toHaveLength(1)
  })

  test('an exact 8ft wall does not lose its top course to float rounding', () => {
    // 2.4384 / 0.2032 must count as 12 courses: 11 block + 1 bond beam
    const members = cmuWall(makeWall({ height: 8 * 0.3048 }), DEFAULT_SPEC)
    const yCenters = new Set(
      byRole(members, 'block').map((b) => (b.position[1] ?? 0).toFixed(6)),
    )
    expect(yCenters.size).toBe(11)
    expect(byRole(members, 'bond-beam')[0]?.position[1]).toBeCloseTo(11 * H + H / 2, 6)
  })

  test('curved walls return no members (flagged upstream)', () => {
    expect(cmuWall(makeWall({ curved: true }), DEFAULT_SPEC)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Round-1 fabrication features (vertical rebar, bond-beam bars, interlock)
// ---------------------------------------------------------------------------

describe('verticalBarPositions — layout math', () => {
  test('solid 4m wall: end cells + 48" field grid, colliding grid bar dropped', () => {
    const us = verticalBarPositions(4, [])
    // ends at 4" in; field at 4" + k·48"; the k=3 bar (3.7592) sits within
    // 8" of the end bar (3.8984) and is dropped — one bar per corner core.
    expect(us).toHaveLength(4)
    expect(us[0]).toBeCloseTo(CELL_CENTER, 6) // 0.1016
    expect(us[1]).toBeCloseTo(CELL_CENTER + VERT_BAR_SPACING, 6) // 1.3208
    expect(us[2]).toBeCloseTo(CELL_CENTER + 2 * VERT_BAR_SPACING, 6) // 2.5400
    expect(us[3]).toBeCloseTo(4 - CELL_CENTER, 6) // 3.8984
  })

  test('opening: jamb bars in the first cell each side, grid bars inside the RO dropped', () => {
    // Window RO u ∈ [1.381, 2.619] (the standard test window at u=2).
    const us = verticalBarPositions(4, [{ u0: 1.381, u1: 2.619 }])
    expect(us).toHaveLength(4)
    expect(us[1]).toBeCloseTo(1.381 - CELL_CENTER, 6) // left jamb (grid 1.3208 merged)
    expect(us[2]).toBeCloseTo(2.619 + CELL_CENTER, 6) // right jamb (grid 2.54 was in RO)
  })

  test('skip flags drop only the corner-end bar', () => {
    const us = verticalBarPositions(3, [], true, false)
    expect(us.every((u) => u > inches(8))).toBe(true)
    expect(us[us.length - 1]).toBeCloseTo(3 - CELL_CENTER, 6)
  })
})

describe('cmuWall — vertical rebar in grouted cells (LOD 350+)', () => {
  const wall = makeWall()
  const members = cmuWall(wall, DEFAULT_SPEC)
  const bars = byRole(members, 'rebar').filter((m) => m.dims[1] > 1) // verticals

  test('4 steel #5 bars at the computed cell positions, hooked into the beam', () => {
    expect(bars).toHaveLength(4)
    const us = bars.map((b) => b.position[0] ?? 0).sort((a, b) => a - b)
    expect(us[0]).toBeCloseTo(0.1016, 4)
    expect(us[1]).toBeCloseTo(1.3208, 4)
    expect(us[2]).toBeCloseTo(2.54, 4)
    expect(us[3]).toBeCloseTo(3.8984, 4)
    for (const bar of bars) {
      expect(bar.material).toBe('steel')
      expect(bar.dims[0]).toBeCloseTo(REBAR_SIZE, 6)
      // runs from the slab to mid-bond-beam: top = 10·H + H/2 = 2.1336
      const top = (bar.position[1] ?? 0) + bar.dims[1] / 2
      expect(top).toBeCloseTo(10 * H + H / 2, 6)
      expect(bar.position[1] ?? 0).toBeCloseTo(top / 2, 6) // bottom at 0
      expect(bar.label).toContain('R606.12')
    }
  })

  test('LOD 200 emits no reinforcing steel', () => {
    const generic = cmuWall(wall, { ...DEFAULT_SPEC, detail: '200' })
    expect(byRole(generic, 'rebar')).toHaveLength(0)
    // …and falls back to the schematic end-cell grout call-out
    const grouted = byRole(generic, 'block').filter((b) => b.label?.includes('grouted'))
    expect(grouted).toHaveLength(20)
  })

  test('window jamb cells hold a bar and grout solid', () => {
    const opening = window_(2)
    const u0 = 2 - opening.roughWidth / 2 // 1.38095
    const u1 = 2 + opening.roughWidth / 2 // 2.61905
    const withWin = cmuWall(makeWall({ openings: [opening] }), DEFAULT_SPEC)
    const vbars = byRole(withWin, 'rebar').filter((m) => m.dims[1] > 1)
    const us = vbars.map((b) => b.position[0] ?? 0).sort((a, b) => a - b)
    expect(us).toHaveLength(4)
    expect(us[1]).toBeCloseTo(u0 - CELL_CENTER, 6) // left jamb bar
    expect(us[2]).toBeCloseTo(u1 + CELL_CENTER, 6) // right jamb bar
    // the jamb block beside the RO (course 4 is fully in the RO band) grouts
    const row = course(withWin, 4)
    const leftJamb = row.filter((b) => (b.position[0] ?? 0) < u0).pop() as Member
    expect(leftJamb.label).toBe('grouted cell + vertical rebar')
    const rightJamb = row.find((b) => (b.position[0] ?? 0) > u1) as Member
    expect(rightJamb.label).toBe('grouted cell + vertical rebar')
  })
})

describe('cmuWall — bond-beam horizontal bars (LOD 350+)', () => {
  const members = cmuWall(makeWall(), DEFAULT_SPEC)
  const beamBars = byRole(members, 'rebar').filter((m) => m.dims[0] > 1) // horizontals

  test('two #5 bars run the full beam, 2" clear off each face', () => {
    expect(beamBars).toHaveLength(2)
    const offs = beamBars.map((b) => b.position[2] ?? 0).sort((a, b) => a - b)
    // Depth on the 0.2m wall is buried (0.19), so the 2" clear cover
    // measures off the BURIED faces — bars ride the real block, never the
    // drawn wall face.
    const expected = (0.2 - 2 * CMU_FACE_BURY) / 2 - inches(2) // 0.19/2 − 0.0508
    expect(offs[0]).toBeCloseTo(-expected, 6)
    expect(offs[1]).toBeCloseTo(expected, 6)
    for (const bar of beamBars) {
      expect(bar.material).toBe('steel')
      expect(bar.dims[0]).toBeCloseTo(4, 6) // continuous, wall length
      expect(bar.position[1]).toBeCloseTo(10 * H + H / 2, 6) // beam mid-height
      expect(bar.position[0]).toBeCloseTo(2, 6)
      expect(bar.label).toContain('bond beam')
    }
  })

  test('a wall too thin for two bars carries one on center', () => {
    const thin = cmuWall(makeWall({ thickness: 0.1 }), DEFAULT_SPEC)
    const bars = byRole(thin, 'rebar').filter((m) => m.dims[0] > 1)
    expect(bars).toHaveLength(1)
    expect(bars[0]?.position[2]).toBeCloseTo(0, 6)
  })
})

describe('cmuWalls — corner interlock (courses alternate through the corner)', () => {
  // Two perpendicular 0.2m walls sharing the corner at the origin — the
  // round-1 reviewer's exact spot check, which found 9 overlapping pairs.
  const A = makeWall({ id: 'wall_A', start: [0, 0], end: [4, 0] })
  const B = makeWall({ id: 'wall_B', start: [0, 0], end: [0, 3] })
  const members = cmuWalls([A, B], DEFAULT_SPEC)
  const masonry = members.filter((m) => m.role !== 'rebar') // blocks/beams/lintels

  /** World-space AABB — walls here are axis-aligned (yaw 0 or −π/2). */
  function aabb(m: Member) {
    const alongX = Math.abs(Math.cos(m.rotation[1] ?? 0)) > 0.5
    const hx = alongX ? m.dims[0] / 2 : m.dims[2] / 2
    const hz = alongX ? m.dims[2] / 2 : m.dims[0] / 2
    return {
      minX: (m.position[0] ?? 0) - hx,
      maxX: (m.position[0] ?? 0) + hx,
      minY: (m.position[1] ?? 0) - m.dims[1] / 2,
      maxY: (m.position[1] ?? 0) + m.dims[1] / 2,
      minZ: (m.position[2] ?? 0) - hz,
      maxZ: (m.position[2] ?? 0) + hz,
    }
  }

  test('ZERO masonry volumes from the two walls intersect', () => {
    const ours = masonry.filter((m) => m.sourceId === 'wall_A').map(aabb)
    const theirs = masonry.filter((m) => m.sourceId === 'wall_B').map(aabb)
    let overlapping = 0
    for (const a of ours) {
      for (const b of theirs) {
        const hit =
          a.minX < b.maxX - 1e-9 && b.minX < a.maxX - 1e-9 &&
          a.minY < b.maxY - 1e-9 && b.minY < a.maxY - 1e-9 &&
          a.minZ < b.maxZ - 1e-9 && b.minZ < a.maxZ - 1e-9
        if (hit) overlapping += 1
      }
    }
    expect(overlapping).toBe(0)
  })

  test('even courses: the longer wall lays through, the other stops short', () => {
    // A (through) claims even courses: its first block reaches x = −0.1
    // (B's far face); B starts at z = +0.1 (clear of A's face).
    const a0 = course(members.filter((m) => m.sourceId === 'wall_A'), 0)[0] as Member
    expect((a0.position[0] ?? 0) - a0.dims[0] / 2).toBeCloseTo(-0.1 + M / 2, 4)
    const b0 = course(members.filter((m) => m.sourceId === 'wall_B'), 0)[0] as Member
    expect((b0.position[2] ?? 0) - b0.dims[0] / 2).toBeCloseTo(0.1 + M / 2, 4)
  })

  test('odd courses swap: the butting wall lays through', () => {
    const a1 = course(members.filter((m) => m.sourceId === 'wall_A'), 1)[0] as Member
    expect((a1.position[0] ?? 0) - a1.dims[0] / 2).toBeCloseTo(0.1 + M / 2, 4)
    const b1 = course(members.filter((m) => m.sourceId === 'wall_B'), 1)[0] as Member
    expect((b1.position[2] ?? 0) - b1.dims[0] / 2).toBeCloseTo(-0.1 + M / 2, 4)
  })

  test('the shared corner core holds exactly ONE vertical bar (the through wall’s)', () => {
    const verticals = byRole(members, 'rebar').filter((m) => m.dims[1] > 1)
    const nearCorner = verticals.filter(
      (b) => Math.hypot(b.position[0] ?? 0, b.position[2] ?? 0) < inches(8),
    )
    expect(nearCorner).toHaveLength(1)
    expect(nearCorner[0]?.sourceId).toBe('wall_A')
  })

  test('bond beams interlock too — the yielding beam pulls short', () => {
    const beamA = members.find((m) => m.role === 'bond-beam' && m.sourceId === 'wall_A') as Member
    const beamB = members.find((m) => m.role === 'bond-beam' && m.sourceId === 'wall_B') as Member
    // beam course index 10 is even → A claims (extends to −0.1), B yields
    expect((beamA.position[0] ?? 0) - beamA.dims[0] / 2).toBeCloseTo(-0.1, 4)
    expect((beamB.position[2] ?? 0) - beamB.dims[0] / 2).toBeCloseTo(0.1, 4)
  })
})

/**
 * GATE (mixed wall construction — course snap): snapCmuHeight is the ONE
 * course-math truth the engines and the UI height slider share. Whole 8"
 * courses only, clamped to [1 course, every course that fits].
 */
describe('snapCmuHeight', () => {
  test('snaps to the nearest whole course', () => {
    expect(snapCmuHeight(1.22, 2.44)).toBeCloseTo(6 * H, 9) // 50% of 2.44m → 6 courses
    expect(snapCmuHeight(1.0, 2.44)).toBeCloseTo(5 * H, 9)
    expect(snapCmuHeight(0.5, 2.44)).toBeCloseTo(2 * H, 9)
  })

  test('clamps low to one course and high to the courses that fit', () => {
    expect(snapCmuHeight(0.01, 2.44)).toBeCloseTo(H, 9)
    expect(snapCmuHeight(99, 2.44)).toBeCloseTo(12 * H, 9)
    expect(snapCmuHeight(2.44, 2.44)).toBeCloseTo(12 * H, 9) // 100% = full height
  })

  test('exact-fit wall heights do not float-round a course away', () => {
    expect(snapCmuHeight(12 * H, 12 * H)).toBeCloseTo(12 * H, 12)
    expect(snapCmuHeight(6 * H, 12 * H)).toBeCloseTo(6 * H, 12)
  })

  test('walls shorter than one course snap to 0 (nothing to lay)', () => {
    expect(snapCmuHeight(0.1, 0.15)).toBe(0)
  })
})

/**
 * GATE (LOD-400 B18b — foundation dowels lap the wall verticals):
 * cmuDowelPositions is the one layout truth the FOUNDATION consumes so its
 * dowels rise in the same cells as this wall's #5 verticals.
 */
describe('cmuDowelPositions — foundation-facing dowel layout (B18b)', () => {
  test('full-height CMU wall: dowels land exactly on the vertical-bar layout (no skips)', () => {
    const wall = makeWall()
    expect(cmuDowelPositions(wall).us).toEqual(verticalBarPositions(4, []))
  })

  test('openings: no dowel inside the RO, jamb cells covered (matches the wall bars)', () => {
    const wall = makeWall({ openings: [window_(2)] })
    const ro = { u0: 2 - (1.2 + PAD) / 2, u1: 2 + (1.2 + PAD) / 2 }
    const { us } = cmuDowelPositions(wall)
    expect(us).toEqual(verticalBarPositions(4, [ro]))
    for (const u of us) expect(u <= ro.u0 + 1e-9 || u >= ro.u1 - 1e-9).toBe(true)
    expect(us.some((u) => Math.abs(u - (ro.u0 - CELL_CENTER)) < 1e-6)).toBe(true)
    expect(us.some((u) => Math.abs(u - (ro.u1 + CELL_CENTER)) < 1e-6)).toBe(true)
  })

  test('every vertical the wall EMITS has a dowel at the same cell (superset by construction)', () => {
    // Corner skip flags thin the wall's own bars; the dowel layout skips
    // nothing, so emitted verticals ⊆ dowels.
    const wall = makeWall({ openings: [window_(2)] })
    const members = cmuWall(wall, { ...DEFAULT_SPEC, detail: '400' })
    const vertUs = members
      .filter((m) => m.label?.startsWith('#5 vertical'))
      .map((m) => (m.position[0] ?? 0) - (wall.start[0] ?? 0))
    expect(vertUs.length).toBeGreaterThan(0)
    const dowels = cmuDowelPositions(wall)
    for (const u of vertUs) {
      expect(dowels.us.some((d) => Math.abs(d - u) < 1e-6)).toBe(true)
    }
  })

  test('barTop == the y where the wall/zone verticals actually top out (skeptic F1)', () => {
    // full-height wall: cmuWall's own bar formula (bond-beam mid-height)
    const wall = makeWall() // 2.4 m → 11 full courses
    const members = cmuWall(wall, { ...DEFAULT_SPEC, detail: '400' })
    const vert = members.find((m) => m.label?.startsWith('#5 vertical'))
    const vertTop = (vert?.position[1] ?? 0) + (vert?.dims[1] ?? 0) / 2
    expect(cmuDowelPositions(wall).barTop).toBeCloseTo(vertTop, 6)
    // knee wall: the ZONE's bar top — the seam story, NOT the wall top
    const knee = cmuDowelPositions(wall, 0.61) // snaps to 3 courses
    expect(knee.barTop).toBeCloseTo(3 * H - H / 2, 6) // 0.508 m — 20"
    // one-course knee: bond-beam mid-height of the single course
    expect(cmuDowelPositions(wall, 0.2).barTop).toBeCloseTo(H / 2, 6)
  })

  test('MIXED wall: dowels stay inside the inset CMU zone run (never in the butt joint)', () => {
    const wall = makeWall({ id: 'wall_mx', thickness: 0.2032 })
    const neighbor = makeWall({ id: 'wall_nb', start: [4, 0], end: [4, 3], thickness: 0.2032 })
    const { us } = cmuDowelPositions(wall, 1.22, [neighbor])
    expect(us.length).toBeGreaterThan(0)
    // the end corner butts: the zone retreats, and so must the dowels
    const { endInset } = mixedWallInsets(wall, [neighbor])
    expect(endInset).toBeGreaterThan(0)
    for (const u of us) {
      expect(u).toBeGreaterThanOrEqual(CELL_CENTER - 1e-9)
      expect(u).toBeLessThanOrEqual(4 - endInset - CELL_CENTER + 1e-9)
    }
  })

  test('mixed height at/above every fitting course = the full-height layout (regression seam)', () => {
    const wall = makeWall()
    expect(cmuDowelPositions(wall, 99, [])).toEqual(cmuDowelPositions(wall))
  })

  test('guards: curved walls and sub-course walls carry no dowels', () => {
    expect(cmuDowelPositions(makeWall({ curved: true }))).toEqual({ us: [], barTop: 0 })
    expect(cmuDowelPositions(makeWall({ height: 0.15 }))).toEqual({ us: [], barTop: 0 })
  })
})

// ---------------------------------------------------------------------------
// CMU face bury — the painted-host z-fight fix (prod report 2026-08-23)
// ---------------------------------------------------------------------------
// A CMU wall painted with ANY host material (even a flat white color)
// flickered/z-fought camera-dependently: the block outer faces sat EXACTLY
// on the host wall's drawn face planes (±thickness/2 — the host default
// 0.1m wall is thinner than the 7-5/8" unit, so depth clamped to the drawn
// thickness). The unpainted case only LOOKED clean because the plugin's
// wall mode keeps the host face transparent + depthWrite:false; painting
// resurrects an opaque host face and the two contest the depth buffer.
// The fix is geometric and paint-state independent: every CMU face sits
// ≥ CMU_FACE_BURY strictly inside the drawn planes (the DUCT_JUNCTION_BURY
// precedent, hvac.ts). These are the coplanarity detector gates — reverting
// the bury (depth = min(thickness, BLOCK_DEPTH_ACTUAL)) kills them.

import { FramingNode } from '../framing/schema'
import { computeLevel } from '../framing/compute'

describe('CMU face bury — block faces sit strictly inside the drawn wall faces', () => {
  /** Across-wall face offset of a member on an X-aligned wall (centerline
   * z = 0): |v-center| + half the across-wall dim. */
  const faceOffset = (m: Member): number => Math.abs(m.position[2] ?? 0) + m.dims[2] / 2

  test('default 0.1m host wall: EVERY member face ≤ t/2 − CMU_FACE_BURY (strictly inside)', () => {
    const wall = makeWall({ thickness: 0.1, openings: [window_(2)] })
    const members = cmuWall(wall, DEFAULT_SPEC)
    // Non-vacuous: blocks, lintel, bond beam and rebar are all in the sweep.
    for (const role of ['block', 'lintel', 'bond-beam', 'rebar']) {
      expect(byRole(members, role).length).toBeGreaterThan(0)
    }
    for (const m of members) {
      expect(faceOffset(m)).toBeLessThanOrEqual(0.05 - CMU_FACE_BURY + 1e-9)
    }
    // The blocks did not vanish making room for the bury.
    expect(byRole(members, 'block')[0]?.dims[2]).toBeCloseTo(0.1 - 2 * CMU_FACE_BURY, 9)
  })

  test('thinnest host wall (0.05m panel floor): the full 5mm bury still holds', () => {
    // The host wall panel clamps thickness to ≥ 0.05m (wall-panel.tsx
    // Math.max(0.05, v)) — at that floor the blocks keep 0.04m of depth,
    // no degenerate handling needed and no flag.
    const members = cmuWall(makeWall({ thickness: 0.05 }), DEFAULT_SPEC)
    expect(byRole(members, 'block')[0]?.dims[2]).toBeCloseTo(0.04, 9)
    for (const m of members.filter((x) => x.material === 'concrete')) {
      expect(faceOffset(m)).toBeLessThanOrEqual(0.025 - CMU_FACE_BURY + 1e-9)
    }
    expect(members.some((m) => m.flag?.includes(THIN_BURY_FLAG))).toBe(false)
  })

  test('degenerate sub-2cm wall (raw-API only): depth floors at t/2 — flagged, never vanishing', () => {
    // Below 4×bury the full bury would leave ≤ half the wall; the floor
    // keeps blocks at HALF the drawn thickness (bury degrades to t/4 per
    // side — still strictly inside) and the bond beam confesses.
    const members = cmuWall(makeWall({ thickness: 0.015 }), DEFAULT_SPEC)
    const block = byRole(members, 'block')[0] as Member
    expect(block.dims[2]).toBeCloseTo(0.0075, 9)
    expect(block.dims[2]).toBeGreaterThan(0)
    // Masonry stays strictly inside the drawn planes (rebar excluded: a
    // 5/8" bar is physically deeper than a 15mm wall — garbage-in class,
    // pre-existing at every thickness < the bar size).
    for (const m of members.filter((x) => x.material === 'concrete')) {
      expect(faceOffset(m)).toBeLessThan(0.0075)
    }
    expect(byRole(members, 'bond-beam')[0]?.flag).toBe(THIN_BURY_FLAG)
  })

  test('mixed knee wall on the default 0.1m wall: both zones strictly inside', () => {
    const { members } = mixedCmuWall(makeWall({ thickness: 0.1 }), DEFAULT_SPEC, 1.0)
    for (const role of ['block', 'bond-beam', 'mudsill', 'anchor-bolt', 'stud']) {
      expect(byRole(members, role).length).toBeGreaterThan(0)
    }
    for (const m of members) {
      expect(faceOffset(m)).toBeLessThanOrEqual(0.05 - CMU_FACE_BURY + 1e-9)
    }
  })

  test('corner interlock: through-blocks stay buried in BOTH walls of the pair', () => {
    // Perpendicular 0.1m walls sharing the corner at the origin — the
    // interlock extends blocks ALONG the neighbor (u), never across (v),
    // so every member must still hold its own wall's bury.
    const a = makeWall({ id: 'wall_a', thickness: 0.1 })
    const b = makeWall({ id: 'wall_b', thickness: 0.1, start: [0, 0], end: [0, 4] })
    const members = cmuWalls([a, b], DEFAULT_SPEC)
    expect(members.length).toBeGreaterThan(0)
    for (const m of members) {
      // wall_a runs along X (centerline z=0); wall_b along Z (centerline x=0)
      const v = m.sourceId === 'wall_a' ? (m.position[2] ?? 0) : (m.position[0] ?? 0)
      expect(Math.abs(v) + m.dims[2] / 2).toBeLessThanOrEqual(0.05 - CMU_FACE_BURY + 1e-9)
    }
  })

  test('computeLevel CMU scene (the E5 substitute — the baseline corpus has no CMU walls): end-to-end bury', () => {
    // The master-baseline scene contains NO CMU walls (recaptured
    // byte-identical under the bury), so the end-to-end truth lives here:
    // a host-default-thickness CMU shell through computeLevel — the exact
    // prod configuration that flickered (default walls carry NO thickness
    // field; extractWalls defaults to 0.1m).
    const wallNode = (id: string, start: [number, number], end: [number, number]) => ({
      id,
      type: 'wall',
      parentId: 'level_1',
      start,
      end,
      height: 2.5,
      frontSide: 'exterior',
      backSide: 'interior',
      children: [],
    })
    const scene = {
      level_1: { id: 'level_1', type: 'level', level: 0, height: 2.5 },
      w_s: wallNode('w_s', [0, 0], [6, 0]),
      w_e: wallNode('w_e', [6, 0], [6, 4]),
      w_n: wallNode('w_n', [6, 4], [0, 4]),
      w_w: wallNode('w_w', [0, 4], [0, 0]),
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
    expect(result.members.some((m) => m.role === 'block')).toBe(true)
    // Each wall's centerline: w_s z=0 alongX · w_n z=4 alongX · w_w x=0
    // alongZ · w_e x=6 alongZ. Across-wall extent per member vs its OWN
    // wall, strictly inside 0.1/2 − CMU_FACE_BURY.
    const centerline: Record<string, { axis: 0 | 2; at: number }> = {
      w_s: { axis: 2, at: 0 },
      w_n: { axis: 2, at: 4 },
      w_w: { axis: 0, at: 0 },
      w_e: { axis: 0, at: 6 },
    }
    let swept = 0
    for (const m of result.members) {
      const line = centerline[m.sourceId ?? '']
      if (!line) continue
      swept += 1
      const v = Math.abs((m.position[line.axis] ?? 0) - line.at)
      expect(v + m.dims[2] / 2).toBeLessThanOrEqual(0.05 - CMU_FACE_BURY + 1e-9)
    }
    expect(swept).toBeGreaterThan(100) // the sweep really saw the shell
  })
})
