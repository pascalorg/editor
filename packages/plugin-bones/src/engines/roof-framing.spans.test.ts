/**
 * Roof span discipline gates (LOD-400 audit B2) — the shipped-but-dead
 * framing-tables.json is WIRED now: R802.4.1 rafter spans (horizontal
 * projection, snow-banded) and R802.5.1(2) ceiling-joist spans.
 *
 * The audit repro: a 10×12 m gable @40°/2x6/24" framed 40 × 8.09 m (26.5 ft)
 * one-piece rafters with zero flags, and the takeoff booked '20 ft stock
 * (field splice)' — a field-spliced common rafter is not a structural
 * member. Contract: over-span flags fire on every shape; the GABLE gets the
 * real fix (purlin row + 2x4 struts ≤4 ft o.c. to the ceiling joists);
 * compact roofs stay byte-equal.
 */
import { describe, expect, test } from 'bun:test'
import {
  CEILING_JOIST_SPANS,
  DEFAULT_SPEC,
  RAFTER_SPANS_SNOW20,
  RAFTER_SPANS_SNOW50,
  type FramingSpec,
  tableSpanFor,
} from '../core/spec'
import type { Member } from '../core/types'
import { feet, inches } from '../core/units'
import { frameRoofs, type RoofSegmentSlice } from './roof-framing'
import { computeTakeoff } from './takeoff'

function seg(overrides: Partial<RoofSegmentSlice> = {}): RoofSegmentSlice {
  return {
    id: 'roofseg_span',
    roofType: 'gable',
    position: [0, 2.5, 0],
    yaw: 0,
    width: 8,
    depth: 6,
    pitch: (40 * Math.PI) / 180,
    overhang: 0.3,
    wallHeight: 0.5,
    ...overrides,
  }
}

const byRole = (members: Member[], role: string): Member[] => members.filter((m) => m.role === role)
const flagged = (members: Member[]): Member[] => members.filter((m) => m.flag)
/** The engine with the tables EMPTIED = the span checks disabled (pre-B2 path). */
const noTables: FramingSpec = { ...DEFAULT_SPEC, rafterSpans: {}, ceilingJoistSpans: {} }

// ---------------------------------------------------------------------------
// Table plumb-through (data/framing-tables.json → spec)
// ---------------------------------------------------------------------------

describe('span tables load from data/framing-tables.json', () => {
  test('rafter spans: R802.4.1(1) 20-psf-live values in meters, horizontal projection', () => {
    // 2x6 @ 24" = 11-9 → 11.7 ft; 2x10 @ 16" = 22-3 → 22.2 ft
    expect(tableSpanFor(RAFTER_SPANS_SNOW20, '2x6', inches(24))).toBeCloseTo(feet(11.7), 6)
    expect(tableSpanFor(RAFTER_SPANS_SNOW20, '2x10', inches(16))).toBeCloseTo(feet(22.2), 6)
    // 50-psf band: 2x8 @ 24" = 10-1 → 10.0 ft (R802.4.1(5))
    expect(tableSpanFor(RAFTER_SPANS_SNOW50, '2x8', inches(24))).toBeCloseTo(feet(10.0), 6)
  })

  test('ceiling-joist spans: R802.5.1(2) limited storage', () => {
    // 2x6 @ 16" = 12-10 → 12.8 ft
    expect(tableSpanFor(CEILING_JOIST_SPANS, '2x6', inches(16))).toBeCloseTo(feet(12.8), 6)
    expect(tableSpanFor(CEILING_JOIST_SPANS, '2x4', inches(24))).toBeCloseTo(feet(7.1), 6)
  })

  test('spacing snaps UP to the next tabulated column (conservative), unknown sizes return undefined', () => {
    // 20" o.c. is not a column — reads the 24" span, never the longer 16" one
    expect(tableSpanFor(RAFTER_SPANS_SNOW20, '2x6', inches(20))).toBeCloseTo(feet(11.7), 6)
    // past the last column the last column holds (no longer-span invention)
    expect(tableSpanFor(RAFTER_SPANS_SNOW20, '2x6', inches(32))).toBeCloseTo(feet(11.7), 6)
    // no 2x4 rafter row, no 2x12 ceiling-joist row → no prescriptive check
    expect(tableSpanFor(RAFTER_SPANS_SNOW20, '2x4', inches(24))).toBeUndefined()
    expect(tableSpanFor(CEILING_JOIST_SPANS, '2x12', inches(16))).toBeUndefined()
  })

  test('the default spec carries the low-snow band', () => {
    expect(DEFAULT_SPEC.rafterSpans).toBe(RAFTER_SPANS_SNOW20)
    expect(DEFAULT_SPEC.ceilingJoistSpans).toBe(CEILING_JOIST_SPANS)
  })
})

// ---------------------------------------------------------------------------
// The audit repro: 10×12 m gable @40°/2x6/24" — purlins, struts, cj flags
// ---------------------------------------------------------------------------

describe('audit repro — 10×12 gable @40° gets the real purlin fix', () => {
  const roof = seg({ width: 10, depth: 12 })
  const members = frameRoofs([roof], [], DEFAULT_SPEC)
  const theta = roof.pitch
  const tan = Math.tan(theta)
  const rd = 5.5 * 0.0254
  const t = 1.5 * 0.0254
  const baseY = roof.position[1] + roof.wallHeight

  test('one purlin row per slope, rafter stock, at half the run', () => {
    const purlins = members.filter((m) => m.label?.startsWith('Purlin 2x6'))
    expect(purlins).toHaveLength(2)
    for (const p of purlins) {
      expect(p.size).toBe('2x6')
      expect(Math.abs(p.position[2] as number)).toBeCloseTo(6 / 2, 6)
      expect(p.label).toContain('R802.5.1')
    }
  })

  test('numeric: the purlin top corner MEETS the rafter underside plane (no bury, no float)', () => {
    const purlin = members.find(
      (m) => m.label?.startsWith('Purlin 2x6') && (m.position[2] as number) > 0,
    ) as Member
    // rafter underside at the purlin line (plumb): centerline slope line
    // through the ridge face minus rd/(2cosθ) vertical
    const ridgeT = 1.5 * 0.0254 // 2x8 ridge thickness
    const ridgeFaceZ = ridgeT / 2
    const ridgeY = baseY + 6 * tan
    const ridgeFaceY = ridgeY - ridgeFaceZ * tan
    const underside = ridgeFaceY - (3 - ridgeFaceZ) * tan - rd / (2 * Math.cos(theta))
    const top = (purlin.position[1] as number) + rd / 2
    // plumb purlin: the DOWNHILL top corner (z + t/2) touches the plane
    expect(top + (t / 2) * tan).toBeCloseTo(underside, 9)
  })

  test('S1: every strut is 2x4, lands ON a ceiling joist, foot at the joist top face', () => {
    const struts = byRole(members, 'post')
    expect(struts.length).toBeGreaterThanOrEqual(14) // ≥7 per side @ ≤4ft over ~9.9m
    const cjXs = byRole(members, 'ceiling-joist').map((cj) => cj.position[0] as number)
    const cjTop = baseY + rd // 2x6 joists: top face at eave + depth
    for (const s of struts) {
      expect(s.size).toBe('2x4')
      expect(Math.abs(s.position[2] as number)).toBeCloseTo(3, 6)
      // foot exactly on the joist top face
      expect((s.position[1] as number) - s.length / 2).toBeCloseTo(cjTop, 9)
      // snapped onto a real joist line (no floating struts)
      expect(cjXs.some((x) => Math.abs(x - (s.position[0] as number)) < 1e-9)).toBe(true)
      expect(s.label).toContain('R802.5.1')
    }
  })

  test('struts stay within ≤4ft o.c. discipline (snap tolerance = one joist bay)', () => {
    const strutXs = byRole(members, 'post')
      .filter((s) => (s.position[2] as number) > 0)
      .map((s) => s.position[0] as number)
      .sort((a, b) => a - b)
    expect(strutXs.length).toBeGreaterThanOrEqual(7)
    for (let i = 1; i < strutXs.length; i++) {
      expect((strutXs[i] as number) - (strutXs[i - 1] as number)).toBeLessThanOrEqual(
        1.2 + inches(16),
      )
    }
  })

  test('rafters carry the purlin-supported note (splice lands over bearing) and NO flag', () => {
    const commons = byRole(members, 'rafter').filter((r) => !r.label?.includes('Barge'))
    expect(commons.length).toBeGreaterThan(30)
    for (const r of commons) {
      expect(r.flag).toBeUndefined()
      expect(r.label).toContain('purlin-supported @ mid-span (R802.5.1)')
      // 8.0 m slope > 20 ft stock — the splice is called out as purlin-borne
      expect(r.label).toContain('splice over purlin bearing')
    }
  })

  test('the 12 m one-piece ceiling joists flag per R802.5.1', () => {
    const cjs = byRole(members, 'ceiling-joist')
    expect(cjs.length).toBeGreaterThan(0)
    for (const cj of cjs) {
      expect(cj.flag).toContain('Ceiling joist over prescriptive span')
      expect(cj.flag).toContain('R802.5.1')
    }
  })

  test('LOD 200 keeps the schematic path: no purlins, no struts, no flags', () => {
    const generic = frameRoofs([roof], [], { ...DEFAULT_SPEC, detail: '200' })
    expect(generic.some((m) => m.label?.includes('Purlin'))).toBe(false)
    expect(byRole(generic, 'post')).toHaveLength(0)
    expect(flagged(generic)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Span matrix across shapes — flags fire on big, absent on small
// ---------------------------------------------------------------------------

describe('over-span flag matrix', () => {
  test('shed: full-depth projection over the table flags every rafter (no bearing to strut to)', () => {
    const members = frameRoofs([seg({ roofType: 'shed' })], [], DEFAULT_SPEC) // run 6 > 3.57
    const rafters = byRole(members, 'rafter')
    expect(rafters.length).toBeGreaterThan(0)
    for (const r of rafters) {
      expect(r.flag).toContain('Rafter over prescriptive span')
      expect(r.flag).toContain('R802.4.1')
      expect(r.flag).toContain('2x6 @ 24" o.c.')
    }
    expect(members.some((m) => m.label?.includes('Purlin'))).toBe(false)
    // a short shed stays clean
    const small = frameRoofs([seg({ roofType: 'shed', depth: 3 })], [], DEFAULT_SPEC)
    expect(flagged(small)).toHaveLength(0)
  })

  test('hip: commons/kings flag on a big footprint; jacks flag on their OWN bearing run', () => {
    const members = frameRoofs([seg({ roofType: 'hip', width: 14, depth: 12 })], [], DEFAULT_SPEC)
    const commons = byRole(members, 'rafter') // hip commons + kings
    expect(commons.length).toBeGreaterThan(0)
    for (const r of commons) expect(r.flag).toContain('over prescriptive span')
    // long jacks near the commons are the same span class; short corner
    // jacks sit within the table and stay quiet
    const jacks = byRole(members, 'jack-rafter')
    expect(jacks.some((j) => j.flag?.includes('Jack rafter over prescriptive span'))).toBe(true)
    for (const j of jacks.filter((x) => x.length < 2)) expect(j.flag).toBeUndefined()
    // a compact hip (run 1.9, B7 ceiling joists spanning 3.8 ≤ 3.90) stays
    // clean — the DEFAULT 8×6 hip now honestly flags its 6 m one-piece
    // ceiling joists per R802.5.1 (they exist since B7)
    expect(flagged(frameRoofs([seg({ roofType: 'hip', depth: 3.8 })], [], DEFAULT_SPEC))).toHaveLength(0)
    const cjs = byRole(frameRoofs([seg({ roofType: 'hip' })], [], DEFAULT_SPEC), 'ceiling-joist')
    expect(cjs.length).toBeGreaterThan(0)
    for (const cj of cjs) expect(cj.flag).toContain('Ceiling joist over prescriptive span')
  })

  test('flat: the 10.5 m dead-level joist flags (audit class: 10.7 m flat-roof joist)', () => {
    const members = frameRoofs([seg({ roofType: 'flat', width: 12, depth: 10 })], [], DEFAULT_SPEC)
    const joists = byRole(members, 'rafter')
    expect(joists.length).toBeGreaterThan(0)
    for (const j of joists) expect(j.flag).toContain('Flat roof joist over prescriptive span')
    // rims are edge banding, not spanning members
    for (const rim of byRole(members, 'rim-joist')) expect(rim.flag).toBeUndefined()
  })

  test('gambrel: per-plane projections check against the table; big depth flags both planes', () => {
    // depth 20 → lowerRun = upperRun = 5 m > 3.57 m
    const members = frameRoofs([seg({ roofType: 'gambrel', depth: 20 })], [], DEFAULT_SPEC)
    const lowers = members.filter((m) => m.label?.includes('gambrel lower'))
    const uppers = members.filter((m) => m.label?.includes('gambrel upper'))
    expect(lowers.length).toBeGreaterThan(0)
    expect(uppers.length).toBeGreaterThan(0)
    for (const r of [...lowers, ...uppers]) expect(r.flag).toContain('over prescriptive span')
  })

  test('mansard skirt: a deep steep skirt flags its rafters', () => {
    // 20×20 → inset = 20·0.15 = 3.0 m run at 40° — under 3.57 stays clean;
    // widen the ratio via a bigger footprint: 26×26 → inset 3.9 > 3.57
    const members = frameRoofs(
      [seg({ roofType: 'mansard', width: 26, depth: 26 })],
      [],
      DEFAULT_SPEC,
    )
    const skirt = members.filter((m) => m.label?.includes('Mansard skirt'))
    expect(skirt.length).toBeGreaterThan(0)
    for (const r of skirt) expect(r.flag).toContain('over prescriptive span')
  })

  test('snow band moves the verdict: a 7 m-deep gable is legal at 20 psf, purlin-fixed at 50 psf', () => {
    const roof = seg({ depth: 7 }) // run 3.5
    const low = frameRoofs([roof], [], DEFAULT_SPEC) // 2x6 @ 24" allows 3.57
    expect(low.some((m) => m.label?.includes('Purlin 2x6'))).toBe(false)
    expect(byRole(low, 'rafter').every((r) => !r.flag)).toBe(true)
    // the 50-psf band: 2x8 stock (jurisdiction bump) allows only 3.05
    const heavy: FramingSpec = {
      ...DEFAULT_SPEC,
      rafterSize: '2x8',
      rafterSpans: RAFTER_SPANS_SNOW50,
    }
    const snowed = frameRoofs([roof], [], heavy)
    expect(snowed.some((m) => m.label?.startsWith('Purlin 2x8'))).toBe(true)
    expect(byRole(snowed, 'post').length).toBeGreaterThan(0)
  })

  test('one-piece discipline: a table-legal low-pitch monster still flags its field splice', () => {
    // 2x12 @ 24" allows 21.0 ft = 6.4 m; run 6.2 m at 10° → slope ≈ 6.6 m
    // = 21.7 ft > 20 ft stock — legal span, unbuyable stick.
    const spec: FramingSpec = { ...DEFAULT_SPEC, rafterSize: '2x12' }
    const members = frameRoofs([seg({ depth: 12.4, pitch: (10 * Math.PI) / 180 })], [], spec)
    const commons = byRole(members, 'rafter').filter((r) => !r.label?.includes('Barge'))
    expect(commons.length).toBeGreaterThan(0)
    for (const r of commons) {
      expect(r.flag).toContain('exceeds 20 ft one-piece stock')
      expect(r.flag).toContain('R802.4.1')
    }
  })
})

// ---------------------------------------------------------------------------
// Byte-equality: compact roofs are untouched by the wired tables
// ---------------------------------------------------------------------------

describe('compact roofs stay byte-equal (blast radius gate)', () => {
  const compactCases: [string, Partial<RoofSegmentSlice>][] = [
    // depths chosen so BOTH rafter projection AND ceiling-joist length fit
    // (the hip family carries R802.4.2 ceiling joists since B7 — their
    // short-span joists must fit the R802.5.1(2) table to stay flag-free)
    ['gable', { width: 8, depth: 3.8 }],
    ['shed', { roofType: 'shed', depth: 3 }],
    ['hip', { roofType: 'hip', depth: 3.8 }], // run 1.9 ≤ 3.57, cj 3.8 ≤ 3.90
    ['flat', { roofType: 'flat', width: 4, depth: 3 }],
    ['gambrel', { roofType: 'gambrel', width: 8, depth: 3.8 }],
    ['mansard', { roofType: 'mansard', depth: 3.8 }],
    ['dutch', { roofType: 'dutch', depth: 3.8 }],
  ]

  for (const [name, over] of compactCases) {
    test(`${name}: tables-on output identical to tables-off; zero flags, zero SPAN-FIX purlins/struts`, () => {
      const on = frameRoofs([seg(over)], [], DEFAULT_SPEC)
      const off = frameRoofs([seg(over)], [], noTables)
      expect(on).toEqual(off)
      // INTENDED CHANGE (NIGHT-10, B8a extension): the mansard CROWN ridge
      // carries the R802.4.3 sub-3:12 flag — SHAPE honesty (the crown pitch
      // computes ~8.8° from the host ratios at any footprint), table-
      // independent (`on == off` above proves it). This gate polices SPAN
      // flags — the ridge-beam statement is carved out like the gambrel
      // struts below, and pinned non-vacuous for the mansard.
      const spanFlagged = flagged(on).filter((m) => !m.flag?.includes('R802.4.3'))
      expect(spanFlagged).toHaveLength(0)
      if (name === 'mansard') {
        const crownRidge = on.filter((m) => m.role === 'ridge')
        expect(crownRidge).toHaveLength(1)
        expect(crownRidge[0]?.flag).toContain('ridge beam required, R802.4.3')
      } else {
        expect(flagged(on)).toHaveLength(0)
      }
      expect(on.some((m) => m.label?.includes('Purlin ') && m.label?.includes('mid-span'))).toBe(
        false,
      )
      // B8d: the gambrel's break struts are SHAPE geometry (the break purlin
      // carries every rafter joint, R802.5.1 — table-independent, present on
      // compact roofs too, and `on == off` above proves the independence).
      // The SPAN-FIX machinery stays absent everywhere: posts on any other
      // shape would be the mid-span purlin fix firing on a compact roof.
      const posts = byRole(on, 'post')
      if (name === 'gambrel') {
        expect(posts.length).toBeGreaterThan(0)
        for (const p of posts) expect(p.label).toContain('bears on ceiling joists')
      } else {
        expect(posts).toHaveLength(0)
      }
    })
  }

  test('the 400 detail pass is equally untouched on a compact gable', () => {
    const spec400: FramingSpec = { ...DEFAULT_SPEC, detail: '400' }
    const on = frameRoofs([seg({ depth: 3.8 })], [], spec400)
    const off = frameRoofs([seg({ depth: 3.8 })], [], { ...noTables, detail: '400' })
    expect(on).toEqual(off)
    expect(flagged(on)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Takeoff: flags aggregate; field-splice sticks never book silently
// ---------------------------------------------------------------------------

describe('takeoff — span flags surface, splices are never silent', () => {
  test('the repro gable books purlins + struts and aggregates the ceiling-joist flag', () => {
    const members = frameRoofs([seg({ width: 10, depth: 12 })], [], DEFAULT_SPEC)
    const rows = computeTakeoff(members, [])
    // struts book as roof 2x4 lumber
    expect(rows.some((r) => r.section === 'Roof' && r.item === '2x4')).toBe(true)
    // the ceiling-joist flag aggregates: one row, quantity = flagged joists
    const cjCount = byRole(members, 'ceiling-joist').length
    const flagRow = rows.find(
      (r) => r.section === 'Flags' && r.detail.includes('Ceiling joist over prescriptive span'),
    )
    expect(flagRow?.quantity).toBe(cjCount)
    // the spliced 2x6 rafters still book nominally (members are truth)…
    expect(
      rows.some(
        (r) => r.section === 'Roof' && r.item === '2x6' && r.detail.includes('field splice'),
      ),
    ).toBe(true)
  })

  test('property: no roof member beyond 20 ft stock books without a flag or purlin bearing', () => {
    // 400 = the shipped default detail; splice-bearing NOTES are fabrication
    // data (the rafterCutData convention), flags fire from 300 up.
    const spec400: FramingSpec = { ...DEFAULT_SPEC, detail: '400' }
    const scenes: Member[][] = [
      frameRoofs([seg({ width: 10, depth: 12 })], [], spec400),
      frameRoofs([seg({ roofType: 'shed', depth: 8 })], [], spec400),
      frameRoofs([seg({ roofType: 'flat', width: 12, depth: 14 })], [], spec400),
      frameRoofs([seg({ roofType: 'hip', width: 16, depth: 14 })], [], spec400),
    ]
    for (const members of scenes) {
      for (const m of members) {
        if (m.length <= feet(20) + 1e-9) continue
        // Stock-buy universe = SIZE-bearing sticks: sheet goods (the B6
        // deck panels, size-less) lap at panel joints — they book by the
        // sqft row, never as '20 ft stock (field splice)'.
        if (!m.size) continue
        // Spanning members FLAG; continuously-supported members (ridge
        // boards, rims, barges, purlins, fascia) name their splice bearing.
        const covered =
          m.flag !== undefined ||
          m.label?.includes('splice over purlin bearing') === true ||
          m.label?.includes('— spliced over') === true
        expect({ role: m.role, label: m.label, covered }).toEqual({
          role: m.role,
          label: m.label,
          covered: true,
        })
      }
    }
  })

  test('over-span shed rafters put their flag beside the field-splice booking', () => {
    const members = frameRoofs([seg({ roofType: 'shed', depth: 8 })], [], DEFAULT_SPEC)
    const rows = computeTakeoff(members, [])
    expect(
      rows.some(
        (r) => r.section === 'Roof' && r.item === '2x6' && r.detail.includes('field splice'),
      ),
    ).toBe(true)
    const flagRow = rows.find(
      (r) => r.section === 'Flags' && r.detail.includes('Rafter over prescriptive span'),
    )
    expect(flagRow).toBeDefined()
    expect(flagRow?.quantity).toBe(byRole(members, 'rafter').length)
  })
})
