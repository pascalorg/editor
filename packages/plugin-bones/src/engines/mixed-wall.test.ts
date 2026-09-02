import { describe, expect, test } from 'bun:test'
import { DEFAULT_SPEC } from '../core/spec'
import type { Member, OpeningSlice, WallSlice } from '../core/types'
import { inches } from '../core/units'
import { FramingNode } from '../framing/schema'
import { computeLevel } from '../framing/compute'
import { anchorBoltPositions } from './foundation'
import { computeTakeoff, cutList, type TakeoffRow } from './takeoff'
import { frameWall } from './wall-framing'
import {
  COURSE_HEIGHT,
  SEAM_CROSSING_FLAG,
  cmuWall,
  mixedCmuWall,
  snapCmuHeight,
} from './cmu'

/**
 * GATES — mixed CMU/framed wall construction (board spec 2026-08-16):
 *  1. member composition of a 50% split: courses below the seam, bond beam
 *     at seam top, PT sill + R403.1.6 anchor bolts on it, shortened framed
 *     zone above with its own bottom/top plates (no-overlap SAT lives in
 *     interpenetration.test.ts);
 *  2. crossing-opening flag + taller-zone framing;
 *  3. full-height unchanged vs today (object override ≡ string override);
 *  4. openings zoned entirely above/below keep their zone's own logic.
 */

const H = COURSE_HEIGHT // 0.2032
const PAD = inches(1.5)

const spec = DEFAULT_SPEC
const SILL_T = inches(1.5) // 2x plate stock thickness

function makeWall(overrides: Partial<WallSlice> = {}): WallSlice {
  const start = overrides.start ?? [0, 0]
  const end = overrides.end ?? [6, 0]
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  return {
    id: 'wall_mix',
    start,
    end,
    length,
    dir: [dx / length, dz / length],
    thickness: 0.2,
    height: 2.44,
    exterior: true,
    openings: [],
    curved: false,
    ...overrides,
  }
}

function door(u: number, width = 0.9, height = 2.1): OpeningSlice {
  return {
    id: 'door_mix',
    kind: 'door',
    u,
    width,
    height,
    sillHeight: 0,
    roughWidth: width + PAD,
    roughHeight: height + PAD,
  }
}

function window_(u: number, width = 1.2, height = 1.0, sillHeight = 0.7): OpeningSlice {
  return {
    id: 'win_mix',
    kind: 'window',
    u,
    width,
    height,
    sillHeight,
    roughWidth: width + PAD,
    roughHeight: height + PAD,
  }
}

const byRole = (members: Member[], role: string): Member[] =>
  members.filter((m) => m.role === role)
const top = (m: Member): number => (m.position[1] ?? 0) + m.dims[1] / 2
const bottom = (m: Member): number => (m.position[1] ?? 0) - m.dims[1] / 2

describe('mixedCmuWall — member composition of a 50% split', () => {
  const wall = makeWall() // 6m × 2.44m — 12 courses fit
  const seam = snapCmuHeight(1.22, wall.height) // 6 courses = 1.2192
  const { members, warnings } = mixedCmuWall(wall, spec, 1.22)
  const framedBase = seam + SILL_T

  test('the seam snaps to whole courses (6 of 12)', () => {
    expect(seam).toBeCloseTo(6 * H, 9)
    expect(warnings).toEqual([])
  })

  test('block courses stay below the seam — 5 body courses under the beam', () => {
    const blocks = byRole(members, 'block')
    expect(blocks.length).toBeGreaterThan(0)
    for (const b of blocks) expect(top(b)).toBeLessThanOrEqual(seam - H + 1e-6)
    // distinct course centers: 5 body courses (top course is the bond beam)
    const centers = new Set(blocks.map((b) => Math.round((b.position[1] ?? 0) * 1e6)))
    expect(centers.size).toBe(5)
  })

  test('bond beam is the CMU zone top course — nominal top exactly at the seam', () => {
    const beams = byRole(members, 'bond-beam')
    expect(beams).toHaveLength(1)
    const beam = beams[0] as Member
    expect(beam.position[1]).toBeCloseTo(5 * H + H / 2, 6)
    expect(beam.grouted ?? beam.label?.includes('grouted')).toBeTruthy()
  })

  test('PT sill plate sits ON the bond beam (pt-lumber mudsill, full run)', () => {
    const sills = byRole(members, 'mudsill')
    expect(sills).toHaveLength(1)
    const sill = sills[0] as Member
    expect(sill.material).toBe('pt-lumber')
    expect(sill.system).toBe('wall-framing')
    expect(bottom(sill)).toBeCloseTo(seam, 6)
    expect(sill.dims[0]).toBeCloseTo(wall.length, 6)
    expect(sill.label).toContain('R403.1.6')
  })

  test('anchor bolts at R403.1.6 spacing, embedded 7" into the beam, flush with the sill top', () => {
    const bolts = byRole(members, 'anchor-bolt')
    const expected = anchorBoltPositions(
      wall.length,
      spec.anchorBoltSpacing,
      spec.anchorBoltEndDistance,
    )
    expect(bolts.length).toBe(expected.length) // ≤6' o.c., ends within 12", ≥2
    expect(bolts.length).toBeGreaterThanOrEqual(2)
    for (const bolt of bolts) {
      expect(bottom(bolt)).toBeCloseTo(seam - inches(7), 6) // 7" embedment
      expect(top(bolt)).toBeCloseTo(seam + SILL_T, 6) // nut lands on the plate
      expect(bolt.material).toBe('steel')
    }
  })

  test('framed zone has its OWN bottom/top plates and tops out at the wall height', () => {
    const bottoms = byRole(members, 'bottom-plate')
    expect(bottoms).toHaveLength(1)
    expect(bottom(bottoms[0] as Member)).toBeCloseTo(framedBase, 6)
    const tops = byRole(members, 'top-plate')
    expect(tops).toHaveLength(1)
    expect(top(tops[0] as Member)).toBeCloseTo(wall.height, 6)
    const caps = byRole(members, 'cap-plate')
    expect(caps).toHaveLength(1)
    expect(top(caps[0] as Member)).toBeCloseTo(wall.height - SILL_T, 6)
  })

  test('studs are shortened to the framed zone — nothing framed dips below the sill top', () => {
    const studs = byRole(members, 'stud')
    expect(studs.length).toBeGreaterThan(3)
    for (const s of studs) {
      expect(bottom(s)).toBeCloseTo(framedBase + SILL_T, 6) // on the zone's bottom plate
      expect(top(s)).toBeCloseTo(wall.height - 2 * SILL_T, 6) // under the double top plate
    }
    // zone partition: every non-steel member is fully below the seam (CMU)
    // or fully above it (sill + framed zone) — the seam is a clean plane.
    for (const m of members) {
      if (m.role === 'anchor-bolt') continue // bolts thread the seam by design
      const isCmu = m.role === 'block' || m.role === 'bond-beam' || m.role === 'rebar'
      if (isCmu) expect(top(m)).toBeLessThanOrEqual(seam + 1e-6)
      else expect(bottom(m)).toBeGreaterThanOrEqual(seam - 1e-6)
    }
  })
})

describe('mixedCmuWall — openings zoned per the seam', () => {
  test('opening entirely BELOW the seam keeps CMU lintel logic in its zone', () => {
    // 9 courses ≈ 1.83m of CMU; a low window (0.3–1.0m) sits fully in block.
    const wall = makeWall({ openings: [window_(3, 1.2, 0.7, 0.3)] })
    const { members, warnings } = mixedCmuWall(wall, spec, 9 * H)
    expect(warnings).toEqual([])
    const lintels = byRole(members, 'lintel')
    expect(lintels).toHaveLength(1)
    expect(lintels[0]?.label).toContain('precast lintel')
    // no framed opening hardware in the short zone above
    expect(byRole(members, 'header')).toHaveLength(0)
    expect(byRole(members, 'king-stud')).toHaveLength(0)
  })

  test('opening entirely ABOVE the seam gets king/trimmer/header logic, positioned true', () => {
    // 3 courses ≈ 0.61m knee wall; window at sill 0.9m is fully framed-zone.
    const wall = makeWall({ openings: [window_(3, 1.2, 1.0, 0.9)] })
    const seam = snapCmuHeight(3 * H, wall.height)
    const { members, warnings } = mixedCmuWall(wall, spec, 3 * H)
    expect(warnings).toEqual([])
    expect(byRole(members, 'lintel')).toHaveLength(0)
    const headers = byRole(members, 'header')
    expect(headers).toHaveLength(1)
    // header bottom lands at the TRUE rough-opening head (wall coordinates)
    expect(bottom(headers[0] as Member)).toBeCloseTo(0.9 + 1.0 + PAD, 6)
    expect(byRole(members, 'king-stud')).toHaveLength(2)
    // rough sill at the true window sill height
    const sills = byRole(members, 'sill')
    expect(sills).toHaveLength(1)
    expect(top(sills[0] as Member)).toBeCloseTo(0.9, 6)
    expect(seam).toBeCloseTo(3 * H, 9)
  })

  test('opening CROSSING the seam: flag + framed as if fully in the taller zone', () => {
    // 3-course knee wall, full-height door → crosses; framed zone is taller.
    const wall = makeWall({ openings: [door(3)] })
    const seam = snapCmuHeight(3 * H, wall.height)
    const { members, warnings } = mixedCmuWall(wall, spec, 3 * H)
    // 1. the canonical warning names the opening
    expect(warnings.some((w) => w.includes(SEAM_CROSSING_FLAG))).toBe(true)
    expect(warnings.some((w) => w.includes('door_mix'))).toBe(true)
    // 2. the bond beam (the seam element) carries the canonical flag so the
    //    takeoff Flags section surfaces it
    const beam = byRole(members, 'bond-beam')[0] as Member
    expect(beam.flag).toBe(SEAM_CROSSING_FLAG)
    // 3. framed zone frames the door: header at the true head height
    const headers = byRole(members, 'header')
    expect(headers).toHaveLength(1)
    expect(bottom(headers[0] as Member)).toBeCloseTo(2.1 + PAD, 6)
    expect(byRole(members, 'trimmer').length).toBeGreaterThanOrEqual(2)
    // 4. blockwork cuts clear of the RO below the seam — no lintel, no block
    //    inside the rough width
    expect(byRole(members, 'lintel')).toHaveLength(0)
    const roLo = 3 - (0.9 + PAD) / 2
    const roHi = 3 + (0.9 + PAD) / 2
    for (const b of byRole(members, 'block')) {
      const lo = (b.position[0] ?? 0) - b.dims[0] / 2
      const hi = (b.position[0] ?? 0) + b.dims[0] / 2
      expect(hi <= roLo + 1e-6 || lo >= roHi - 1e-6).toBe(true)
    }
    expect(seam).toBeCloseTo(3 * H, 9)
  })

  test('crossing opening with the CMU zone taller stays CMU-handled (jamb cuts, flag, no phantom header)', () => {
    // 9-course CMU (≈1.83m) with a window 1.5–2.1m → crosses a high seam.
    const wall = makeWall({ openings: [window_(3, 1.2, 0.6, 1.5)] })
    const { members, warnings } = mixedCmuWall(wall, spec, 9 * H)
    expect(warnings.some((w) => w.includes(SEAM_CROSSING_FLAG))).toBe(true)
    // framed zone is shorter than the CMU zone — no framed opening hardware
    expect(byRole(members, 'header')).toHaveLength(0)
    // no lintel either: the head is above the blockwork zone
    expect(byRole(members, 'lintel')).toHaveLength(0)
    const beam = byRole(members, 'bond-beam')[0] as Member
    expect(beam.flag).toBe(SEAM_CROSSING_FLAG)
  })
})

describe('mixedCmuWall — sill at the seam (RO-aware plate flag + bolt layout)', () => {
  test('crossing door: sill carries the seam flag, bolts skip the RO, segments keep R403.1.6', () => {
    const wall = makeWall({ openings: [door(3)] })
    const { members } = mixedCmuWall(wall, spec, 3 * H)
    // (a) the continuous plate passes through the door RO — seam flag on it
    const sill = byRole(members, 'mudsill')[0] as Member
    expect(sill.flag).toBe(SEAM_CROSSING_FLAG)
    // (b) no bolt lands inside the rough opening
    const roLo = 3 - (0.9 + PAD) / 2
    const roHi = 3 + (0.9 + PAD) / 2
    const us = byRole(members, 'anchor-bolt')
      .map((b) => b.position[0] ?? 0)
      .sort((a, b) => a - b)
    for (const u of us) expect(u <= roLo + 1e-6 || u >= roHi - 1e-6).toBe(true)
    // each remaining plate segment keeps its OWN R403.1.6 layout: ≥2 bolts,
    // first/last within 12" of the segment ends, gaps ≤ the 6' spacing
    const left = us.filter((u) => u < roLo)
    const right = us.filter((u) => u > roHi)
    expect(left.length).toBeGreaterThanOrEqual(2)
    expect(right.length).toBeGreaterThanOrEqual(2)
    expect(left[0] as number).toBeLessThanOrEqual(inches(12) + 1e-6)
    expect(roLo - (left[left.length - 1] as number)).toBeLessThanOrEqual(inches(12) + 1e-6)
    expect((right[0] as number) - roHi).toBeLessThanOrEqual(inches(12) + 1e-6)
    expect(wall.length - (right[right.length - 1] as number)).toBeLessThanOrEqual(
      inches(12) + 1e-6,
    )
    for (const seg of [left, right]) {
      for (let i = 0; i + 1 < seg.length; i++) {
        expect((seg[i + 1] as number) - (seg[i] as number)).toBeLessThanOrEqual(
          spec.anchorBoltSpacing + 1e-6,
        )
      }
    }
  })

  test('no RO in the sill band: plate unflagged, bolt layout unchanged', () => {
    const wall = makeWall({ openings: [window_(3, 1.2, 1.0, 0.9)] }) // fully above the seam
    const { members } = mixedCmuWall(wall, spec, 3 * H)
    const sill = byRole(members, 'mudsill')[0] as Member
    expect(sill.flag).toBeUndefined()
    const expected = anchorBoltPositions(
      wall.length,
      spec.anchorBoltSpacing,
      spec.anchorBoltEndDistance,
    )
    expect(byRole(members, 'anchor-bolt')).toHaveLength(expected.length)
  })
})

describe('mixedCmuWall — full-height regression (unchanged vs today)', () => {
  test('a height at/above every course that fits = exactly today\'s cmuWall', () => {
    const wall = makeWall({ openings: [window_(2)] })
    expect(mixedCmuWall(wall, spec, wall.height).members).toEqual(cmuWall(wall, spec))
    expect(mixedCmuWall(wall, spec, 99).members).toEqual(cmuWall(wall, spec))
    expect(mixedCmuWall(wall, spec, 12 * H).members).toEqual(cmuWall(wall, spec))
  })

  test('a wall shorter than one course lays nothing, exactly like today', () => {
    const stub = makeWall({ height: 0.15 })
    expect(mixedCmuWall(stub, spec, 0.1).members).toEqual(cmuWall(stub, spec))
    expect(mixedCmuWall(stub, spec, 0.1).members).toEqual([])
  })

  test('curved walls return empty (flagged upstream), as today', () => {
    const curved = makeWall({ curved: true })
    expect(mixedCmuWall(curved, spec, 1.2).members).toEqual([])
  })
})

/**
 * computeLevel dispatch: the object override routes through the mixed
 * engine; the object WITHOUT a height and the plain string stay byte-equal
 * (full-height unchanged); the layers-v1 note surfaces once.
 */
describe('computeLevel — mixed wall dispatch', () => {
  function scene(): Record<string, Record<string, unknown>> {
    return {
      level_1: { id: 'level_1', type: 'level', level: 0, height: 2.7 },
      wall_a: {
        id: 'wall_a',
        type: 'wall',
        parentId: 'level_1',
        start: [0, 0],
        end: [6, 0],
        thickness: 0.2,
        height: 2.44,
        frontSide: 'exterior',
        backSide: 'interior',
        children: [],
      },
    }
  }
  const config = (wallOverrides: Record<string, unknown>) => {
    const parsed = FramingNode.parse({
      jurisdiction: 'INTL',
      showFloor: false,
      showRoof: false,
      showFoundation: false,
      wallOverrides,
    })
    return { ...parsed, parentId: 'level_1' as FramingNode['parentId'] }
  }

  test('object override with a height splits the wall (blocks below, studs above)', () => {
    const result = computeLevel(scene(), config({ wall_a: { construction: 'cmu', cmuHeightM: 1.22 } }))
    const mine = result.members.filter((m) => m.sourceId === 'wall_a')
    expect(mine.some((m) => m.role === 'block')).toBe(true)
    expect(mine.some((m) => m.role === 'mudsill' && m.material === 'pt-lumber')).toBe(true)
    expect(mine.some((m) => m.role === 'anchor-bolt')).toBe(true)
    expect(mine.some((m) => m.role === 'stud')).toBe(true)
    expect(result.warnings.some((w) => w.includes('assembly layers follow the CMU treatment'))).toBe(
      true,
    )
  })

  test('object override without a height ≡ the plain string (full height, as today)', () => {
    const viaObject = computeLevel(scene(), config({ wall_a: { construction: 'cmu' } }))
    const viaString = computeLevel(scene(), config({ wall_a: 'cmu' }))
    expect(viaObject.members).toEqual(viaString.members)
    expect(viaObject.warnings).toEqual(viaString.warnings)
    expect(viaObject.members.some((m) => m.role === 'mudsill')).toBe(false)
  })

  test('a height snapping to every course that fits ≡ the plain string too', () => {
    const viaFull = computeLevel(scene(), config({ wall_a: { construction: 'cmu', cmuHeightM: 2.44 } }))
    const viaString = computeLevel(scene(), config({ wall_a: 'cmu' }))
    expect(viaFull.members).toEqual(viaString.members)
  })
})

/**
 * GATE — takeoff deltas (board spec): block count for the CMU zone only,
 * studs shortened to the framed zone, the PT sill + its R403.1.6 bolts
 * booked, and the crossing flag surfacing in the Flags section.
 */
describe('mixed wall — takeoff deltas', () => {
  const wall = makeWall() // 6m × 2.44m, 0.2 thick → 2x6 framing
  const mixed = mixedCmuWall(wall, spec, 1.22).members
  const mixedRows = computeTakeoff(mixed, [])
  const fullCmuRows = computeTakeoff(cmuWall(wall, spec), [])
  const find = (rows: TakeoffRow[], item: string, detail?: string) =>
    rows.find((r) => r.item === item && (detail === undefined || r.detail.includes(detail)))

  test('block count books the CMU zone only — fewer than the full-height wall', () => {
    const zoneBlocks = find(mixedRows, 'CMU block')?.quantity ?? 0
    const fullBlocks = find(fullCmuRows, 'CMU block')?.quantity ?? 0
    expect(zoneBlocks).toBe(byRole(mixed, 'block').length) // counted, not estimated
    expect(zoneBlocks).toBeGreaterThan(0)
    expect(zoneBlocks).toBeLessThan(fullBlocks)
    // mortar follows the block count down too
    const zoneMortar = find(mixedRows, 'Mortar (Type S)')?.quantity ?? 0
    const fullMortar = find(fullCmuRows, 'Mortar (Type S)')?.quantity ?? 0
    expect(zoneMortar).toBeLessThanOrEqual(fullMortar)
  })

  test('PT sill books on its own pressure-treated line (one 20-ft stick for 6m)', () => {
    const pt = find(mixedRows, '2x6 PT', 'ft stock (pressure-treated)')
    expect(pt?.quantity).toBe(1)
    expect(pt?.section).toBe('Wall framing')
    // and it never inflates the untreated 2x6 stick count for that stock
    expect(find(fullCmuRows, '2x6 PT')).toBeUndefined()
  })

  test('seam anchor bolts book under Wall framing with the R403.1.6 cite', () => {
    const bolts = find(mixedRows, 'Anchor bolts', 'seam sill to bond beam (R403.1.6)')
    expect(bolts?.section).toBe('Wall framing')
    expect(bolts?.quantity).toBe(byRole(mixed, 'anchor-bolt').length)
    expect(bolts?.quantity).toBe(
      anchorBoltPositions(wall.length, spec.anchorBoltSpacing, spec.anchorBoltEndDistance).length,
    )
    // the full-height CMU wall has no seam hardware
    expect(find(fullCmuRows, 'Anchor bolts')).toBeUndefined()
  })

  test('studs are SHORTENED: the cut list carries zone-height studs, not full-height', () => {
    const seam = snapCmuHeight(1.22, wall.height)
    const zoneStudHeight = wall.height - seam - SILL_T - 3 * SILL_T // sill + bottom + 2 top plates
    const mixedStuds = cutList(mixed).filter((r) => r.role === 'stud')
    expect(mixedStuds).toHaveLength(1)
    expect(mixedStuds[0]?.lengthM).toBeCloseTo(zoneStudHeight, 3)
    const fullStuds = cutList(frameWall(wall, spec)).filter((r) => r.role === 'stud')
    expect(fullStuds[0]?.lengthM).toBeCloseTo(wall.height - 3 * SILL_T, 3)
    expect(mixedStuds[0]?.lengthM ?? 0).toBeLessThan(fullStuds[0]?.lengthM ?? 0)
  })

  test('a crossing opening surfaces as a Flags line', () => {
    const crossing = mixedCmuWall(makeWall({ openings: [door(3)] }), spec, 3 * H).members
    const rows = computeTakeoff(crossing, [])
    const flag = rows.find((r) => r.section === 'Flags' && r.detail === SEAM_CROSSING_FLAG)
    // BOTH seam elements carry the flag: the bond beam (crossing zoning) and
    // the PT sill whose band the door RO passes through (stage 3 — the
    // continuous plate is the part a real detail cuts at the door).
    expect(flag?.quantity).toBe(2)
  })
})

describe('cavity-fit (night-4): mixed wall framed zone + PT sill compress to the drawn wall', () => {
  test('0.15m mixed wall: sill + framed-zone members at thickness − 1"', () => {
    const wall = makeWall({ thickness: 0.15 })
    const { members } = mixedCmuWall(wall, DEFAULT_SPEC, 1.2)
    const cavity = 0.15 - 0.0254
    const sill = members.find((m) => m.role === 'mudsill')
    expect(sill?.dims[2]).toBeCloseTo(cavity, 9)
    const studs = members.filter((m) => m.role === 'stud')
    expect(studs.length).toBeGreaterThan(0)
    for (const s of studs) expect(s.dims[2]).toBeCloseTo(cavity, 9)
  })

  test('block-depth mixed wall (0.2032m) keeps FULL nominal framing', () => {
    const wall = makeWall({ thickness: 0.2032 })
    const { members } = mixedCmuWall(wall, DEFAULT_SPEC, 1.2)
    const sill = members.find((m) => m.role === 'mudsill')
    const stud = members.find((m) => m.role === 'stud')
    expect(sill?.dims[2]).toBeCloseTo(0.1397, 3)
    expect(stud?.dims[2]).toBeCloseTo(0.1397, 3)
    expect(stud?.flag).toBeUndefined()
  })
})
