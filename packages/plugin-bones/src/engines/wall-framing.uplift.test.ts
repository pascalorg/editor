/**
 * LOD-400 B10 — high-wind wall uplift: the path the roof ties start
 * continues stud → plate → foundation (R802.11, R301.2.1/WFCM).
 *
 * Unit gates (frameWall / helper level):
 *  - LA census: one stud-to-plate connector at EVERY full-height vertical
 *    (grid studs, kings, portal posts, corner backing) — coverage is the
 *    stud rhythm itself;
 *  - header/king uplift straps at openings (trimmer line, never B9's king
 *    line);
 *  - plate-to-foundation straps on slab-bearing plates only, 48" o.c.,
 *    door ROs skipped, ends covered;
 *  - dedupe vs existing foundation anchors (J-bolts / HDUs) — one
 *    anchorage point, one booking;
 *  - flat-roof honesty: connectors under a tie-less roof WARN (the B8b
 *    roof-side seam), never silently imply continuity;
 *  - jurisdiction truth: INTL/interior byte-equal; the LA-vs-INTL wall
 *    delta is EXACTLY the uplift hardware.
 * Compute-level gates live below the unit describes (computeLevel composes).
 */

import { describe, expect, test } from 'bun:test'
import { DEFAULT_SPEC, type FramingSpec } from '../core/spec'
import type { Member, OpeningSlice, WallSlice } from '../core/types'
import { feet, inches } from '../core/units'
import { applyJurisdiction, jurisdictionOptions, profileFor } from '../jurisdiction/profiles'
import {
  FOUNDATION_STRAP_SPACING,
  UPLIFT_ANCHOR_DEDUPE_TOL,
  dedupeFoundationStraps,
  frameWall,
  upliftPathWarnings,
} from './wall-framing'

const T = inches(1.5)

const laSpec = (): FramingSpec => applyJurisdiction(DEFAULT_SPEC, profileFor('LA'))
const intlSpec = (): FramingSpec => applyJurisdiction(DEFAULT_SPEC, profileFor('INTL'))

function makeWall(overrides: Partial<WallSlice> = {}): WallSlice {
  const start = overrides.start ?? [0, 0]
  const end = overrides.end ?? [6, 0]
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  return {
    id: 'wall_uplift',
    start,
    end,
    length,
    dir: [dx / length, dz / length],
    thickness: 0.15,
    height: 2.5,
    exterior: true,
    openings: [],
    curved: false,
    ...overrides,
  }
}

const door = (u: number, width = 0.9, height = 2.1): OpeningSlice => ({
  id: `door_${u}`,
  kind: 'door',
  u,
  width,
  height,
  sillHeight: 0,
  roughWidth: width + T,
  roughHeight: height + T,
})

const window_ = (u: number, width = 1.2, height = 1.2, sillHeight = 0.9): OpeningSlice => ({
  id: `win_${u}`,
  kind: 'window',
  u,
  width,
  height,
  sillHeight,
  roughWidth: width + T,
  roughHeight: height + T,
})

const byRole = (members: Member[], role: string): Member[] =>
  members.filter((m) => m.role === role)

const UPLIFT_ROLES = new Set(['uplift-connector', 'uplift-strap', 'foundation-strap'])
const stripUplift = (members: Member[]): unknown[] =>
  JSON.parse(JSON.stringify(members.filter((m) => !UPLIFT_ROLES.has(m.role))))

describe('B10a — stud-to-plate connectors (the LA census)', () => {
  test('one connector at EVERY full-height vertical; steel, surface-mounted, honest label', () => {
    const wall = makeWall({ openings: [door(2), window_(4.2)] })
    const members = frameWall(wall, laSpec())
    const connectors = byRole(members, 'uplift-connector')
    // Full-height verticals = grid studs + king studs + corner-backing
    // extras + portal posts (no trimmers — they stop under the header).
    const verticals = members.filter(
      (m) =>
        (m.role === 'stud' || m.role === 'king-stud' || m.role === 'post') && m.dims[1] > 1,
    )
    expect(connectors.length).toBeGreaterThan(0)
    expect(connectors.length).toBe(verticals.length)
    // ONE connector per vertical, at (or beside) that vertical's u: sorted
    // 1:1 pairing within two strap widths — the dodge ladder may side-step
    // a connector whose spot another surface piece holds (this very wall
    // carries the PRE-EXISTING grid-stud-grazes-king class at 4.90 m —
    // present at INTL too — and the two overlapping studs' connectors
    // rightly refuse to stack).
    const sortedVerts = verticals.map((v) => v.position[0]).sort((a, b) => a - b)
    const sortedConns = connectors.map((c) => c.position[0]).sort((a, b) => a - b)
    for (let i = 0; i < sortedVerts.length; i++) {
      expect(Math.abs((sortedConns[i] ?? 99) - (sortedVerts[i] ?? 0))).toBeLessThanOrEqual(
        2 * inches(1.25) + 1e-9,
      )
    }
    // …and the dodge is the exception, never the rule: most connectors sit
    // exactly on their stud.
    const exact = sortedVerts.filter((v) =>
      sortedConns.some((c) => Math.abs(c - v) < 1e-9),
    ).length
    expect(exact).toBeGreaterThanOrEqual(sortedVerts.length - 1)
    for (const c of connectors) {
      expect(c.material).toBe('steel')
      expect(c.system).toBe('wall-framing')
      // S13 surface convention: 1.2 mm — under the 2 mm SAT skin.
      expect(c.dims[2]).toBeCloseTo(0.0012, 6)
      expect(c.label).toContain('Stud-to-plate connector')
      expect(c.label).toContain('install per strapping schedule')
      expect(c.advisory).toContain('symbolic')
      expect(c.advisory).toContain('not modeled')
      // The connector LAPS the stud/plate joint: it straddles the stud top.
      const studTop = wall.height - 2 * T
      expect(c.position[1] - c.dims[1] / 2).toBeLessThan(studTop)
      expect(c.position[1] + c.dims[1] / 2).toBeGreaterThan(studTop)
      expect(c.position[1] + c.dims[1] / 2).toBeLessThanOrEqual(wall.height + 1e-9)
      // Surface-mounted: proud of the framing face, INSIDE the drawn body.
      expect(Math.abs(c.position[2])).toBeGreaterThan(0)
      expect(Math.abs(c.position[2])).toBeLessThan(wall.thickness / 2)
    }
  })

  test('interior partitions carry no roof uplift — zero hardware', () => {
    const members = frameWall(makeWall({ exterior: false, openings: [door(2)] }), laSpec())
    expect(members.some((m) => UPLIFT_ROLES.has(m.role))).toBe(false)
  })

  test('INTL frames zero uplift hardware; the LA delta is EXACTLY the uplift set', () => {
    const wall = makeWall({ openings: [door(2), window_(4.2)] })
    const intl = frameWall(wall, intlSpec())
    const la = frameWall(wall, laSpec())
    expect(intl.some((m) => UPLIFT_ROLES.has(m.role))).toBe(false)
    // LA snow (low) keeps INTL's header band; frost/seismic touch other
    // engines — the WALL member delta must be the uplift hardware alone.
    expect(stripUplift(la)).toEqual(stripUplift(intl) as never)
    expect(JSON.parse(JSON.stringify(intl))).toEqual(stripUplift(intl) as never)
  })

  test('degenerate pony wall (plates only): no hardware, no throw', () => {
    // H ≤ 4t → studHeight ≤ t → the plates-only early return (no studs,
    // nothing for a connector to tie).
    const members = frameWall(makeWall({ height: 0.14 }), laSpec(), { slabBearing: true })
    expect(members.every((m) => m.role.includes('plate'))).toBe(true)
    expect(members.some((m) => UPLIFT_ROLES.has(m.role))).toBe(false)
  })
})

describe('B10b — header/king uplift straps at openings', () => {
  test('one strap per side per opening, at the trimmer line, lapping header + jack', () => {
    const wall = makeWall({ openings: [door(2), window_(4.2)] })
    const members = frameWall(wall, laSpec())
    const straps = byRole(members, 'uplift-strap')
    expect(straps).toHaveLength(4) // 2 openings × 2 sides
    const trimmers = byRole(members, 'trimmer')
    for (const s of straps) {
      // The strap rides a trimmer's u (the stick the header bears on) —
      // never B9's king line (HI stacks portal straps there).
      expect(
        trimmers.some((tr) => Math.abs(tr.position[0] - s.position[0]) < 1e-6),
      ).toBe(true)
      expect(s.material).toBe('steel')
      expect(s.dims[2]).toBeCloseTo(0.0012, 6)
      expect(s.label).toContain('Header uplift strap')
      expect(s.label).toContain('install per strapping schedule')
      expect(s.advisory).toContain('symbolic')
    }
    // Vertical envelope: the strap crosses its opening's RO top (header
    // seat) — it laps the header side AND the jack below it.
    const headers = byRole(members, 'header')
    for (const h of headers) {
      const near = straps.filter(
        (s) => Math.abs(s.position[0] - h.position[0]) <= h.dims[0] / 2 + 0.01,
      )
      expect(near).toHaveLength(2)
      for (const s of near) {
        const roTop = h.position[1] - h.dims[1] / 2
        expect(s.position[1] - s.dims[1] / 2).toBeLessThan(roTop)
        expect(s.position[1] + s.dims[1] / 2).toBeGreaterThan(roTop)
      }
    }
  })

  test('opening straps and stud-to-plate connectors never share a drawn spot', () => {
    const wall = makeWall({ openings: [door(2, feet(8), 2.1)] }) // doubled trimmers
    const members = frameWall(wall, laSpec())
    const straps = byRole(members, 'uplift-strap')
    const connectors = byRole(members, 'uplift-connector')
    expect(straps).toHaveLength(2)
    for (const s of straps) {
      for (const c of connectors) {
        const overlapU = Math.abs(s.position[0] - c.position[0]) < inches(1.25) - 1e-9
        const overlapY =
          Math.abs(s.position[1] - c.position[1]) < (s.dims[1] + c.dims[1]) / 2 - 1e-9
        expect(overlapU && overlapY).toBe(false)
      }
    }
  })
})

describe('B10c — plate-to-foundation straps (slab-bearing plates only)', () => {
  test('48" o.c. with covered ends; door ROs skipped (no plate to anchor there)', () => {
    const wall = makeWall({ openings: [door(2)] })
    const members = frameWall(wall, laSpec(), { slabBearing: true })
    const straps = byRole(members, 'foundation-strap')
    expect(straps.length).toBeGreaterThan(1)
    const us = straps.map((s) => s.position[0]).sort((a, b) => a - b)
    // Ends covered: first/last strap within half a stud of the run ends.
    expect(us[0] ?? 99).toBeLessThan(0.1)
    expect(us[us.length - 1] ?? 0).toBeGreaterThan(wall.length - 0.1)
    // No bay wider than the stated spacing; across the door RO the ladder
    // may skip AT MOST the point(s) inside the RO — this door is narrower
    // than one spacing step, so even the crossing gap is bounded by TWO
    // steps (a looser exemption let a doubled spacing slip the gate —
    // mutation probe M5).
    const doorSpan: [number, number] = [2 - (0.9 + T) / 2, 2 + (0.9 + T) / 2]
    for (let i = 0; i + 1 < us.length; i++) {
      const a = us[i] as number
      const b = us[i + 1] as number
      const crossesDoor = a < doorSpan[0] && b > doorSpan[1]
      expect(b - a).toBeLessThanOrEqual(
        (crossesDoor ? 2 * FOUNDATION_STRAP_SPACING : FOUNDATION_STRAP_SPACING) + 1e-9,
      )
      // Never inside the RO itself.
      expect(a > doorSpan[0] && a < doorSpan[1]).toBe(false)
    }
    for (const s of straps) {
      // Drawn to the slab line (y=0) up the plate + stud foot — the
      // anchorage below the line is per schedule (advisory), never
      // invented embedment geometry.
      expect(s.position[1] - s.dims[1] / 2).toBeCloseTo(0, 9)
      expect(s.label).toContain('Plate-to-foundation uplift strap')
      expect(s.advisory).toContain('anchorage/embedment per the WFCM/manufacturer schedule')
    }
  })

  test('upper storeys (no slab bearing) book none — the framed floor is not the foundation', () => {
    const members = frameWall(makeWall(), laSpec()) // no slabBearing hint
    expect(byRole(members, 'foundation-strap')).toHaveLength(0)
    expect(byRole(members, 'uplift-connector').length).toBeGreaterThan(0) // (a) still books
  })
})

describe('B10c dedupe — a strap never doubles an existing foundation anchor', () => {
  const strapAt = (x: number): Member => ({
    system: 'wall-framing',
    role: 'foundation-strap',
    dims: [inches(1.25), inches(6), 0.0012],
    length: inches(6),
    position: [x, inches(3), 0.076],
    rotation: [0, 0, 0],
    material: 'steel',
    sourceId: 'w_test',
  })
  const boltAt = (x: number): Member => ({
    system: 'foundation',
    role: 'anchor-bolt',
    dims: [0.016, 0.18, 0.016],
    length: 0.18,
    position: [x, 0.02, 0],
    rotation: [0, 0, 0],
    material: 'steel',
    sourceId: 'w_test',
  })

  test('strap within the 12" window of a J-bolt/HDU is removed; the rest survive', () => {
    const hdu: Member = { ...boltAt(6), role: 'hold-down' }
    const members = [strapAt(0.1), strapAt(1.5), strapAt(6.05), boltAt(0.2), hdu]
    const removed = dedupeFoundationStraps(members)
    expect(removed).toBe(2) // 0.1 (vs bolt @0.2) + 6.05 (vs HDU @6)
    const straps = members.filter((m) => m.role === 'foundation-strap')
    expect(straps).toHaveLength(1)
    expect(straps[0]?.position[0]).toBeCloseTo(1.5, 9)
  })

  test('no foundation anchors in the result → the full ladder stands (toggle honesty)', () => {
    const members = [strapAt(0.1), strapAt(1.5)]
    expect(dedupeFoundationStraps(members)).toBe(0)
    expect(members).toHaveLength(2)
  })

  test('wall-framing anchor bolts (the mixed-wall seam sill) never dedupe a strap', () => {
    const seamBolt: Member = { ...boltAt(0.15), system: 'wall-framing' }
    const members = [strapAt(0.1), seamBolt]
    expect(dedupeFoundationStraps(members)).toBe(0)
  })
})

describe('B10d — flat-roof honesty (the B8b seam): a wall-only path is stated', () => {
  const connector = (): Member => ({
    system: 'wall-framing',
    role: 'uplift-connector',
    dims: [inches(1.25), inches(5), 0.0012],
    length: inches(5),
    position: [1, 2.4, 0.076],
    rotation: [0, 0, 0],
    material: 'steel',
    sourceId: 'w_test',
  })
  const rafter = (roofId: string): Member => ({
    system: 'roof-framing',
    role: 'rafter',
    size: '2x6',
    dims: [4, 0.14, 0.038],
    length: 4,
    position: [0, 2.6, 0],
    rotation: [0, 0, 0],
    material: 'lumber',
    sourceId: roofId,
  })
  const tie = (roofId: string): Member => ({
    system: 'roof-framing',
    role: 'blocking',
    dims: [inches(1.5), inches(3), inches(3)],
    length: inches(3),
    position: [0, 2.5, 2],
    rotation: [0, 0, 0],
    material: 'steel',
    sourceId: roofId,
    label: 'hurricane tie',
  })

  test('connectors + a tie-less roof → ONE warning naming the roof and the gap', () => {
    const warnings = upliftPathWarnings([connector(), rafter('roof_flat')])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('roof roof_flat')
    expect(warnings[0]).toContain('NO hurricane ties')
    expect(warnings[0]).toContain('R802.11')
    // NIGHT-10 INTENDED-CHANGE (residual 4): the parenthetical used to read
    // 'flat roofs model no rafter/plate ties today' — stale since B8b
    // landed flat ties (every shipped shape ties under high wind now; this
    // warning is the guard for FUTURE tie-less shapes, exercised here
    // synthetically). The generic truth is pinned; the stale claim banned.
    expect(warnings[0]).toContain('(this roof models no tie members at its bearing)')
    expect(warnings[0]).not.toContain('flat roofs model no rafter/plate ties')
  })

  test('a tied roof is a complete story — silent; per-roof judgment on mixed scenes', () => {
    expect(upliftPathWarnings([connector(), rafter('roof_g'), tie('roof_g')])).toEqual([])
    const mixed = upliftPathWarnings([
      connector(),
      rafter('roof_g'),
      tie('roof_g'),
      rafter('roof_flat'),
    ])
    expect(mixed).toHaveLength(1)
    expect(mixed[0]).toContain('roof_flat')
  })

  test('no wall connectors (INTL / roofless levels) → never a statement', () => {
    expect(upliftPathWarnings([rafter('roof_flat')])).toEqual([])
    expect(upliftPathWarnings([])).toEqual([])
  })

  test('wooden roof blocking is not a tie — only steel counts', () => {
    const woodBlocking: Member = { ...tie('roof_f'), material: 'lumber' }
    const warnings = upliftPathWarnings([connector(), rafter('roof_f'), woodBlocking])
    expect(warnings).toHaveLength(1)
  })
})

describe('B10 jurisdiction wiring — the spec flag follows the data trigger', () => {
  test('LA/HI/FL (≥130 mph + hurricaneTies) set highWindUplift; TX and the sub-130 coastal belt do not', () => {
    expect(laSpec().highWindUplift).toBe(true)
    expect(applyJurisdiction(DEFAULT_SPEC, profileFor('HI')).highWindUplift).toBe(true)
    expect(applyJurisdiction(DEFAULT_SPEC, profileFor('FL')).highWindUplift).toBe(true)
    // TX carries hurricaneTies (roof belt-and-braces) at 115 mph — the
    // WALL path stays off: E5's TX baseline must remain byte-identical.
    const tx = applyJurisdiction(DEFAULT_SPEC, profileFor('TX'))
    expect(profileFor('TX').hurricaneTies).toBe(true)
    expect(tx.hurricaneTies).toBe(true)
    expect(tx.highWindUplift).toBe(false)
    expect(intlSpec().highWindUplift).toBe(false)
    expect(DEFAULT_SPEC.highWindUplift).toBe(false)
  })

  test('the wall engine keys on highWindUplift, never the broader hurricaneTies (TX walls untouched)', () => {
    const tx = applyJurisdiction(DEFAULT_SPEC, profileFor('TX'))
    const wall = makeWall({ openings: [door(2)] })
    const members = frameWall(wall, tx, { slabBearing: true })
    expect(members.some((m) => UPLIFT_ROLES.has(m.role))).toBe(false)
    expect(stripUplift(members)).toEqual(
      JSON.parse(JSON.stringify(frameWall(wall, intlSpec(), { slabBearing: true }))) as never,
    )
  })
})

// ---------------------------------------------------------------------------
// B10 compute-level composes: the path assembles end-to-end through
// computeLevel — census on a real scene, the foundation-anchor dedupe with
// real R403.1.6 bolt layouts, and the flat-roof honesty statement.
// ---------------------------------------------------------------------------

import { FramingNode } from '../framing/schema'
import { computeLevel } from '../framing/compute'

const upliftScene = (
  roofType?: 'flat' | 'gable',
): Record<string, Record<string, unknown>> => {
  const wall = (
    id: string,
    start: [number, number],
    end: [number, number],
    children: string[] = [],
  ) => ({
    id,
    type: 'wall',
    parentId: 'level_1',
    start,
    end,
    thickness: 0.15,
    height: 2.5,
    frontSide: 'exterior',
    children,
  })
  const nodes: Record<string, Record<string, unknown>> = {
    level_1: { id: 'level_1', type: 'level', level: 0, height: 2.5 },
    w_s: wall('w_s', [0, 0], [8, 0], ['door_1']),
    door_1: {
      id: 'door_1',
      type: 'door',
      parentId: 'w_s',
      position: [3, 0, 0],
      width: 0.9,
      height: 2.1,
    },
    w_e: wall('w_e', [8, 0], [8, 6], ['win_1']),
    win_1: {
      id: 'win_1',
      type: 'window',
      parentId: 'w_e',
      position: [3, 0, 0],
      width: 1.2,
      height: 1.2,
      sillHeight: 0.9,
    },
    w_n: wall('w_n', [8, 6], [0, 6]),
    w_w: wall('w_w', [0, 6], [0, 0]),
    slab_1: {
      id: 'slab_1',
      type: 'slab',
      parentId: 'level_1',
      polygon: [
        [0, 0],
        [8, 0],
        [8, 6],
        [0, 6],
      ],
      holes: [],
    },
    room_1: {
      id: 'room_1',
      type: 'zone',
      parentId: 'level_1',
      name: 'Room',
      polygon: [
        [0, 0],
        [8, 0],
        [8, 6],
        [0, 6],
      ],
      boundaryWallIds: ['w_s', 'w_e', 'w_n', 'w_w'],
    },
  }
  if (roofType) {
    nodes.roof_1 = {
      id: 'roof_1',
      type: 'roof',
      parentId: 'level_1',
      position: [4, 2.5, 3],
      rotation: 0,
      children: ['roofseg_1'],
    }
    nodes.roofseg_1 = {
      id: 'roofseg_1',
      type: 'roof-segment',
      parentId: 'roof_1',
      position: [0, 0, 0],
      rotation: 0,
      roofType,
      width: 8,
      depth: 6,
      pitch: roofType === 'flat' ? 0 : 35,
      overhang: 0.3,
      wallHeight: 0,
    }
  }
  return nodes
}

const upliftConfig = (
  jurisdiction: string,
  overrides: Record<string, unknown> = {},
): FramingNode =>
  FramingNode.parse({
    id: 'bonesframing_uplift',
    parentId: 'level_1',
    jurisdiction,
    detail: '400',
    studSpacingIn: 16,
    showWalls: true,
    showFoundation: true,
    showFloor: false,
    showRoof: true,
    showElectrical: false,
    showPlumbing: false,
    showHvac: false,
    ...overrides,
  })

describe('B10 compute composes — the uplift path assembles end-to-end (LA)', () => {
  test('LA census: every wall full-height vertical carries its connector; INTL books zero', () => {
    const la = computeLevel(upliftScene(), upliftConfig('LA'))
    const connectors = la.members.filter((m) => m.role === 'uplift-connector')
    const verticals = la.members.filter(
      (m) =>
        m.system === 'wall-framing' &&
        (m.role === 'stud' || m.role === 'king-stud' || m.role === 'post') &&
        m.dims[1] > 1,
    )
    expect(verticals.length).toBeGreaterThan(20)
    expect(connectors.length).toBe(verticals.length)
    // Opening straps on both walls with openings.
    const straps = la.members.filter((m) => m.role === 'uplift-strap')
    expect(straps).toHaveLength(4)
    const intl = computeLevel(upliftScene(), upliftConfig('INTL'))
    expect(intl.members.some((m) => UPLIFT_ROLES.has(m.role))).toBe(false)
    expect(intl.warnings.some((w) => w.includes('high-wind uplift'))).toBe(false)
  })

  test('foundation straps dedupe against the REAL R403.1.6 bolt layout — and survive between bolts', () => {
    const both = computeLevel(upliftScene(), upliftConfig('LA'))
    const straps = both.members.filter((m) => m.role === 'foundation-strap')
    const anchors = both.members.filter(
      (m) => m.system === 'foundation' && (m.role === 'anchor-bolt' || m.role === 'hold-down'),
    )
    expect(anchors.length).toBeGreaterThan(0)
    expect(straps.length).toBeGreaterThan(0) // the ladder survives between bolts
    for (const s of straps) {
      for (const a of anchors) {
        const d = Math.hypot(a.position[0] - s.position[0], a.position[2] - s.position[2])
        expect(d).toBeGreaterThan(UPLIFT_ANCHOR_DEDUPE_TOL)
      }
    }
    // The dedupe is NON-VACUOUS on this compose: a walls-only result (no
    // foundation → no bolts known) keeps the full ladder — strictly more
    // straps than the both-systems result.
    const wallsOnly = computeLevel(
      upliftScene(),
      upliftConfig('LA', { showFoundation: false }),
    )
    const fullLadder = wallsOnly.members.filter((m) => m.role === 'foundation-strap')
    expect(fullLadder.length).toBeGreaterThan(straps.length)
  })

  test('B8b seam CLOSED: the LA flat compose ties every joist end — the B10 warning dies by construction', () => {
    // B10 shipped this pin as 'the wall-only path is STATED (warning)' while
    // frameFlat called no tieAt. B8b landed the roof side of the seam: the
    // windy flat compose now carries real steel at BOTH bearing ends of
    // every joist, so the wall connectors continue a path the roof STARTS —
    // ties present AND the warning ABSENT, pinned end-to-end. The warning
    // machinery itself stays non-vacuous via the synthetic-member matrix
    // above (a future tie-less roof shape still prints).
    const flat = computeLevel(upliftScene('flat'), upliftConfig('LA'))
    expect(flat.members.some((m) => m.role === 'uplift-connector')).toBe(true)
    const flatTies = flat.members.filter(
      (m) => m.system === 'roof-framing' && m.role === 'blocking' && m.material === 'steel',
    )
    const flatJoists = flat.members.filter(
      (m) => m.system === 'roof-framing' && m.role === 'rafter',
    )
    expect(flatJoists.length).toBeGreaterThan(0)
    expect(flatTies.length).toBe(2 * flatJoists.length) // the B8b census, end-to-end
    expect(flat.warnings.some((w) => w.includes('high-wind uplift'))).toBe(false)
    // Gable: tieAt books per-rafter ties — the story is complete, no warning.
    const gable = computeLevel(upliftScene('gable'), upliftConfig('LA'))
    expect(
      gable.members.some(
        (m) => m.system === 'roof-framing' && m.role === 'blocking' && m.material === 'steel',
      ),
    ).toBe(true)
    expect(gable.warnings.some((w) => w.includes('high-wind uplift'))).toBe(false)
    // INTL flat roof: no connectors, no ties, no statement (nothing claims a path).
    const intlFlat = computeLevel(upliftScene('flat'), upliftConfig('INTL'))
    expect(
      intlFlat.members.some(
        (m) => m.system === 'roof-framing' && m.role === 'blocking' && m.material === 'steel',
      ),
    ).toBe(false)
    expect(intlFlat.warnings.some((w) => w.includes('high-wind uplift'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// B10 jurisdiction sweep — every selectable code answers the uplift question.
// The uplift set is DERIVED from the profiles' own data (B9's rule: no
// hardcoded state lists in the predicate) — the final pin is a sanity
// enumeration of what the data derives to today.
// ---------------------------------------------------------------------------

describe('jurisdiction sweep — the uplift path answered in every state', () => {
  test('≥130 mph hurricaneTies profiles book the hardware; everyone else books ZERO; no throws', () => {
    const upliftStates: string[] = []
    const cmuHighWindStates: string[] = []
    for (const { code } of jurisdictionOptions()) {
      const profile = profileFor(code)
      const expected = profile.hurricaneTies && profile.ultimateWindMph >= 130
      const result = computeLevel(upliftScene(), upliftConfig(code))
      const connectors = result.members.filter((m) => m.role === 'uplift-connector')
      const straps = result.members.filter((m) => m.role === 'uplift-strap')
      const fdn = result.members.filter((m) => m.role === 'foundation-strap')
      if (expected && profile.exteriorWallDefault === 'cmu') {
        // FL: exterior walls default to CMU — no framed studs to tie, and
        // masonry anchorage is the grouted-cell/dowel story (B18b), not
        // WFCM strapping. Zero framed hardware is the honest answer.
        cmuHighWindStates.push(code)
        expect([...connectors, ...straps, ...fdn], code).toEqual([])
        continue
      }
      if (expected) {
        upliftStates.push(code)
        expect(connectors.length, code).toBeGreaterThan(20)
        expect(straps.length, code).toBe(4)
        expect(fdn.length, code).toBeGreaterThan(0)
      } else {
        expect([...connectors, ...straps, ...fdn], code).toEqual([])
        expect(
          result.warnings.some((w) => w.includes('high-wind uplift')),
          code,
        ).toBe(false)
      }
    }
    // Sanity enumeration of what the data derives to TODAY (the predicate
    // above stays data-driven; this pin just catches silent data drift).
    // Atlantic Canada joined 2026-08 (docs/plans/CANADA-EXPECTED-DIFF.md):
    // NL 140 / NS 130 / PE 130 mph with hurricaneTies — ≥130 books the
    // full wall path, same rule that serves HI/LA.
    expect(upliftStates.sort()).toEqual(['CA-NL', 'CA-NS', 'CA-PE', 'HI', 'LA'])
    expect(cmuHighWindStates).toEqual(['FL'])
  })

  test('FL framed-override walls DO get the hardware (the CMU zero is construction, not jurisdiction)', () => {
    // Same scene, walls forced to framed construction via wallOverrides —
    // FL's 140 mph + hurricaneTies profile books the full set.
    const config = upliftConfig('FL', {
      wallOverrides: { w_s: 'framed', w_e: 'framed', w_n: 'framed', w_w: 'framed' },
    })
    const result = computeLevel(upliftScene(), config)
    expect(result.members.filter((m) => m.role === 'uplift-connector').length).toBeGreaterThan(20)
    expect(result.members.filter((m) => m.role === 'uplift-strap')).toHaveLength(4)
    expect(result.members.filter((m) => m.role === 'foundation-strap').length).toBeGreaterThan(0)
  })
})
