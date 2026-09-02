import { describe, expect, test } from 'bun:test'
import { DEFAULT_SPEC, type FramingSpec } from '../core/spec'
import type { Member, WallSlice } from '../core/types'
import { inches } from '../core/units'
import { baselineConfig, baselineScene } from '../framing/baseline-scene'
import { computeLevel } from '../framing/compute'
import { buildPlanSet } from '../plans/plan-set'
import { computeTakeoff, screwsPerSheet } from './takeoff'
import {
  DEFAULT_STRUCTURAL_MILS,
  LGS,
  machineFor,
  parseDesignator,
} from './lgs-profiles'
import {
  conservativeWallMils,
  factoryPunchouts,
  LGS_CONSERVATIVE_BASIS,
  LGS_JACKS_PER_SIDE,
  LGS_STRAP_THICKNESS,
  LGS_STRAP_WIDTH,
  LGS_STUD_THICKNESS,
  LGS_TRACK_FLANGE,
  lgsFrameWalls,
  lgsWallProfiles,
} from './lgs-wall-framing'
import { studPositions } from './wall-framing'

/**
 * LGS Phase 1 gates (docs/plans/LGS-PLAN.md): the R603 steel wall engine.
 * Gate classes: end-to-end steel scenes (member census, track-mil rule,
 * straps by height, opening structure) · LABEL TRUTH (every designator
 * exists in the catalog — none invented) · SELECTION HONESTY (conservative
 * unverified-cell basis stated + warned; R603.1.1 applicability loud) ·
 * TAKEOFF (screw schedule, no invented weights, 8d basis split) · LOD-200
 * no-code-claims · construction-resolution precedence.
 * The E5 master-baseline pin (compute.devices.test.ts) + the F1 describe
 * (lgs-profiles.test.ts) hold the no-lgs byte-parity story; the SAT story
 * lives in interpenetration.test.ts's LGS scenarios.
 */

const spec400: FramingSpec = { ...DEFAULT_SPEC, detail: '400' }

function wall(overrides: Partial<WallSlice> = {}): WallSlice {
  const start = overrides.start ?? [0, 0]
  const end = overrides.end ?? [6, 0]
  const dx = (end[0] ?? 0) - (start[0] ?? 0)
  const dz = (end[1] ?? 0) - (start[1] ?? 0)
  const length = Math.hypot(dx, dz)
  return {
    id: 'w_lgs',
    start,
    end,
    dir: [dx / length, dz / length],
    length,
    height: 2.44,
    thickness: 0.114,
    exterior: false,
    curved: false,
    openings: [],
    ...overrides,
  }
}

const steelOf = (members: Member[], id?: string) =>
  members.filter(
    (m) => m.profile !== undefined && (id === undefined || m.sourceId === id),
  )

describe('LGS member census — one wall, no openings', () => {
  const w = wall()
  const { members, warnings } = lgsFrameWalls([w], spec400)

  test('tracks: exactly one bottom + one top, T125 profile, full run', () => {
    const bottom = members.filter((m) => m.role === 'bottom-plate')
    const top = members.filter((m) => m.role === 'top-plate')
    expect(bottom.length).toBe(1)
    expect(top.length).toBe(1)
    expect(members.filter((m) => m.role === 'cap-plate').length).toBe(0) // no double plate in steel
    expect(bottom[0]?.profile).toBe('350T125-68')
    expect(bottom[0]?.dims[0]).toBeCloseTo(6, 6)
    expect(bottom[0]?.dims[1]).toBeCloseTo(LGS_TRACK_FLANGE, 6)
    // bottom track sits ON the floor, top track UNDER the ceiling
    expect(bottom[0]?.position[1]).toBeCloseTo(LGS_TRACK_FLANGE / 2, 6)
    expect(top[0]?.position[1]).toBeCloseTo(2.44 - LGS_TRACK_FLANGE / 2, 6)
  })

  test('studs: o.c. rhythm count, C-stud envelope (flange × web), seated inside the tracks', () => {
    const studs = members.filter((m) => m.role === 'stud')
    expect(studs.length).toBe(studPositions(6, spec400.studSpacing, LGS_STUD_THICKNESS / 2).length)
    for (const s of studs) {
      expect(s.profile).toBe('350S162-68')
      expect(s.material).toBe('steel')
      expect(s.dims[0]).toBeCloseTo(LGS_STUD_THICKNESS, 6) // 1-5/8" flange
      expect(s.dims[2]).toBeCloseTo(0.0889, 3) // 3.5" web — 2x4 depth-matched
      // stud spans track web to track web (nests inside the flanges)
      const trackWeb = (LGS.genericFamilies['350T125-68']?.designThicknessMm ?? 1.7) / 1000
      expect(s.position[1] - s.dims[1] / 2).toBeCloseTo(trackWeb, 6)
      expect(s.position[1] + s.dims[1] / 2).toBeCloseTo(2.44 - trackWeb, 6)
    }
  })

  test('TRACK-MIL-MATCHES-STUD rule (R603.3.2 verbatim): every track ≥ its wall studs', () => {
    const studMils = parseDesignator('350S162-68')?.mils ?? 0
    for (const m of members) {
      if (m.role !== 'bottom-plate' && m.role !== 'top-plate' && m.role !== 'sill') continue
      const mils = parseDesignator(m.profile ?? '')?.mils ?? 0
      expect(mils).toBeGreaterThanOrEqual(studMils)
      expect(m.label).toContain('track thickness matches studs (R603.3.2)')
    }
  })

  test('conservative basis is STATED on EVERY conservatively-picked member + warned once (round-1 F1)', () => {
    // The 68-mil pick is the unverified-cell conservative choice for the
    // WHOLE wall family — kings, jacks, cripples, headers, tracks and
    // corner backing included, not just the o.c. studs (round-1 skeptic:
    // 31/65 members carried no basis, and basisSuffix was computed but
    // never wired). Backing (150U050-54 bridging) states its OWN basis —
    // it is the catalog's only variant, not a stud-table pick.
    for (const m of steelOf(members)) {
      if (m.role === 'backing') {
        expect(m.label).toContain('only catalog variant')
        expect(m.label).not.toContain(LGS_CONSERVATIVE_BASIS)
        continue
      }
      expect(m.label).toContain(LGS_CONSERVATIVE_BASIS)
    }
    // …and the tracks keep the verbatim-verified thickness-matches cite
    // ALONGSIDE the caveat (never instead of it)
    const track = members.find((m) => m.role === 'bottom-plate')
    expect(track?.label).toContain('track thickness matches studs (R603.3.2)')
    expect(track?.label).toContain(LGS_CONSERVATIVE_BASIS)
    expect(warnings.some((w) => w.includes('R603.3.2 table cells not encoded'))).toBe(true)
    expect(warnings.some((w) => w.includes('R603.9'))).toBe(true)
  })

  test('F1 breadth on an opening wall: kings/jacks/cripples/header/sill/tracks all carry the basis', () => {
    const opened = wall({
      id: 'w_f1',
      end: [8, 0],
      openings: [
        { id: 'd', kind: 'door', u: 2, width: 0.9, height: 2.1, sillHeight: 0, roughWidth: 0.9381, roughHeight: 2.1381 },
        { id: 'w', kind: 'window', u: 6, width: 1.2, height: 1.2, sillHeight: 0.9, roughWidth: 1.2381, roughHeight: 1.2381 },
      ],
    })
    const r = lgsFrameWalls([wall({ id: 'w_thru', start: [8, 0], end: [8, 4] }), opened], spec400)
    for (const role of ['king-stud', 'trimmer', 'cripple', 'header', 'sill', 'top-plate'] as const) {
      const of = r.members.filter((m) => m.role === role && m.sourceId === 'w_f1')
      expect(of.length).toBeGreaterThan(0)
      for (const m of of) expect(m.label).toContain(LGS_CONSERVATIVE_BASIS)
    }
    // corner-backing extra stud carries it too
    const backing = r.members.filter(
      (m) => m.role === 'stud' && (m.label ?? '').includes('California corner backing'),
    )
    expect(backing.length).toBeGreaterThan(0)
    for (const m of backing) expect(m.label).toContain(LGS_CONSERVATIVE_BASIS)
  })

  test('grade rule rides the labels: 68 mil → Gr 50 (33/43 would be Gr 33)', () => {
    for (const m of steelOf(members)) {
      if (m.profile?.endsWith('-68')) expect(m.label).toContain('(Gr 50)')
      if (m.profile?.endsWith('-33') || m.profile?.endsWith('-43')) {
        expect(m.label).toContain('(Gr 33)')
      }
    }
  })

  test('punchout METADATA at 400: S240 A5.9 arithmetic, no geometry holes', () => {
    const studs = members.filter((m) => m.role === 'stud')
    const s = studs[0]
    expect(s?.punchouts).toBeDefined()
    const p = s?.punchouts
    if (!p) throw new Error('missing punchouts')
    expect(p.pattern).toBe('s240-factory-punchout')
    expect(p.spacingIn).toBe(24)
    expect(p.endDistanceIn).toBe(12)
    expect(p.lengthIn).toBe(4.5)
    // width ≤ min(depth/2, 2.5"): 3.5" web → 1.75"
    expect(p.widthIn).toBeCloseTo(1.75, 6)
    // count = floor((L − 2·12") / 24") + 1 on the actual cut length
    const Lin = (s?.length ?? 0) / 0.0254
    expect(p.count).toBe(Math.floor((Lin - 24) / 24) + 1)
    // dims stay a solid box — metadata only in Phase 1
    expect(s?.dims.length).toBe(3)
  })

  test('factoryPunchouts: members too short for the end distance carry none', () => {
    expect(factoryPunchouts(0.5, 3.5)).toBeUndefined() // 19.7" < 2×12"
    expect(factoryPunchouts(0.7, 3.5)?.count).toBe(1) // 27.6" − 24" → one centered
  })
})

describe('LGS strap bracing by wall height (R603.3.3)', () => {
  const strapRows = (h: number) => {
    const { members } = lgsFrameWalls([wall({ height: h })], spec400)
    return members.filter((m) => m.role === 'strap-bracing')
  }

  test('≤ 8 ft wall: ONE row per face at mid-height', () => {
    const straps = strapRows(2.4) // 7.87 ft
    expect(straps.length).toBe(2) // both faces
    for (const s of straps) {
      expect(s.position[1]).toBeCloseTo(1.2, 6)
      expect(s.dims[1]).toBeCloseTo(LGS_STRAP_WIDTH, 6)
      expect(s.dims[2]).toBeCloseTo(LGS_STRAP_THICKNESS, 6)
      expect(s.dims[2]).toBeLessThan(0.002) // under the SAT skin — surface steel
      expect(s.label).toContain('R603.3.3')
      expect(s.label).toContain('mid-height')
      expect(s.profile).toBeUndefined() // flat strap, not a catalog C/T profile
    }
  })

  test('9/10 ft wall: rows at the THIRD POINTS, both faces', () => {
    const h = 2.9 // 9.5 ft
    const straps = strapRows(h)
    expect(straps.length).toBe(4) // 2 rows × 2 faces
    const ys = [...new Set(straps.map((s) => s.position[1].toFixed(4)))].sort()
    expect(ys).toEqual([(h / 3).toFixed(4), ((2 * h) / 3).toFixed(4)])
    expect(straps[0]?.label).toContain('third points')
  })

  test('past the 10 ft R603.1.1 limit: NO straps, loud warning + flag instead', () => {
    const tall = wall({ height: 3.2 }) // 10.5 ft
    const { members, warnings } = lgsFrameWalls([tall], spec400)
    expect(members.filter((m) => m.role === 'strap-bracing').length).toBe(0)
    expect(warnings.some((w) => w.includes('exceeds the R603.1.1 10 ft limit'))).toBe(true)
    // every member of the wall carries the engineered flag
    for (const m of steelOf(members)) {
      expect(m.flag).toContain('outside R603.1.1: stud length > 10 ft — engineered design required')
    }
  })
})

describe('R603.3.3 strap drops are NEVER silent (round-3 F1 — the S13 doctrine)', () => {
  const cmuStem = (id: string, u: number, t: number): WallSlice =>
    wall({ id, start: [u, 0], end: [u, 2.5], thickness: t })

  test('exhibit (a): remnants under 6" on BOTH sides of a mid-run stem — zero straps + the omitted warning', () => {
    // 0.5 m steel stub, 0.2 m CMU stem at mid-run: both remnants 0.15 m
    // < 6" → every span drops. The pure-steel twin frames straps; the
    // CMU-adjacent scene must never lose them WORDLESSLY (the advisory
    // channel rides strap members — none exist here).
    const stub = wall({ id: 'w_f1a', start: [0, 0], end: [0.5, 0], thickness: 0.114 })
    const twin = lgsFrameWalls([stub], spec400)
    expect(twin.members.filter((m) => m.role === 'strap-bracing').length).toBe(2)
    const r = lgsFrameWalls([stub], spec400, undefined, {
      cmuNeighbors: [cmuStem('w_f1a_stem', 0.25, 0.2)],
    })
    expect(r.members.filter((m) => m.role === 'strap-bracing').length).toBe(0)
    expect(
      r.warnings.some(
        (w) =>
          w.includes('Wall w_f1a') &&
          w.includes('R603.3.3 strap bracing omitted') &&
          w.includes('run(s) shorter than 6 in after CMU trims'),
      ),
    ).toBe(true)
    // …and the twin carries NO such warning (byte-parity: no cmuNeighbors,
    // no new warnings — the level-warning delta is the trace)
    expect(twin.warnings.some((w) => w.includes('strap bracing'))).toBe(false)
  })

  test('exhibit (b): stems at 1.4/1.7 on a 3 m wall — the 0.15 m middle remnant drops WITH its warning', () => {
    const w3 = wall({ id: 'w_f1b', start: [0, 0], end: [3, 0], thickness: 0.114 })
    const r = lgsFrameWalls([w3], spec400, undefined, {
      cmuNeighbors: [cmuStem('w_f1b_s1', 1.4, 0.15), cmuStem('w_f1b_s2', 1.7, 0.15)],
    })
    // outer spans survive (straps + junction advisories ride them)
    const straps = r.members.filter((m) => m.role === 'strap-bracing')
    expect(straps.length).toBeGreaterThan(0)
    for (const st of straps) expect(st.advisory).toContain('run trimmed clear of a CMU junction')
    // the dropped middle span [1.475, 1.625] states its extent, on the
    // LEVEL channel (P4 prints warnings on paper)
    const warning = r.warnings.find((w) => w.includes('strap bracing interrupted at CMU junction'))
    expect(warning).toBeDefined()
    expect(warning).toContain('Wall w_f1b')
    expect(warning).toContain('0.15 m unbraced band at 1.47–1.63 m')
    expect(warning).toContain('verify bracing at the junction')
  })

  test('no drop → no warning: a clean mid-run split stays warning-free (round-3 interaction pin)', () => {
    const w6 = wall({ id: 'w_f1c', start: [0, 0], end: [6, 0], thickness: 0.114 })
    const r = lgsFrameWalls([w6], spec400, undefined, {
      cmuNeighbors: [cmuStem('w_f1c_stem', 3, 0.15)],
    })
    // the split survives on both sides — the advisory is the trace, the
    // warning channel stays quiet
    expect(r.members.filter((m) => m.role === 'strap-bracing').length).toBe(4)
    expect(r.warnings.some((w) => w.includes('strap bracing'))).toBe(false)
  })
})

describe('LGS opening structure (R603.6 / R603.7 / R603.8)', () => {
  const withOpenings = wall({
    id: 'w_open',
    end: [8, 0],
    height: 2.44,
    openings: [
      {
        id: 'd1',
        kind: 'door',
        u: 2,
        width: 0.9,
        height: 2.1,
        sillHeight: 0,
        roughWidth: 0.9381,
        roughHeight: 2.1381,
      },
      {
        id: 'win1',
        kind: 'window',
        u: 6,
        width: 1.2,
        height: 1.2,
        sillHeight: 0.9,
        roughWidth: 1.2381,
        roughHeight: 1.2381,
      },
    ],
  })
  const { members } = lgsFrameWalls([withOpenings], spec400)

  test('each opening: 2 kings + jacks-per-side minimum, structure per R603.7 with the stated count basis', () => {
    const kings = members.filter((m) => m.role === 'king-stud')
    const jacks = members.filter((m) => m.role === 'trimmer')
    expect(kings.length).toBe(4) // 2 per opening
    expect(jacks.length).toBe(2 * 2 * LGS_JACKS_PER_SIDE)
    for (const m of [...kings, ...jacks]) {
      expect(m.label).toContain('R603.7')
      expect(m.label).toContain('not verified — minimum shown')
    }
  })

  test('headers: 2-C box assembly, R603.6 STRUCTURE with the unverified-capacity flag', () => {
    const headers = members.filter((m) => m.role === 'header')
    expect(headers.length).toBe(2)
    for (const h of headers) {
      expect(h.label).toContain('2×')
      expect(h.label).toContain('box (R603.6)')
      expect(h.flag).toContain('header span capacity not verified against Table R603.6')
      // envelope: two flange widths across, never wider than the cavity
      expect(h.dims[2]).toBeLessThanOrEqual(2 * LGS_STUD_THICKNESS + 1e-9)
      expect(h.profile).toBe('350S162-68')
    }
  })

  test('window sill is a TRACK section (R603.8), cripples continue the rhythm', () => {
    const sills = members.filter((m) => m.role === 'sill')
    expect(sills.length).toBe(1)
    expect(sills[0]?.profile).toBe('350T125-68')
    expect(sills[0]?.label).toContain('Sill track')
    expect(sills[0]?.label).toContain('R603.8')
    // window at sillHeight 0.9 → cripples below the sill exist
    const win = sills[0]
    if (!win) throw new Error('missing sill')
    const below = members.filter(
      (m) => m.role === 'cripple' && m.position[1] < win.position[1],
    )
    expect(below.length).toBeGreaterThanOrEqual(2)
    // cripples above both headers too
    const above = members.filter((m) => m.role === 'cripple' && m.position[1] > 2.2)
    expect(above.length).toBeGreaterThan(0)
  })
})

describe('LABEL TRUTH — every designator exists in the catalog, none invented', () => {
  const scenes: [string, FramingSpec][] = [
    ['default 400', spec400],
    ['24" spacing', { ...spec400, studSpacing: inches(24) }],
    ['LOD 200', { ...DEFAULT_SPEC, detail: '200' }],
    ['machine TF550H', { ...spec400, lgsMachine: 'framecad/tf550h' }],
    ['machine F325iT (cannot roll 68)', { ...spec400, lgsMachine: 'framecad/f325it' }],
    ['unknown machine', { ...spec400, lgsMachine: 'acme/rocket' }],
    // vendor-designator path (Howick's own geometry, LOD 200 — the 33/43
    // mil vendor row only reaches minMils at the generic floor)
    ['machine FRAMA 3200 @ 200', { ...DEFAULT_SPEC, detail: '200', lgsMachine: 'howick/frama3200' } as FramingSpec],
  ]
  const walls = [
    wall({ id: 'a', thickness: 0.15, exterior: true }),
    wall({ id: 'b', start: [0, 0], end: [0, 5], thickness: 0.114 }),
  ]

  for (const [name, spec] of scenes) {
    test(`${name}: every steel member's designator is a catalog row (generic or declared vendor profile)`, () => {
      const { members } = lgsFrameWalls(walls, spec)
      expect(steelOf(members).length).toBeGreaterThan(10)
      const vendorDesignators = new Set<string>()
      for (const vendor of Object.values(LGS.vendors)) {
        for (const machine of Object.values(vendor.machines)) {
          for (const rf of machine.rollableFamilies) {
            if (rf.designator) vendorDesignators.add(rf.designator.toUpperCase())
          }
        }
      }
      for (const m of steelOf(members)) {
        const d = (m.profile ?? '').toUpperCase()
        const inCatalog =
          LGS.genericFamilies[d] !== undefined || vendorDesignators.has(d)
        expect(inCatalog).toBe(true)
        // and the label repeats the designator verbatim (profile truth)
        expect(m.label).toContain(m.profile ?? '<none>')
        // EXACT-TOKEN truth (round-1 F4b — the substring check let a
        // fabricated '350S162-68-HD' ride): every designator-shaped token
        // ON the label must be a real catalog/vendor row, suffixes
        // included; and no label carries invented weight figures.
        const tokens = (m.label ?? '').toUpperCase().match(/\b\d{3,4}[STUFL]\d{3}-\d{2,3}(?:-[A-Z0-9]+)*\b/g) ?? []
        // a GENERIC profile must print its own token; vendor designators
        // (HOWICK-89C41…) are not designator-shaped — any generic tokens
        // their labels DO mention still have to be real rows
        if (LGS.genericFamilies[d]) expect(tokens.length).toBeGreaterThan(0)
        for (const tok of tokens) {
          expect(LGS.genericFamilies[tok] !== undefined || vendorDesignators.has(tok)).toBe(true)
        }
        expect(m.label ?? '').not.toMatch(/\d+(\.\d+)?\s*(lb|kg)\b/i)
      }
    })
  }

  test('a verified machine that ROLLS the pick brands the labels; anything it cannot carries the fallback status', () => {
    const rolls = lgsFrameWalls(walls, { ...spec400, lgsMachine: 'framecad/tf550h' })
    const studRoles = new Set(['stud', 'king-stud', 'trimmer', 'cripple', 'header'])
    for (const m of steelOf(rolls.members)) {
      if (studRoles.has(m.role)) {
        // TF550H's published ranges cover the 68-mil S162 studs → branded
        // (the conservative-basis clause still says 'table cell
        // unverified' — that's the SELECTION honesty, not the machine's)
        expect(m.label).toContain('(framecad/tf550h)')
        expect(m.label).not.toContain(LGS.fallbackStatus)
      } else if (m.role === 'bottom-plate' || m.role === 'top-plate' || m.role === 'sill') {
        // …but NOT the T125 track (its 1-1/4" flange sits below the
        // machine's published 34–63 mm flange range) — the resolution
        // falls back to generic dims and SAYS SO. Honest per-row, not
        // per-machine.
        expect(m.label).toContain(LGS.fallbackStatus)
      }
    }
    const cant = lgsFrameWalls(walls, { ...spec400, lgsMachine: 'framecad/f325it' })
    const fallback = LGS.fallbackStatus
    for (const m of steelOf(cant.members)) {
      if (m.role === 'backing') continue
      expect(m.label).toContain(fallback)
    }
    // resolution still lands GENERIC dims — never vendor dims nobody checked
    expect(steelOf(cant.members).some((m) => m.profile === '350S162-68')).toBe(true)
  })
})

describe('SELECTION HONESTY — conservative pick + applicability limits', () => {
  test('conservativeWallMils: the table-domain maximum (68), never the 97-mil floor rows', () => {
    expect(conservativeWallMils('350S162')).toBe(68)
    expect(conservativeWallMils('550S162')).toBe(68)
    expect(conservativeWallMils('350T125')).toBe(68)
    // 800S162 has a 97-mil catalog row — the WALL tables stop at 68
    expect(conservativeWallMils('800S162')).toBe(68)
    // unknown stem falls to the structural floor
    expect(conservativeWallMils('nope')).toBe(DEFAULT_STRUCTURAL_MILS)
  })

  test('lgsWallProfiles: one resolver — stud + track at the same conservative mils; LOD 200 generic', () => {
    const w = wall({ thickness: 0.15 })
    const p400 = lgsWallProfiles(w, spec400)
    expect(p400.minMils).toBe(68)
    expect(p400.basis).toBe(LGS_CONSERVATIVE_BASIS)
    if (!('designator' in p400.stud) || !('designator' in p400.track)) throw new Error('unresolved')
    expect(p400.stud.designator).toBe('550S162-68')
    expect(p400.track.designator).toBe('550T125-68')
    const p200 = lgsWallProfiles(w, { ...DEFAULT_SPEC, detail: '200' })
    expect(p200.minMils).toBe(DEFAULT_STRUCTURAL_MILS)
    expect(p200.basis).toBeNull()
    if (!('designator' in p200.stud)) throw new Error('unresolved')
    expect(p200.stud.designator).toBe('550S162-33')
  })

  test('out-of-applicability inputs warn LOUDLY and flag every member — never silent', () => {
    const w = wall()
    const windy = lgsFrameWalls([w], spec400, undefined, { ultimateWindMph: 150 })
    expect(windy.warnings.some((x) => x.includes('outside IRC R603.1.1'))).toBe(true)
    expect(windy.warnings.some((x) => x.includes('150 mph'))).toBe(true)
    for (const m of steelOf(windy.members)) {
      expect(m.flag).toContain('outside IRC R603.1.1')
      expect(m.flag).toContain('engineered design required')
    }
    const snowy = lgsFrameWalls([w], spec400, undefined, { groundSnowLoadPsf: 80 })
    expect(snowy.warnings.some((x) => x.includes('80 psf > 70'))).toBe(true)
    const tallStack = lgsFrameWalls([w], spec400, undefined, { storeys: 4 })
    expect(tallStack.warnings.some((x) => x.includes('4 stories > 3'))).toBe(true)
    // inside the limits: no applicability warning, no flag
    const fine = lgsFrameWalls([w], spec400, undefined, {
      ultimateWindMph: 115,
      groundSnowLoadPsf: 20,
      storeys: 2,
    })
    expect(fine.warnings.some((x) => x.includes('outside IRC R603.1.1'))).toBe(false)
    for (const m of steelOf(fine.members)) {
      expect(m.flag ?? '').not.toContain('outside IRC R603.1.1')
    }
  })

  test('LOD 200 makes NO code claims: generic 33-mil members, no straps/punchouts/warnings, ZERO cites', () => {
    const opened = wall({
      openings: [
        { id: 'd', kind: 'door', u: 2, width: 0.9, height: 2.1, sillHeight: 0, roughWidth: 0.9381, roughHeight: 2.1381 },
        { id: 'w', kind: 'window', u: 4.5, width: 1.2, height: 1.2, sillHeight: 0.9, roughWidth: 1.2381, roughHeight: 1.2381 },
      ],
    })
    const { members, warnings } = lgsFrameWalls([opened], { ...DEFAULT_SPEC, detail: '200' })
    expect(members.filter((m) => m.role === 'strap-bracing').length).toBe(0)
    expect(members.some((m) => m.role === 'header')).toBe(true)
    for (const m of steelOf(members)) {
      expect(m.profile?.endsWith('-33') || m.profile === '150U050-54').toBe(true)
      expect(m.punchouts).toBeUndefined()
      // NO code cite anywhere at 200 (round-1 F5a: the header label leaked
      // '(R603.6)' while every other cite was codeClaims-gated)
      expect(m.label ?? '').not.toMatch(/R603/)
    }
    expect(warnings.length).toBe(0)
  })

  test('F5b: vendor-profile labels never inherit the generic grade — vendor spec + dims delta stated', () => {
    const { members } = lgsFrameWalls(
      [wall({ thickness: 0.114 })],
      { ...DEFAULT_SPEC, detail: '200', lgsMachine: 'howick/frama3200' } as FramingSpec,
    )
    const studs = members.filter((m) => m.role === 'stud')
    expect(studs.length).toBeGreaterThan(0)
    for (const m of studs) {
      expect(m.profile).toBe('HOWICK-89C41 (FRAMA 3200)')
      // grade is the VENDOR's, never the nearest-generic family's Gr 33
      expect(m.label).toContain('grade per vendor spec')
      expect(m.label).not.toContain('(Gr ')
      // mils stated honestly (the vendor row's rollable set)
      expect(m.label).toContain('33/43 mil')
      // the dims-delta note surfaces verbatim (Howick lip vs AISI)
      expect(m.label).toContain('lip 10mm vs AISI S162 12.7mm')
      // and the envelope IS the vendor geometry (41 mm flange, 89 mm web)
      expect(m.dims[0]).toBeCloseTo(0.041, 3)
      expect(m.dims[2]).toBeCloseTo(0.089, 3)
    }
  })
})

describe('GRADE RULE — full catalog sweep (round-1 F4c)', () => {
  test('every catalog row encodes the VERIFIED grade rule: 33/43 mil → Gr 33, ≥54 mil → Gr 50 (S230 A4.4)', () => {
    // The spot checks let a flipped yieldKsi on 550T125-68 / 350S162-54 /
    // 150U050-54 survive — the sweep pins every row against the rule.
    const rows = Object.entries(LGS.genericFamilies)
    expect(rows.length).toBeGreaterThan(30)
    for (const [designator, fam] of rows) {
      expect(`${designator}: Gr ${fam.yieldKsi}`).toBe(
        `${designator}: Gr ${fam.mils >= 54 ? 50 : 33}`,
      )
    }
  })

  test('every steel member PRINTS the grade its catalog row carries — label == data, whole scene', () => {
    const walls = [
      wall({ id: 'g1', thickness: 0.15, exterior: true, openings: [
        { id: 'd', kind: 'door', u: 2, width: 0.9, height: 2.1, sillHeight: 0, roughWidth: 0.9381, roughHeight: 2.1381 },
      ] }),
      wall({ id: 'g2', start: [0, 0], end: [0, 5], thickness: 0.114 }),
    ]
    const { members } = lgsFrameWalls(walls, spec400)
    let checked = 0
    for (const m of steelOf(members)) {
      const fam = LGS.genericFamilies[(m.profile ?? '').toUpperCase()]
      if (!fam) continue
      const printed = /\(Gr (\d+)\)/.exec(m.label ?? '')
      expect(printed).not.toBeNull()
      expect(printed?.[1]).toBe(String(fam.yieldKsi))
      checked += 1
    }
    expect(checked).toBeGreaterThan(20)
  })
})

describe('END-TO-END: computeLevel with framingSystem lgs (the level default)', () => {
  const lgsConfig = (jurisdiction = 'INTL', extra: Record<string, unknown> = {}) => ({
    ...baselineConfig(jurisdiction),
    framingSystem: 'lgs' as const,
    ...extra,
  })

  test('every framed wall goes steel; areas/layers/fixtures match the lumber level', () => {
    const base = computeLevel(baselineScene(), baselineConfig('INTL'))
    const lgs = computeLevel(baselineScene(), lgsConfig())
    // all five baseline walls frame in steel — no lumber studs remain
    expect(lgs.members.filter((m) => m.material === 'lumber' && m.role === 'stud').length).toBe(0)
    const steelWalls = new Set(steelOf(lgs.members).map((m) => m.sourceId))
    expect(steelWalls.size).toBe(5)
    expect(lgs.areas).toEqual(base.areas)
    expect(JSON.stringify(lgs.fixtures)).toBe(JSON.stringify(base.fixtures))
    const layerRoles = new Set(['drywall', 'sheathing', 'wrb', 'cladding'])
    expect(JSON.stringify(lgs.members.filter((m) => layerRoles.has(m.role)))).toBe(
      JSON.stringify(base.members.filter((m) => layerRoles.has(m.role))),
    )
  })

  test('explicit overrides beat the level default: framed stays lumber, cmu stays block, skip skips', () => {
    const cfg = lgsConfig('INTL', {
      wallOverrides: { w_mid: 'framed', w_n: 'cmu', w_w: 'skip' },
    })
    const r = computeLevel(baselineScene(), cfg)
    // w_mid framed in LUMBER
    expect(
      r.members.some((m) => m.sourceId === 'w_mid' && m.material === 'lumber' && m.role === 'stud'),
    ).toBe(true)
    expect(steelOf(r.members, 'w_mid').length).toBe(0)
    // w_n CMU blocks
    expect(r.members.some((m) => m.sourceId === 'w_n' && m.role === 'block')).toBe(true)
    expect(steelOf(r.members, 'w_n').length).toBe(0)
    // w_w skipped entirely
    expect(r.members.some((m) => m.sourceId === 'w_w')).toBe(false)
    // the rest are steel
    expect(steelOf(r.members, 'w_s').length).toBeGreaterThan(10)
  })

  test('FL: the jurisdiction CMU exterior default BEATS framingSystem — interior walls steel, shell CMU', () => {
    const base = computeLevel(baselineScene(), baselineConfig('FL'))
    const lgs = computeLevel(baselineScene(), lgsConfig('FL'))
    // exterior shell walls: CMU in both, byte-equal blockwork
    const blocks = (r: { members: Member[] }) => r.members.filter((m) => m.role === 'block')
    expect(JSON.stringify(blocks(lgs))).toBe(JSON.stringify(blocks(base)))
    // the interior partition frames STEEL under the level default
    expect(steelOf(lgs.members, 'w_mid').length).toBeGreaterThan(5)
    expect(
      lgs.members.some((m) => m.sourceId === 'w_mid' && m.material === 'lumber' && m.role === 'stud'),
    ).toBe(false)
  })

  test('machine plumb-through: lgsMachine rides config → spec → labels (fallback status, Phase-2 note on card scope)', () => {
    const r = computeLevel(baselineScene(), lgsConfig('INTL', { lgsMachine: 'framecad/f325it' }))
    const steel = steelOf(r.members).filter((m) => m.role === 'stud')
    expect(steel.length).toBeGreaterThan(0)
    for (const m of steel) expect(m.label).toContain(LGS.fallbackStatus)
    // the machine exists and is verified — the status is honest can't-roll fallback
    expect(machineFor('framecad/f325it')?.status).toBe('verified')
  })

  test('honesty warnings surface at the LEVEL: conservative mils + R603.9 + energy code', () => {
    const r = computeLevel(baselineScene(), lgsConfig())
    expect(r.warnings.some((w) => w.includes('R603.3.2 table cells not encoded'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('R603.9'))).toBe(true)
    // F2: the energy-code caveat reaches the warnings channel (P4 prints
    // it verbatim on paper) AND the characteristics notes…
    expect(r.warnings.some((w) => w.includes('IECC R402.2.6'))).toBe(true)
    expect(
      r.characteristics?.notes.some((n) => n.includes('R402.2.6') && n.includes('thermal')),
    ).toBe(true)
    // …and NEVER leaks into lumber corpora (the byte-parity guard)
    const lumber = computeLevel(baselineScene(), baselineConfig('INTL'))
    expect(lumber.warnings.some((w) => w.includes('R402.2.6'))).toBe(false)
    expect(lumber.characteristics?.notes.some((n) => n.includes('R402.2.6'))).toBe(false)
  })

  test('F2: the steel-frame characteristics note keys on wall CONSTRUCTION, not member emission', () => {
    // walls toggled OFF still resolve 'lgs' — the printed wall R would be
    // just as dishonest, so the note holds.
    const r = computeLevel(baselineScene(), { ...lgsConfig(), showWalls: false })
    expect(r.characteristics?.notes.some((n) => n.includes('R402.2.6'))).toBe(true)
  })

  test('round-2 D: the energy qualifier rides the CITATION at LOD 200 — the cite already prints there', () => {
    // The warning channel is 300+-gated (no structural code claims at
    // 200), but the R402 cavity-R + IECC cite print at EVERY LOD — a
    // steel 200 set carried 'Wall cavity R-30 … Table R402.1.3' with zero
    // qualifier. The qualifier now rides insulation.citation itself (one
    // source: paper block, notes line, CSV all inherit it).
    const steel200 = computeLevel(baselineScene(), { ...lgsConfig(), detail: '200' as const })
    expect(steel200.characteristics?.insulation.citation).toContain('wood-frame prescriptive')
    expect(steel200.characteristics?.insulation.citation).toContain('R402.2.6')
    expect(steel200.characteristics?.insulation.citation).toContain('not evaluated')
    expect(
      steel200.characteristics?.notes.some(
        (n) => n.startsWith('Wall cavity') && n.includes('R402.2.6'),
      ),
    ).toBe(true)
    // …and the paper's schedules block prints the qualified cite at 200
    const sheets = buildPlanSet(steel200.members, steel200.fixtures, {
      jurisdiction: steel200.jurisdiction,
      warnings: steel200.warnings,
      areas: steel200.areas,
      walls: steel200.walls,
      characteristics: steel200.characteristics ?? undefined,
    })
    const paper = sheets.map((sh) => sh.svg).join(' ')
    expect(paper).toContain('R402.2.6')
    // lumber 200 stays byte-clean — no qualifier anywhere
    const lumber200 = computeLevel(baselineScene(), { ...baselineConfig('INTL'), detail: '200' as const })
    expect(lumber200.characteristics?.insulation.citation).not.toContain('R402.2.6')
    expect(lumber200.characteristics?.notes.some((n) => n.includes('R402.2.6'))).toBe(false)
  })

  test('LIFTED window end-to-end: the R603.8 sill track composes through computeLevel (round-1 visual advisory)', () => {
    // The stock baselineScene window node sits at y=0 (extraction derives
    // sillHeight from the node's center y), so the R603.8 sill-track path
    // was engine-tested but never scene-composed. Lift the window: center
    // 1.5 m − 1.2/2 → sill 0.9 m.
    const nodes = baselineScene()
    nodes.win_s = { ...(nodes.win_s as Record<string, unknown>), position: [8.5, 1.5, 0] }
    const r = computeLevel(nodes, lgsConfig())
    const sills = r.members.filter((m) => m.role === 'sill' && m.profile !== undefined)
    expect(sills.length).toBe(1)
    expect(sills[0]?.profile).toBe('550T125-68')
    expect(sills[0]?.label).toContain('Sill track')
    expect(sills[0]?.label).toContain('R603.8')
    // cripples under the sill made it too
    const sillY = sills[0]?.position[1] ?? 0
    expect(
      r.members.some(
        (m) => m.role === 'cripple' && m.sourceId === 'w_s' && m.position[1] < sillY,
      ),
    ).toBe(true)
  })

  test('high-wind jurisdiction: LGS walls state that lumber-only uplift hardware does not cover them', () => {
    const r = computeLevel(baselineScene(), lgsConfig('LA'))
    expect(
      r.warnings.some((w) => w.includes('LGS wall uplift strapping not modeled')),
    ).toBe(true)
    // and no uplift connectors ride the steel walls
    expect(r.members.filter((m) => m.role === 'uplift-connector').length).toBe(0)
  })
})

describe('TAKEOFF gates — steel rows, screw schedule, no invented weights', () => {
  const base = computeLevel(baselineScene(), baselineConfig('INTL'))
  const lgsAll = computeLevel(baselineScene(), {
    ...baselineConfig('INTL'),
    framingSystem: 'lgs' as const,
  })
  const lgsOne = computeLevel(baselineScene(), {
    ...baselineConfig('INTL'),
    wallOverrides: { w_mid: 'lgs' as const },
  })
  const rows = (r: typeof base) => computeTakeoff(r.members, r.fixtures, r.areas)

  test('steel books by designator + LENGTH + verified grade; weight is never invented', () => {
    const steelRows = rows(lgsAll).filter(
      (r) => r.item.startsWith('LGS ') && !r.item.startsWith('LGS strap bracing'),
    )
    expect(steelRows.length).toBeGreaterThanOrEqual(4) // S+T per web family in the scene
    for (const r of steelRows) {
      expect(r.unit).toBe('lf')
      expect(r.detail).toContain('weight requires vendor data')
      // item = 'LGS <designator> (Gr NN)' — a real catalog row whose
      // printed grade equals the data (round-1 F3b: grade printed nowhere)
      const m = /^LGS (\S+) \(Gr (\d+)\)$/.exec(r.item)
      expect(m).not.toBeNull()
      const fam = LGS.genericFamilies[m?.[1] ?? '']
      expect(fam).toBeDefined()
      expect(String(fam?.yieldKsi)).toBe(m?.[2] ?? '')
    }
    // NO steel framing row books pounds/kilograms
    for (const r of rows(lgsAll)) {
      if (r.item.startsWith('LGS ')) expect(['lbs', 'kg']).not.toContain(r.unit)
    }
  })

  test('lf figures re-derive from the members exactly', () => {
    const steel = steelOf(lgsAll.members).filter((m) => m.profile === '550S162-68')
    const lf = steel.reduce((sum, m) => sum + m.length / 0.3048, 0)
    const row = rows(lgsAll).find((r) => r.item === 'LGS 550S162-68 (Gr 50)')
    expect(row?.quantity).toBeCloseTo(Math.round(lf * 10) / 10, 1)
    expect(row?.detail).toContain(`${steel.length} pcs`)
  })

  test('strap bracing books by length on its own row; the B9 portal census is untouched', () => {
    const strapRow = rows(lgsAll).find((r) => r.item === 'LGS strap bracing 1-1/2" × 33 mil')
    const straps = lgsAll.members.filter((m) => m.role === 'strap-bracing')
    expect(strapRow).toBeDefined()
    expect(strapRow?.unit).toBe('lf')
    expect(strapRow?.quantity).toBeCloseTo(
      Math.round(straps.reduce((s, m) => s + m.length / 0.3048, 0) * 10) / 10,
      1,
    )
    expect(rows(lgsAll).some((r) => r.item === 'Portal straps 1000 lb')).toBe(false)
  })

  test('screw schedule: stud-to-track = 4 × verticals (Table R603.3.2(1)); sheet screws derive from the spacings', () => {
    const verticals = steelOf(lgsAll.members).filter((m) =>
      ['stud', 'king-stud', 'trimmer', 'cripple'].includes(m.role),
    ).length
    const stRow = rows(lgsAll).find((r) => r.item.includes('stud-to-track'))
    expect(stRow?.quantity).toBe(verticals * 4)
    expect(stRow?.detail).toContain('C1513')
    // sheathing screws: 6/12 on the derived per-sheet figure
    expect(screwsPerSheet(6, 12)).toBe(66)
    expect(screwsPerSheet(12, 12)).toBe(42)
    const shRow = rows(lgsAll).find((r) => r.item.includes('sheathing to steel'))
    expect(shRow).toBeDefined()
    expect(shRow?.detail).toContain('R603.2.5')
    expect((shRow?.quantity ?? 0) % 66).toBe(0)
    const gyRow = rows(lgsAll).find((r) => r.item.includes('gypsum to steel'))
    expect(gyRow).toBeDefined()
    expect((gyRow?.quantity ?? 0) % 42).toBe(0)
  })

  test('8d nail basis splits by wall material: an all-steel level books ZERO wall-sheathing 8d', () => {
    // baseline scene: all sheathing hangs on steel walls → the 8d wall row
    // dies with the nail basis; screws replace it.
    const nails8d = rows(lgsAll).filter((r) => r.item === 'Nails 8d common')
    expect(nails8d.length).toBe(0)
    // the sheet-goods AREAS still book identically (F1)
    const sheathing = (rs: { item: string; quantity: number }[]) =>
      rs.find((r) => r.item === 'Sheathing 7/16" WSP')
    expect(sheathing(rows(lgsAll))?.quantity).toBe(sheathing(rows(base))?.quantity)
  })

  test('PARTIAL steel: one lgs partition — 8d keys off the remaining lumber-wall sheets only', () => {
    // w_mid is interior → contributes drywall, not sheathing: the 8d row
    // must be IDENTICAL to base (sheathing all lumber), while gypsum
    // screws appear for the steel wall's drywall.
    const rowsOne = rows(lgsOne)
    const base8d = rows(base).find((r) => r.item === 'Nails 8d common')
    const one8d = rowsOne.find((r) => r.item === 'Nails 8d common')
    expect(one8d?.detail).toBe(base8d?.detail)
    expect(rowsOne.some((r) => r.item.includes('gypsum to steel'))).toBe(true)
    expect(rowsOne.some((r) => r.item.includes('sheathing to steel'))).toBe(false)
    // drywall AREA row unchanged (both faces still book)
    const dw = (rs: { item: string; quantity: number }[]) =>
      rs.find((r) => r.item === 'Drywall 1/2"')
    expect(dw(rowsOne)?.quantity).toBe(dw(rows(base))?.quantity)
  })

  test('round-3 F3: the takeoff grade RE-DERIVES per row — a 33-mil member books (Gr 33), never a hardcoded Gr 50', () => {
    // The whole-scene grade gates ran conservative (all-68) scenes only,
    // so a hardcoded '(Gr 50)' in the takeoff item survived — a false
    // S230 A4.4 claim on paper the moment a thinner row books (and a C4
    // disagreement with the legend, which derives independently). LOD 200
    // keeps the generic 33-mil members: their rows must print Gr 33.
    const lgs200 = computeLevel(baselineScene(), {
      ...baselineConfig('INTL'),
      detail: '200' as const,
      framingSystem: 'lgs' as const,
    })
    const rows200 = computeTakeoff(lgs200.members, lgs200.fixtures, lgs200.areas)
    const gr33 = rows200.filter((r) => /^LGS \S+-33 \(Gr 33\)$/.test(r.item))
    expect(gr33.length).toBeGreaterThanOrEqual(2) // 350S162-33 + 550S162-33 at least
    expect(rows200.some((r) => r.item.includes('-33 (Gr 50)'))).toBe(false)
    // …and the 400 scene keeps its Gr 50 rows (both grades reachable)
    expect(rows(lgsAll).some((r) => /-68 \(Gr 50\)$/.test(r.item))).toBe(true)
  })

  test('F4a: an all-steel level books ZERO framing-nail rows — the wood-material filter is pinned', () => {
    // Steel verticals share the lumber roles (stud/king/…): without the
    // WOOD_MATERIALS gate on ROLE_CONNECTIONS the takeoff would book
    // phantom '16d/10d lbs' from steel members (surviving mutant,
    // round-1 F4a). The baseline scene has no roof/floor lumber, so the
    // all-steel level's nail section must be EMPTY.
    const nailRows = rows(lgsAll).filter((r) => r.item.startsWith('Nails '))
    expect(nailRows).toEqual([])
    // …while the lumber twin books them (non-vacuous)
    expect(rows(base).some((r) => r.item === 'Nails 16d common')).toBe(true)
  })

  test('flags reach the takeoff Flags rows (header capacity + compression classes)', () => {
    const flags = rows(lgsAll).filter((r) => r.section === 'Flags')
    expect(
      flags.some((r) => r.detail.includes('header span capacity not verified against Table R603.6')),
    ).toBe(true)
  })
})

describe("MACHINE CONSTRAINTS — the Phase-2 can't-roll warning channel", () => {
  // 0.15 m wall → 2x6-equivalent → 550-web stems; conservative 68 mil at
  // 400 (the exact resolutions the warnings must name).
  const walls = [wall({ id: 'a', thickness: 0.15, exterior: true })]
  const machineLines = (warnings: string[]) => warnings.filter((w) => w.startsWith('Machine'))

  test('the TF550H exhibit (the real Phase-1 finding): S162 studs roll, T125 track cannot — the level warning says exactly that', () => {
    const { members, warnings } = lgsFrameWalls(walls, {
      ...spec400,
      lgsMachine: 'framecad/tf550h',
    })
    expect(warnings).toContain(
      'Machine FRAMECAD TF550H cannot roll 550T125-68 (tracks) — ' +
        'generic AISI fallback used; verify with vendor',
    )
    // NEVER a stud claim — the machine's published ranges roll 550S162-68
    expect(machineLines(warnings).some((w) => w.includes('(studs)'))).toBe(false)
    // …and the warning agrees with the members: tracks carry the fallback
    // status, studs the brand (the label channel and the warning channel
    // tell ONE story)
    for (const m of steelOf(members)) {
      if (m.role === 'bottom-plate' || m.role === 'top-plate' || m.role === 'sill') {
        expect(m.label).toContain(LGS.fallbackStatus)
      } else if (m.role !== 'backing') {
        expect(m.label).toContain('(framecad/tf550h)')
      }
    }
  })

  test('a machine that rolls NEITHER family composed here warns per designator (studs AND tracks)', () => {
    // F325iT rolls 33/43 mil only — the conservative 68-mil picks both fall back
    const { warnings } = lgsFrameWalls(walls, { ...spec400, lgsMachine: 'framecad/f325it' })
    expect(warnings).toContain(
      'Machine FRAMECAD F325iT cannot roll 550S162-68 (studs) — ' +
        'generic AISI fallback used; verify with vendor',
    )
    expect(warnings).toContain(
      'Machine FRAMECAD F325iT cannot roll 550T125-68 (tracks) — ' +
        'generic AISI fallback used; verify with vendor',
    )
  })

  test('a fully-rollable machine → ZERO machine warnings; every label branded (warnings derive from the rollable set, not from machine-set-ness)', () => {
    // No real catalog machine claims T125 track rollability (the vendor
    // flange floors sit above the 1-1/4" track flange), so the no-warning
    // leg uses a synthetic verified machine — injected and RESTORED like
    // the zzforge precedent in lgs-profiles.test.ts.
    const vendors = LGS.vendors as Record<string, (typeof LGS.vendors)[string]>
    vendors.zzroll = {
      name: 'ZZ Roll',
      website: 'https://example.com',
      machines: {
        all: {
          name: 'ZZ Roll-All 9000',
          status: 'verified',
          sourceUrls: ['https://example.com/spec'],
          rollableFamilies: [
            { family: '350S162', basis: 'derived — test fixture' },
            { family: '550S162', basis: 'derived — test fixture' },
            { family: '350T125', basis: 'derived — test fixture' },
            { family: '550T125', basis: 'derived — test fixture' },
            { family: '150U050', basis: 'derived — test fixture' },
          ],
        },
      },
    }
    try {
      const { members, warnings } = lgsFrameWalls(walls, {
        ...spec400,
        lgsMachine: 'zzroll/all',
      })
      expect(machineLines(warnings)).toEqual([])
      for (const m of steelOf(members)) {
        if (m.role === 'backing') continue
        expect(m.label).toContain('(zzroll/all)')
        expect(m.label).not.toContain(LGS.fallbackStatus)
      }
    } finally {
      delete vendors.zzroll
    }
  })

  test('generic (no machine): no machine warnings at all', () => {
    const { warnings } = lgsFrameWalls(walls, spec400)
    expect(machineLines(warnings)).toEqual([])
  })

  test('BRIDGING-only fallback: the class word is verbatim, the warning is exactly as wide as what composes (round-1 skeptic F1)', () => {
    // A synthetic verified machine that rolls the stud AND track families
    // but NOT the 150U050 bridging channel — the only-bridging-falls-back
    // scenario that tracks all three previously-untracked mutants:
    // (a) deleting the backing-site emission, (b) lying about the class
    // word ('studs' while studs are branded verified), (c) dropping the
    // emits-guard (a warning wider than what's drawn). Injected +
    // restored per the zzforge precedent.
    const vendors = LGS.vendors as Record<string, (typeof LGS.vendors)[string]>
    vendors.zztrack = {
      name: 'ZZ Track',
      website: 'https://example.com',
      machines: {
        all: {
          name: 'ZZ Track-All 5000',
          status: 'verified',
          sourceUrls: ['https://example.com/spec'],
          rollableFamilies: [
            { family: '350S162', basis: 'derived — test fixture' },
            { family: '550S162', basis: 'derived — test fixture' },
            { family: '350T125', basis: 'derived — test fixture' },
            { family: '550T125', basis: 'derived — test fixture' },
          ],
        },
      },
    }
    const teeWalls = [
      wall({ id: 'through', start: [0, 0], end: [6, 0], thickness: 0.15, exterior: true }),
      wall({ id: 'stem', start: [3, 0], end: [3, 3], thickness: 0.114 }),
    ]
    try {
      const spec: FramingSpec = { ...spec400, lgsMachine: 'zztrack/all' }
      const { members, warnings } = lgsFrameWalls(teeWalls, spec)
      // non-vacuous: bridging really composes on the through wall
      expect(members.filter((m) => m.role === 'backing').length).toBeGreaterThan(0)
      // (a) the emission exists + (b) the class word is VERBATIM — the
      // one designator only bridging resolves, never another class's word
      expect(machineLines(warnings)).toEqual([
        'Machine ZZ Track-All 5000 cannot roll 150U050-54 (bridging channels) — ' +
          'generic AISI fallback used; verify with vendor',
      ])
      // …and the branded classes never leak into a warning
      expect(warnings.some((w) => w.includes('(studs)') || w.includes('(tracks)'))).toBe(
        false,
      )
      // (c) emits-guard: the SAME tee at a spacing whose stud-to-stud gap
      // is under the 3" buildable minimum composes ZERO backing members —
      // the backing tee still exists in the hint graph, so an un-guarded
      // emission would warn about members that are not drawn
      const tight = lgsFrameWalls(teeWalls, { ...spec, studSpacing: inches(2.5) })
      expect(tight.members.filter((m) => m.role === 'backing')).toEqual([])
      expect(machineLines(tight.warnings)).toEqual([])
    } finally {
      delete vendors.zztrack
    }
  })

  test('UNVERIFIED machine (Pinnacle): the honest unverified warning — NEVER a cannot-roll claim (nothing was checked)', () => {
    const { warnings } = lgsFrameWalls(walls, { ...spec400, lgsMachine: 'pinnacle/x1' })
    expect(warnings).toContain(
      'Machine Pinnacle X1 is unverified — generic AISI dims used for ' +
        'every steel profile; verify capability with the vendor',
    )
    expect(warnings.some((w) => w.includes('cannot roll'))).toBe(false)
  })

  test('unknown machine key: loud not-found warning, no capability claims', () => {
    const { warnings } = lgsFrameWalls(walls, { ...spec400, lgsMachine: 'acme/rocket' })
    expect(warnings).toContain(
      "Machine 'acme/rocket' not found in the catalog — " +
        'generic AISI profiles used for all steel members; check the machine key',
    )
    expect(warnings.some((w) => w.includes('cannot roll'))).toBe(false)
  })

  test('LOD ladder: machine warnings at 300+, NONE at 200 (labels keep the honest fallback status there)', () => {
    // A tee so the BACKING site composes too — all three emission sites
    // (studs, tracks, backing) must hold the 200 gate. Pinnacle/unknown
    // fall back on EVERY resolution (tf550h alone can't probe the stud or
    // backing site at 200: it rolls the 33-mil floor picks — a
    // codeClaims-drop mutant there would survive the track-only probe).
    const teeWalls = [
      wall({ id: 'through', start: [0, 0], end: [6, 0], thickness: 0.15, exterior: true }),
      wall({ id: 'stem', start: [3, 0], end: [3, 3], thickness: 0.114 }),
    ]
    for (const key of ['framecad/tf550h', 'pinnacle/x1', 'acme/rocket']) {
      const lod200 = lgsFrameWalls(teeWalls, {
        ...DEFAULT_SPEC,
        detail: '200',
        lgsMachine: key,
      } as FramingSpec)
      expect(lod200.members.some((m) => m.role === 'backing')).toBe(true) // non-vacuous
      expect(machineLines(lod200.warnings)).toEqual([])
      const lod300 = lgsFrameWalls(teeWalls, {
        ...DEFAULT_SPEC,
        detail: '300',
        lgsMachine: key,
      } as FramingSpec)
      expect(machineLines(lod300.warnings).length).toBeGreaterThan(0)
    }
    // the label channel is not LOD-gated — the track still says the truth
    const lod200 = lgsFrameWalls(walls, {
      ...DEFAULT_SPEC,
      detail: '200',
      lgsMachine: 'framecad/tf550h',
    } as FramingSpec)
    const track200 = lod200.members.find((m) => m.role === 'bottom-plate')
    expect(track200?.label).toContain(LGS.fallbackStatus)
  })

  test('the LOD-200 exception, pinned (round-1 skeptic F3): a machine NARROWS the generic pick to its rollable floor — expected, stated; at 300+ the boundary holds byte-for-byte', () => {
    // At 200 the generic ask is the 33-mil structural floor; TF550H's
    // rollable 550S162 set starts at 43 — the machine flips the stud
    // designator (Phase-1 resolution behavior, now stated at its true
    // scope everywhere the boundary claim prints).
    const no200 = lgsFrameWalls(walls, { ...DEFAULT_SPEC, detail: '200' } as FramingSpec)
    const with200 = lgsFrameWalls(walls, {
      ...DEFAULT_SPEC,
      detail: '200',
      lgsMachine: 'framecad/tf550h',
    } as FramingSpec)
    const studNo = no200.members.find((m) => m.role === 'stud')
    const studWith = with200.members.find((m) => m.role === 'stud')
    expect(studNo?.profile).toBe('550S162-33')
    expect(studWith?.profile).toBe('550S162-43')
    // the envelope does NOT move — family dims are mil-invariant
    expect(studWith?.dims).toEqual(studNo?.dims as never)
    // at 300+ the conservative pick already sits at the table-domain max:
    // members byte-identical with/without the machine EXCEPT labels/flags
    const strip = (ms: Member[]) =>
      ms.map(({ label: _l, flag: _f, ...rest }) => rest)
    const no400 = lgsFrameWalls(walls, spec400)
    const with400 = lgsFrameWalls(walls, { ...spec400, lgsMachine: 'framecad/tf550h' })
    expect(JSON.stringify(strip(with400.members))).toBe(
      JSON.stringify(strip(no400.members)),
    )
  })

  test('end-to-end: the warning reaches computeLevel and prints on paper (P4)', () => {
    const lgs = computeLevel(baselineScene(), {
      ...baselineConfig('INTL'),
      framingSystem: 'lgs' as const,
      lgsMachine: 'framecad/tf550h',
    })
    const trackWarnings = lgs.warnings.filter(
      (w) => w.includes('cannot roll') && w.includes('(tracks)'),
    )
    // both stems compose in the baseline scene → both T125 designators warn
    expect(trackWarnings.some((w) => w.includes('350T125-68'))).toBe(true)
    expect(trackWarnings.some((w) => w.includes('550T125-68'))).toBe(true)
    const sheets = buildPlanSet(lgs.members, lgs.fixtures, {
      jurisdiction: lgs.jurisdiction,
      warnings: lgs.warnings,
      areas: lgs.areas,
      walls: lgs.walls,
      characteristics: lgs.characteristics ?? undefined,
    })
    const paper = sheets.map((sh) => sh.svg).join(' ')
    expect(paper).toContain('cannot roll')
    expect(paper).toContain('verify with vendor')
  })
})

// ---------------------------------------------------------------------------
// IRC R603 layout gate (2026-09 wall-framing fix): a 12 ft steel wall — stud
// + track section depths, the R603.3.2 spacings, the 12" off-table flag, and
// the stud-to-track fastening note at LOD 400.
// ---------------------------------------------------------------------------

describe('IRC R603 — 12 ft CFS wall stud + track layout', () => {
  const FT = 0.3048
  /** 2x4-equivalent steel wall: 350S162 web is 3-1/2" (dressed-depth-matched
   * to a 2x4 by design — see lgs-profiles.ts). Drawn at a real 5-3/16"
   * exterior assembly total so nothing compresses. */
  const EXT_350_TOTAL = inches(0.75 + 0.4375 + 3.5 + 0.5)
  /** 550S162 web is 5-1/2" (the 2x6 twin). */
  const EXT_550_TOTAL = inches(0.75 + 0.4375 + 5.5 + 0.5)

  const w12 = (overrides: Partial<WallSlice> = {}): WallSlice =>
    wall({
      start: [0, 0],
      end: [12 * FT, 0],
      height: 8 * FT,
      thickness: EXT_350_TOTAL,
      // The host assembly declares the core (WS5) — that, not the total
      // drawn thickness, picks the depth-matched steel web.
      framingDepth: inches(3.5),
      framingKind: 'lgs',
      ...overrides,
    })

  test('350S162 studs @ 16" o.c. between 350T125 tracks, module centers', () => {
    const { members } = lgsFrameWalls([w12()], spec400)
    const studs = members
      .filter((m) => m.role === 'stud')
      .sort((a, b) => a.position[0] - b.position[0])
    // Same layout law as lumber: end stud + centers on the 16" module.
    expect(studs).toHaveLength(10)
    for (let i = 1; i <= 8; i++) {
      expect(studs[i]?.position[0]).toBeCloseTo(inches(16 * i), 5)
    }
    // C-stud section: 3-1/2" web across the wall, 1-5/8" flange along it.
    expect(studs.every((m) => m.profile === '350S162-68')).toBe(true)
    expect(studs[0]?.dims[2]).toBeCloseTo(inches(3.5), 4)
    expect(studs[0]?.dims[0]).toBeCloseTo(inches(1.625), 4)
    // TRACK, not plates: one bottom + one top 350T125, no cap plate.
    const bottom = members.filter((m) => m.role === 'bottom-plate')
    const top = members.filter((m) => m.role === 'top-plate')
    expect(bottom).toHaveLength(1)
    expect(top).toHaveLength(1)
    expect(members.filter((m) => m.role === 'cap-plate')).toHaveLength(0)
    expect(bottom[0]?.profile).toBe('350T125-68')
    expect(top[0]?.profile).toBe('350T125-68')
    // T125 = 1-1/4" flange: that is the track's height on the floor/ceiling.
    // (Catalog dims are the published mm values — 31.8 mm, not 31.75.)
    expect(bottom[0]?.dims[1]).toBeCloseTo(inches(1.25), 3)
    expect(bottom[0]?.dims[2]).toBeCloseTo(inches(3.5), 4)
  })

  test('550 web: 5-1/2" studs in 550T125 track', () => {
    const { members } = lgsFrameWalls(
      [w12({ thickness: EXT_550_TOTAL, framingDepth: inches(5.5) })],
      spec400,
    )
    const studs = members.filter((m) => m.role === 'stud')
    expect(studs.every((m) => m.profile === '550S162-68')).toBe(true)
    expect(studs[0]?.dims[2]).toBeCloseTo(inches(5.5), 4)
    expect(studs[0]?.dims[0]).toBeCloseTo(inches(1.625), 4)
    const bottom = members.filter((m) => m.role === 'bottom-plate')[0] as Member
    expect(bottom.profile).toBe('550T125-68')
    expect(bottom.dims[2]).toBeCloseTo(inches(5.5), 4)
  })

  test('24" o.c. is an R603.3.2 spacing — no off-table flag', () => {
    const { members, warnings } = lgsFrameWalls([w12()], {
      ...spec400,
      studSpacing: inches(24),
    })
    const studs = members.filter((m) => m.role === 'stud')
    expect(studs).toHaveLength(7)
    expect(studs.some((m) => (m.flag ?? '').includes('not an R603.3.2'))).toBe(false)
    expect([...warnings].some((x) => x.includes('not an R603.3.2'))).toBe(false)
  })

  test('12" o.c. frames as drawn but is flagged: R603.3.2 has no 12" column', () => {
    const { members, warnings } = lgsFrameWalls([w12()], {
      ...spec400,
      studSpacing: inches(12),
    })
    const studs = members.filter((m) => m.role === 'stud')
    expect(studs).toHaveLength(13)
    expect(studs.every((m) => (m.flag ?? '').includes('not an R603.3.2 tabulated'))).toBe(true)
    expect([...warnings].some((x) => x.includes('not an R603.3.2 tabulated'))).toBe(true)
  })

  test('opening: king + jack each side, 2-C box header, R603.7/R603.6 cited', () => {
    const w = w12({
      openings: [
        {
          id: 'd1',
          kind: 'door' as const,
          u: 6 * FT,
          width: 0.9,
          height: 2.1,
          sillHeight: 0,
          roughWidth: 0.9 + inches(1.5),
          roughHeight: 2.1 + inches(1.5),
        },
      ],
    })
    const { members } = lgsFrameWalls([w], spec400)
    expect(members.filter((m) => m.role === 'king-stud')).toHaveLength(2)
    expect(members.filter((m) => m.role === 'trimmer')).toHaveLength(2 * LGS_JACKS_PER_SIDE)
    const header = members.filter((m) => m.role === 'header')
    expect(header).toHaveLength(1)
    expect(header[0]?.label ?? '').toContain('box')
    expect(header[0]?.label ?? '').toContain('R603.6')
    expect(header[0]?.profile).toBe('350S162-68')
    // The box is two C-sections wide across the wall.
    expect(header[0]?.dims[2]).toBeCloseTo(2 * inches(1.625), 4)
    expect(members.filter((m) => m.role === 'cripple').length).toBeGreaterThan(0)
  })

  test('LOD 400 tracks carry the stud-to-track screw schedule', () => {
    const { members } = lgsFrameWalls([w12()], spec400)
    const bottom = members.filter((m) => m.role === 'bottom-plate')[0] as Member
    expect(bottom.advisory ?? '').toContain('No. 8')
    expect(bottom.advisory ?? '').toContain('R603.3.2(1)')
    expect(bottom.advisory ?? '').toContain('C1513')
    // Not a code claim at LOD 200.
    const generic = lgsFrameWalls([w12()], { ...DEFAULT_SPEC, detail: '200' })
    expect(
      (generic.members.filter((m) => m.role === 'bottom-plate')[0] as Member).advisory,
    ).toBeUndefined()
  })

  test('mil designations carry the AISI S220/IRC R603.2 design thicknesses', () => {
    for (const [mils, designThicknessIn] of [
      [33, 0.0346],
      [43, 0.0451],
      [54, 0.0566],
      [68, 0.0713],
    ] as const) {
      expect(LGS.genericFamilies[`350S162-${mils}`]?.designThicknessIn).toBe(designThicknessIn)
      expect(LGS.genericFamilies[`550S162-${mils}`]?.designThicknessIn).toBe(designThicknessIn)
      expect(LGS.genericFamilies[`350T125-${mils}`]?.designThicknessIn).toBe(designThicknessIn)
    }
  })
})
