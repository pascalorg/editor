import { describe, expect, test } from 'bun:test'
import { DEFAULT_SPEC } from '../core/spec'
import { baselineConfig, baselineScene } from '../framing/baseline-scene'
import { computeLevel } from '../framing/compute'
import { framedAssembly, FramingNode, framesAsLumber, WallOverride } from '../framing/schema'
import { selectedWallInfo } from '../panel-selection'
import {
  DEFAULT_STRUCTURAL_MILS,
  familyStemFor,
  familyVariants,
  LGS,
  LGS_FALLBACK_STATUS,
  machineFor,
  machineKeys,
  parseDesignator,
  profileFamily,
  profileFor,
  rollableDesignators,
} from './lgs-profiles'

/**
 * LGS Phase 0 gates (docs/plans/LGS-PLAN.md): the profile catalog + pure
 * resolution module. NOTHING here touches the engines — the E5
 * master-baseline byte pin (compute.devices.test.ts) proves the rest of the
 * suite that Phase 0 changed no output.
 */

describe('AISI designator parsing', () => {
  test('350S162-33 parses to web/section/flange/mils', () => {
    expect(parseDesignator('350S162-33')).toEqual({
      webIn: 3.5,
      section: 'S',
      flangeIn: 1.62,
      mils: 33,
    })
  })

  test('tracks, channels, 4-digit webs, 3-digit mils, case + whitespace', () => {
    expect(parseDesignator('550T125-68')?.section).toBe('T')
    expect(parseDesignator('150U050-54')?.section).toBe('U')
    expect(parseDesignator('1200S162-97')?.webIn).toBe(12)
    expect(parseDesignator('1000S162-118')?.mils).toBe(118)
    expect(parseDesignator(' 350s162-33 ')?.mils).toBe(33)
  })

  test("all five S240/SFIA letters parse — incl. 'L' (angle/L-header, skeptic F5)", () => {
    expect(parseDesignator('150L150-54')?.section).toBe('L')
    expect(parseDesignator('350F125-33')?.section).toBe('F')
    // no L/F rows in the catalog → lookups fall back honestly, never throw
    expect(profileFamily('150L150-54')).toBeUndefined()
    expect(familyVariants('150L150')).toEqual([])
  })

  test('leading-zero THREE-digit tokens are real products (SFIA 075U050-54) and parse', () => {
    // Verified against the SFIA guide local copy: 075U050-54 is a shipped
    // product row (web 3/4 in, flange 1/2 in) — the skeptic-F5 literal
    // "reject leading-zero web/flange tokens" would break it AND our own
    // 150U050-54 ('050' flange), so the parser keeps sub-1-inch tokens.
    const u = parseDesignator('075U050-54')
    expect(u?.webIn).toBe(0.75)
    expect(u?.flangeIn).toBe(0.5)
  })

  test('malformed designators return null, never a guess — incl. padded aliases (F5)', () => {
    for (const bad of ['2x4', '350S162', 'S162-33', '35X162-33', '350S16-33', '']) {
      expect(parseDesignator(bad)).toBeNull()
    }
    // A FOUR-digit web starting with 0 is a padded alias of a real
    // designator ('0350S162-33' ≙ 350S162-33) that would silently MISS
    // every catalog lookup — rejected at parse.
    expect(parseDesignator('0350S162-33')).toBeNull()
    expect(parseDesignator('0550T125-43')).toBeNull()
    // Zero-padded MILS are the same alias class in the LAST field
    // ('350S162-033' used to parse to mils 33 while the catalog key is
    // '350S162-33' — silent lookup miss, round-2 residual): real mils run
    // 18-118, never 0-leading.
    expect(parseDesignator('350S162-033')).toBeNull()
    expect(parseDesignator('0550T125-033')).toBeNull()
    expect(parseDesignator('350S162-05')).toBeNull() // nonsense sub-10 mils
    expect(parseDesignator('1000S162-118')?.mils).toBe(118) // real ceiling still parses
  })
})

describe('generic family lookup (the always-verified base)', () => {
  test('350S162-33 carries the verified SFIA/AISI dims', () => {
    const f = profileFamily('350S162-33')
    expect(f).toBeDefined()
    expect(f?.webMm).toBe(88.9) // 3.5 in
    expect(f?.flangeMm).toBe(41.3) // 1-5/8 in
    expect(f?.lipMm).toBe(12.7) // 1/2 in per S240 A5-10
    expect(f?.designThicknessMm).toBe(0.879) // S240 Table A5-1
    expect(f?.gaugeRef).toBe(20)
    expect(f?.yieldKsi).toBe(33)
  })

  test('≥54 mil rows carry Grade 50 (S230 A4.4); tracks have no lip', () => {
    expect(profileFamily('550S162-68')?.yieldKsi).toBe(50)
    expect(profileFamily('550S162-43')?.yieldKsi).toBe(33)
    const track = profileFamily('550T125-43')
    expect(track?.section).toBe('T')
    expect(track?.lipMm).toBeUndefined()
    expect(track?.flangeMm).toBe(31.8) // 1-1/4 in
  })

  test('familyVariants: R603 stud sets, thinnest first', () => {
    // 350S162-68: SFIA product row + S230 stud tables select it within IRC
    // applicability (skeptic F2) — same 33-68 set as the 550 twin.
    expect(familyVariants('350S162')).toEqual([
      '350S162-33',
      '350S162-43',
      '350S162-54',
      '350S162-68',
    ])
    expect(familyVariants('550S162')).toEqual([
      '550S162-33',
      '550S162-43',
      '550S162-54',
      '550S162-68',
    ])
    // S230 floor tables: 800 goes down to 33 mil, 1000/1200 start at 43
    expect(familyVariants('800S162')[0]).toBe('800S162-33')
    expect(familyVariants('1000S162')[0]).toBe('1000S162-43')
    expect(familyVariants('nope')).toEqual([])
  })
})

describe('machine catalog', () => {
  test('the briefed vendors are selectable', () => {
    const keys = machineKeys()
    expect(keys).toContain('framecad/f325it')
    expect(keys).toContain('framecad/st950h')
    expect(keys).toContain('howick/frama3200')
    expect(keys).toContain('pinnacle/x1')
    expect(machineFor('framecad/f325it')?.name).toBe('FRAMECAD F325iT')
    expect(machineFor('FRAMECAD/F325iT')?.name).toBe('FRAMECAD F325iT') // case-insensitive
    expect(machineFor('acme/rocket')).toBeUndefined()
    expect(machineFor('framecad')).toBeUndefined()
  })

  test('rollable set derives from published ranges (F325iT: 33/43 mil only)', () => {
    const m = machineFor('framecad/f325it')
    if (!m) throw new Error('missing machine')
    const set = rollableDesignators(m)
    expect(set).toContain('350S162-33')
    expect(set).toContain('350S162-43')
    expect(set).toContain('550S162-43')
    expect(set).not.toContain('550S162-54') // 54 mil base 1.367mm > 1.2mm coil max
    expect(set).not.toContain('800S162-43') // web 203mm > 150mm max
  })

  test('the derivation rule is applied CONSISTENTLY (skeptic F3: F450iT includes 33 mil)', () => {
    // 33 mil min-base 0.836mm sits inside F450iT's PDF-verified 0.70-1.6mm
    // coil range — meta.derivation's own rule, no silent exclusions.
    const m = machineFor('framecad/f450it')
    if (!m) throw new Error('missing machine')
    const set = rollableDesignators(m)
    expect(set).toContain('350S162-33')
    expect(set).toContain('550S162-33')
    expect(set).not.toContain('550S162-68') // 68 mil base 1.720mm > 1.6mm coil max
  })

  test('an UNVERIFIED machine constrains nothing — empty rollable set', () => {
    const m = machineFor('pinnacle/x1')
    if (!m) throw new Error('missing machine')
    expect(m.status).toBe(LGS_FALLBACK_STATUS)
    expect(rollableDesignators(m)).toEqual([])
  })
})

describe('profileFor — the honest resolution chain', () => {
  test('role → family stem policy is dressed-depth-matched to the lumber spec', () => {
    expect(familyStemFor('stud', DEFAULT_SPEC)).toBe('550S162') // exterior 2x6
    expect(familyStemFor('stud', DEFAULT_SPEC, { interior: true })).toBe('350S162') // 2x4
    expect(familyStemFor('top-plate', DEFAULT_SPEC)).toBe('550T125')
    expect(familyStemFor('header', DEFAULT_SPEC)).toBe('550S162')
    expect(familyStemFor('joist', DEFAULT_SPEC)).toBe('800S162') // joistSizes[0] = 2x8
    expect(familyStemFor('rim-joist', DEFAULT_SPEC)).toBe('800T125')
    expect(familyStemFor('ceiling-joist', DEFAULT_SPEC)).toBe('550S162') // 2x6
    expect(familyStemFor('blocking', DEFAULT_SPEC)).toBe('150U050') // CRC bridging, real family
    expect(familyStemFor('girder', DEFAULT_SPEC)).toBeNull()
  })

  test('no machine: generic AISI row, verified, thinnest structural mils', () => {
    const r = profileFor('stud', DEFAULT_SPEC)
    if (!('designator' in r)) throw new Error('unexpected')
    expect(r.status).toBe('verified')
    expect(r.designator).toBe('550S162-33')
    expect(r.family.mils).toBe(DEFAULT_STRUCTURAL_MILS)
    expect(r.machine).toBeUndefined()
    expect(r.sources.length).toBeGreaterThan(0)
    expect(r.sources.every((s) => s.startsWith('http'))).toBe(true)
  })

  test('verified machine that rolls the family: machine-scoped, spec-sheet sources', () => {
    const r = profileFor('stud', { ...DEFAULT_SPEC, lgsMachine: 'framecad/f325it' })
    if (!('designator' in r)) throw new Error('unexpected')
    expect(r.status).toBe('verified')
    expect(r.designator).toBe('550S162-33')
    expect(r.machine).toBe('framecad/f325it')
    expect(r.sources.some((s) => s.includes('framecad'))).toBe(true)
  })

  test("vendor's OWN profile (nearestGeneric): vendor designator + dims delta note", () => {
    const r = profileFor(
      'stud',
      { ...DEFAULT_SPEC, lgsMachine: 'howick/frama3200' },
      { interior: true }, // 2x4 → 350 stem, FRAMA 3200's 89mm C
    )
    if (!('designator' in r)) throw new Error('unexpected')
    expect(r.status).toBe('verified')
    expect(r.designator).toContain('HOWICK-89C41')
    expect(r.machineProfile?.lipMm).toBe(10) // Howick geometry, NOT the AISI 12.7
    expect(r.machineProfile?.nearestGeneric).toBe('350S162')
    expect(r.note).toContain('lip 10mm')
    expect(r.family.webMm).toBe(88.9) // the generic reference rides along
    expect(r.sources.some((s) => s.includes('howickltd'))).toBe(true)
  })

  test("verified machine that CAN'T roll the family: generic dims + the loud fallback status", () => {
    // FRAMA 3200 has no 550-class rollable row (exterior 2x6 stud)
    const r = profileFor('stud', { ...DEFAULT_SPEC, lgsMachine: 'howick/frama3200' })
    if (!('designator' in r)) throw new Error('unexpected')
    expect(r.status).toBe(LGS_FALLBACK_STATUS)
    expect(r.designator).toBe('550S162-33')
    expect(r.machine).toBe('howick/frama3200')
    // ST950H (250-305mm webs, conservative) can't roll wall studs either
    const r2 = profileFor('stud', { ...DEFAULT_SPEC, lgsMachine: 'framecad/st950h' })
    expect(r2.status).toBe(LGS_FALLBACK_STATUS)
    // …but rolls 1200S162 floor joists
    const r3 = profileFor('joist', {
      ...DEFAULT_SPEC,
      joistSizes: ['2x12'],
      lgsMachine: 'framecad/st950h',
    })
    if (!('designator' in r3)) throw new Error('unexpected')
    expect(r3.status).toBe('verified')
    expect(r3.designator).toBe('1200S162-54') // thinnest the machine rolls ≥ 33
  })

  test('UNVERIFIED or unknown machine: generic dims, the status string SURFACES', () => {
    for (const lgsMachine of ['pinnacle/x1', 'pinnacle/x80i', 'acme/rocket', 'garbage']) {
      const r = profileFor('stud', { ...DEFAULT_SPEC, lgsMachine })
      if (!('designator' in r)) throw new Error('unexpected')
      expect(r.status).toBe(LGS_FALLBACK_STATUS)
      expect(r.status).toContain('unverified') // the exact honesty contract
      expect(r.designator).toBe('550S162-33') // generic substituted
      expect(r.machine).toBe(lgsMachine) // who was asked for is never hidden
    }
  })

  test('roles outside the prescriptive path: engineered design required, no dims invented', () => {
    for (const role of ['girder', 'post', 'ridge', 'hip', 'valley', 'collar-tie'] as const) {
      const r = profileFor(role, DEFAULT_SPEC)
      expect(r.status).toBe('engineered design required')
      if ('designator' in r) continue
      expect(r.note).toContain('engineered design required')
      expect('designator' in r).toBe(false)
    }
  })
})

describe('citation completeness (the data-shape gate)', () => {
  test('every generic family row: non-empty sourceRefs, all resolving in the citations block', () => {
    for (const [d, fam] of Object.entries(LGS.genericFamilies)) {
      expect(fam.sourceRefs.length).toBeGreaterThan(0)
      for (const ref of fam.sourceRefs) {
        expect(LGS.citations[ref]?.url.startsWith('http')).toBe(true)
      }
      expect(parseDesignator(d)).not.toBeNull() // designator keys parse
      expect(fam.mils).toBe(parseDesignator(d)?.mils as number) // suffix == row mils
    }
  })

  test('every machine row: real source URLs or the explicit unverified status — never neither', () => {
    for (const vendor of Object.values(LGS.vendors)) {
      for (const m of Object.values(vendor.machines)) {
        const sourced = m.sourceUrls.length > 0 && m.sourceUrls.every((u) => u.startsWith('http'))
        expect(m.status === 'verified' ? sourced : m.status === LGS.fallbackStatus).toBe(true)
        // DATA-shape leg (skeptic F4): an unverified machine's rollableFamilies
        // must be EMPTY IN THE DATA — the code guard alone would hide a forged
        // capability row without any gate ever seeing it.
        if (m.status !== 'verified') expect(m.rollableFamilies).toEqual([])
      }
    }
  })

  test('CODE-guard leg (skeptic F4): a forged row on an unverified machine still resolves nothing', () => {
    // Complementary to the data gate above: if the data gate ever regressed
    // and an unverified machine DID carry rows, the code must still refuse
    // to expand them — both defenses pinned independently.
    const forged = {
      name: 'Forged Unverified',
      status: LGS_FALLBACK_STATUS,
      sourceUrls: ['https://example.com'],
      rollableFamilies: [
        { family: '350S162', rollableMils: [33], basis: 'derived: forged for the gate' },
        {
          designator: 'FORGE-89C41',
          webMm: 89,
          flangeMm: 41,
          lipMm: 10,
          rollableMils: [33],
          nearestGeneric: '350S162',
          note: 'forged vendor row',
        },
      ],
    }
    expect(rollableDesignators(forged)).toEqual([])
    // …and the full resolution path takes the unverified fallback, never
    // the machine's forged generic OR forged vendor-profile branch.
    const vendors = LGS.vendors as Record<string, (typeof LGS.vendors)[string]>
    vendors.zzforge = { name: 'ZZ Forge', website: 'https://example.com', machines: { fake: forged } }
    try {
      const r = profileFor('stud', { ...DEFAULT_SPEC, lgsMachine: 'zzforge/fake' }, { interior: true })
      if (!('designator' in r)) throw new Error('unexpected')
      expect(r.status).toBe(LGS_FALLBACK_STATUS)
      expect(r.designator).toBe('350S162-33') // generic substituted
      expect(r.machineProfile).toBeUndefined() // forged vendor row never surfaces
    } finally {
      delete vendors.zzforge
    }
  })

  test('every rollable row: family refs resolve + carry their derivation basis; vendor rows carry dims + sources', () => {
    for (const vendor of Object.values(LGS.vendors)) {
      for (const m of Object.values(vendor.machines)) {
        for (const rf of m.rollableFamilies) {
          expect(Boolean(rf.family) !== Boolean(rf.designator)).toBe(true) // exactly one shape
          if (rf.family) {
            expect(familyVariants(rf.family).length).toBeGreaterThan(0)
            expect(rf.basis).toContain('derived') // labeled derivation, honesty rule 3
          } else {
            expect(rf.webMm).toBeGreaterThan(0)
            expect((rf.sourceUrls ?? m.sourceUrls).length).toBeGreaterThan(0)
            if (rf.nearestGeneric) expect(familyVariants(rf.nearestGeneric).length).toBeGreaterThan(0)
            expect(rf.note).toBeTruthy() // the dims-delta note is mandatory
          }
        }
      }
    }
  })

  test('discrepancies record BOTH values with sources (never a silent winner)', () => {
    let seen = 0
    for (const vendor of Object.values(LGS.vendors)) {
      for (const m of Object.values(vendor.machines)) {
        for (const d of m.discrepancies ?? []) {
          seen++
          expect(d.values.length).toBeGreaterThanOrEqual(2)
          for (const v of d.values) {
            expect(v.value.length).toBeGreaterThan(0)
            expect(v.source.length).toBeGreaterThan(0)
            expect(v.date.length).toBeGreaterThan(0)
          }
        }
      }
    }
    expect(seen).toBeGreaterThanOrEqual(4) // ST950H web, ST825iT punches, FRAMA 4200 + X-TENDA thickness
  })

  test('punch patterns + fastener basis + citations are fully sourced', () => {
    for (const p of Object.values(LGS.punchPatterns)) {
      expect(p.sourceRefs.length).toBeGreaterThan(0)
      for (const ref of p.sourceRefs) expect(LGS.citations[ref]?.url.startsWith('http')).toBe(true)
    }
    for (const fb of Object.values(LGS.fastenerBasis)) {
      expect(fb.sourceRefs.length).toBeGreaterThan(0)
      for (const ref of fb.sourceRefs) expect(LGS.citations[ref]?.url.startsWith('http')).toBe(true)
    }
    for (const c of Object.values(LGS.citations)) {
      expect(c.url.startsWith('http')).toBe(true)
      expect(c.verified.length).toBeGreaterThan(0)
      expect(c.fetched).toBe('2026-08-23')
    }
    expect(LGS.fallbackStatus).toContain('unverified')
  })
})

describe("'lgs' walls route FULLY — steel bones, framed-twin sheet goods (F1, Phase 1)", () => {
  const cfgWith = (overrides?: Record<string, WallOverride>) => ({
    ...baselineConfig('INTL'),
    ...(overrides ? { wallOverrides: overrides } : {}),
  })

  test('the predicates split honestly: framesAsLumber = framed only; framedAssembly adds lgs', () => {
    // Phase 1 delivered on the Phase-0 comment's promise: 'lgs' left
    // framesAsLumber in the SAME commit that gave it the steel engine.
    expect(framesAsLumber('framed')).toBe(true)
    expect(framesAsLumber('lgs')).toBe(false)
    expect(framesAsLumber('cmu')).toBe(false)
    expect(framesAsLumber('skip')).toBe(false)
    expect(framedAssembly('framed')).toBe(true)
    expect(framedAssembly('lgs')).toBe(true)
    expect(framedAssembly('cmu')).toBe(false)
    expect(framedAssembly('skip')).toBe(false)
  })

  test("an 'lgs' wall frames in STEEL while areas + layers + fixtures stay byte-equal to the framed twin", () => {
    // The Phase-1 F1 contract: the SKELETON changes material (catalog-
    // designated steel members replace the lumber set for those walls) but
    // the sheet-goods story is untouched — areas, layer members and
    // fixtures byte-equal. Kills the same mutant sites as Phase 0's gate:
    // dropping 'lgs' from the grouping loses the wall's members entirely;
    // dropping it from either areas site loses sheathing/drywall m² (the
    // silent under-buy class).
    const base = computeLevel(baselineScene(), cfgWith())
    const lgs = computeLevel(baselineScene(), cfgWith({ w_s: 'lgs', w_mid: 'lgs' }))
    expect(base.members.length).toBeGreaterThan(50) // the walls really frame
    expect(lgs.areas).toEqual(base.areas) // sheathing + drywall both booked
    // steel bones exist for BOTH overridden walls, labeled from the catalog
    for (const id of ['w_s', 'w_mid']) {
      const steel = lgs.members.filter((m) => m.sourceId === id && m.profile !== undefined)
      expect(steel.length).toBeGreaterThan(10)
      for (const m of steel) expect(m.material).toBe('steel')
      // no lumber skeleton remains on the steel wall
      expect(
        lgs.members.some(
          (m) => m.sourceId === id && m.material === 'lumber' && m.role === 'stud',
        ),
      ).toBe(false)
    }
    // layer members (sheathing/drywall/WRB/cladding) byte-equal — the sheet
    // goods hang on steel bones exactly as they did on lumber
    const layerRoles = new Set(['drywall', 'sheathing', 'wrb', 'cladding'])
    const layers = (r: { members: { role: string }[] }) =>
      r.members.filter((m) => layerRoles.has(m.role))
    expect(JSON.stringify(layers(lgs))).toBe(JSON.stringify(layers(base)))
    expect(JSON.stringify(lgs.fixtures)).toBe(JSON.stringify(base.fixtures))
    // warnings grow by the LGS honesty channels; the ONLY legitimate drops
    // are R602.10 braced-wall LINE warnings (steel walls leave the wood
    // bracing method's lines exactly like CMU does — their R603.9 shear
    // story is its own LGS warning)
    for (const w of base.warnings) {
      if (w.includes('braced wall line')) continue
      expect(lgs.warnings).toContain(w)
    }
    expect(lgs.warnings.some((w) => w.includes('R603.9'))).toBe(true)
  })

  test('the wall card tells the STEEL truth: designator + stated basis, engineering populated', () => {
    const nodes = baselineScene()
    const select = { levelId: 'level_1', selectedIds: ['w_s'] }
    const framedCfg = cfgWith({ w_s: 'framed' })
    const lgsCfg = cfgWith({ w_s: 'lgs' })
    const framedInfo = selectedWallInfo(nodes, select, framedCfg, computeLevel(nodes, framedCfg))
    const info = selectedWallInfo(nodes, select, lgsCfg, computeLevel(nodes, lgsCfg))
    if (!info || !framedInfo) throw new Error('missing wall info')
    expect(info.construction).toBe('lgs')
    expect(info.assembly).toContain('Steel (LGS)')
    // the printed profile is the one the engine built (ONE resolver:
    // lgsWallProfiles feeds both the card and the members)
    expect(info.assembly).toContain('550S162-68')
    expect(info.assembly).toContain('(Gr 50)')
    expect(info.assembly).toContain('@ 16" o.c.')
    // stated basis — the R603.3.2 mil table cells are unverified
    expect(info.assembly).toContain('conservative: R603.3.2 table cell unverified')
    expect(info.assembly).not.toContain('framed as lumber')
    expect(info.assembly).not.toContain('Skipped')
    // engineering block stays populated (the recipe drives the steel
    // family + spacing; insulation/cladding ride the same layer stack)
    expect(info.engineering).not.toBeNull()
    expect(info.engineering).toEqual(framedInfo.engineering)
    // TRUTH pin, not an equality pin (round-1 F2 — the old
    // insulation-equality assertion PINNED the wood-frame IECC claim onto
    // steel walls): the steel card keeps the framed twin's R/zone CONTENT
    // and adds the steel-frame qualifier — R402.2.6 is the steel wall's
    // own requirement and it is stated as NOT evaluated.
    expect(framedInfo.insulation).not.toBeNull()
    expect(info.insulation).toContain(String(framedInfo.insulation))
    expect(info.insulation).toContain('wood-frame prescriptive')
    expect(info.insulation).toContain('R402.2.6')
    expect(info.insulation).toContain('not evaluated')
    // …and the framed twin never carries the steel qualifier
    expect(framedInfo.insulation).not.toContain('R402.2.6')
  })

  test("Phase 2 — the machine suffix tells the REAL constraint state: '· machine <key>' + the honest fallback count, no IOU", () => {
    const nodes = baselineScene()
    // The card's count == the distinct fallback CLASSES actually drawn on
    // the wall (round-1 skeptic F2: the old stud+track-only count printed
    // '1' on a wall whose drawn steel carried fallback labels in TWO
    // classes). Derived here from the members themselves so the gate
    // can't drift from the 3D.
    const CLASS_OF: Record<string, string> = {
      stud: 'stud', 'king-stud': 'stud', trimmer: 'stud', cripple: 'stud', header: 'stud',
      'bottom-plate': 'track', 'top-plate': 'track', sill: 'track',
      backing: 'bridging',
    }
    const drawnFallbackClasses = (
      result: ReturnType<typeof computeLevel>,
      wallId: string,
    ): Set<string> =>
      new Set(
        result.members
          .filter(
            (m) =>
              m.sourceId === wallId &&
              m.material === 'steel' &&
              (m.label ?? '').includes(LGS_FALLBACK_STATUS) &&
              CLASS_OF[m.role] !== undefined,
          )
          .map((m) => CLASS_OF[m.role] as string),
      )
    const cardOn = (wallId: string, lgsMachine?: string) => {
      const cfg = {
        ...cfgWith({ [wallId]: 'lgs' }),
        ...(lgsMachine !== undefined ? { lgsMachine } : {}),
      }
      const result = computeLevel(nodes, cfg)
      const info = selectedWallInfo(nodes, { levelId: 'level_1', selectedIds: [wallId] }, cfg, result)
      if (!info) throw new Error('missing wall info')
      return { info, result }
    }
    // THE EXHIBIT (pins 2): TF550H rolls the 550S162-68 studs; T125 track
    // AND the wall's 3 drawn bridging channels both fall back
    const two = cardOn('w_s', 'framecad/tf550h')
    expect(drawnFallbackClasses(two.result, 'w_s').size).toBe(2) // non-vacuous
    expect(two.info.assembly).toContain('· machine framecad/tf550h (2 profiles fall back)')
    expect(two.info.assembly).not.toContain('constraint warnings land in Phase 2')
    // a wall with NO drawn bridging (w_mid carries no backing tees):
    // track only → 1 — the bridging class never pads a wall it isn't on
    const one = cardOn('w_mid', 'framecad/tf550h')
    expect(one.result.members.some((m) => m.sourceId === 'w_mid' && m.role === 'backing')).toBe(false)
    expect(drawnFallbackClasses(one.result, 'w_mid').size).toBe(1)
    expect(one.info.assembly).toContain('(1 profile falls back)')
    // F325iT (33/43 mil only) rolls nothing composed here → all 3 classes
    const three = cardOn('w_s', 'framecad/f325it')
    expect(drawnFallbackClasses(three.result, 'w_s').size).toBe(3)
    expect(three.info.assembly).toContain('· machine framecad/f325it (3 profiles fall back)')
    // count == drawn classes on every scenario above (the F2 invariant)
    for (const { info, result } of [two, one, three]) {
      const m = /\((\d) profiles? falls? back\)/.exec(info.assembly)
      expect(Number(m?.[1])).toBe(drawnFallbackClasses(result, info.wallId).size)
    }
    // no machine → no machine suffix at all (byte-stable card line)
    const none = cardOn('w_s')
    expect(none.info.assembly).not.toContain('· machine')
    expect(none.info.assembly).not.toContain('falls back')
  })
})

describe('schema round-trip (framingSystem absent == lumber, byte-parity)', () => {
  test('a node without the fields round-trips WITHOUT them (no default injection)', () => {
    const node = FramingNode.parse({})
    expect('framingSystem' in node).toBe(false)
    expect('lgsMachine' in node).toBe(false)
    // and the parse output is byte-identical whether or not the keys exist upstream
    const again = FramingNode.parse(JSON.parse(JSON.stringify(node)))
    expect(JSON.stringify(again)).toBe(JSON.stringify(node))
  })

  test('the fields persist when set, and reject garbage', () => {
    const node = FramingNode.parse({ framingSystem: 'lgs', lgsMachine: 'framecad/f325it' })
    expect(node.framingSystem).toBe('lgs')
    expect(node.lgsMachine).toBe('framecad/f325it')
    expect(() => FramingNode.parse({ framingSystem: 'timber' })).toThrow()
  })

  test("DEFAULT_SPEC carries NO framingSystem key — the E5 spec bytes can't move", () => {
    expect('framingSystem' in DEFAULT_SPEC).toBe(false)
    expect('lgsMachine' in DEFAULT_SPEC).toBe(false)
  })

  test("per-wall channel: 'lgs' rides the CMU override union, cmuHeightM stays CMU-only", () => {
    expect(WallOverride.parse('lgs')).toBe('lgs')
    expect(WallOverride.parse({ construction: 'lgs' })).toEqual({ construction: 'lgs' })
    expect(() => WallOverride.parse({ construction: 'lgs', cmuHeightM: 1.2 })).toThrow()
    expect(WallOverride.parse('cmu')).toBe('cmu') // the legacy strings persist untouched
  })
})
