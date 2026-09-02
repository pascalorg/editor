import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_SPEC,
  HEADER_RULES_SNOW30,
  HEADER_RULES_SNOW50,
  HEADER_RULES_SNOW70,
  HEADER_TERMINAL_SPAN_SNOW50,
  HEADER_TERMINAL_SPAN_SNOW70,
  RAFTER_SPANS_SNOW20,
  RAFTER_SPANS_SNOW50,
  headerFor,
  tableSpanFor,
} from '../core/spec'
import { inches, feet } from '../core/units'
import { applyJurisdiction, INTL_PROFILE, jurisdictionOptions, profileFor } from './profiles'

describe('profileFor', () => {
  test('INTL and AUTO fall back to the generic profile', () => {
    expect(profileFor('INTL')).toBe(INTL_PROFILE)
    expect(profileFor('AUTO')).toBe(INTL_PROFILE)
  })

  test('unknown code degrades gracefully', () => {
    const p = profileFor('ZZ')
    expect(p.code).toBe('ZZ')
    expect(p.exteriorWallDefault).toBe('framed')
  })

  test('Florida defaults exterior walls to CMU; others stay framed', () => {
    expect(profileFor('FL').exteriorWallDefault).toBe('cmu')
    expect(profileFor('NY').exteriorWallDefault).toBe('framed')
    expect(profileFor('CA').exteriorWallDefault).toBe('framed')
  })

  test('adoption dataset feeds the residential code label', () => {
    // NY moved to the 2024-IRC-based 2025 RCNYS (researched 2026-08).
    expect(profileFor('NY').residentialCode).toContain('2025')
  })
})

describe('jurisdictionOptions', () => {
  test('offers INTL first, then every researched state', () => {
    const options = jurisdictionOptions()
    expect(options[0]?.code).toBe('INTL')
    expect(options.length).toBeGreaterThanOrEqual(52) // INTL + 50 states + DC
    expect(options.some((o) => o.code === 'CA')).toBe(true)
  })
})

describe('applyJurisdiction', () => {
  test('footings never get shallower than 12 inches', () => {
    const spec = applyJurisdiction(DEFAULT_SPEC, { ...INTL_PROFILE, frostLineIn: 6 })
    expect(spec.footingDepth).toBeCloseTo(inches(12), 5)
  })

  test('deep frost drives deep footings', () => {
    const spec = applyJurisdiction(DEFAULT_SPEC, { ...INTL_PROFILE, frostLineIn: 60 })
    expect(spec.footingDepth).toBeCloseTo(inches(60), 5)
  })

  test('seismic hold-downs tighten anchor spacing to 4 ft', () => {
    const spec = applyJurisdiction(DEFAULT_SPEC, { ...INTL_PROFILE, seismicHoldDowns: true })
    expect(spec.seismicHoldDowns).toBe(true)
    expect(spec.anchorBoltSpacing).toBeCloseTo(feet(4), 5)
  })

  test('high wind adds hurricane ties', () => {
    const spec = applyJurisdiction(DEFAULT_SPEC, { ...INTL_PROFILE, ultimateWindMph: 150 })
    expect(spec.hurricaneTies).toBe(true)
  })

  test('heavy snow bumps rafter stock', () => {
    const at50 = applyJurisdiction(DEFAULT_SPEC, { ...INTL_PROFILE, groundSnowLoadPsf: 50 })
    const at70 = applyJurisdiction(DEFAULT_SPEC, { ...INTL_PROFILE, groundSnowLoadPsf: 70 })
    expect(at50.rafterSize).toBe('2x8')
    expect(at70.rafterSize).toBe('2x10')
  })

  test('snow band swaps the rafter SPAN TABLE together with the stock size (B2)', () => {
    const at30 = applyJurisdiction(DEFAULT_SPEC, { ...INTL_PROFILE, groundSnowLoadPsf: 30 })
    expect(at30.rafterSpans).toBe(RAFTER_SPANS_SNOW20)
    const at50 = applyJurisdiction(DEFAULT_SPEC, { ...INTL_PROFILE, groundSnowLoadPsf: 50 })
    expect(at50.rafterSpans).toBe(RAFTER_SPANS_SNOW50)
    // numeric plumb-through at the sized stock: 2x8 @ 24" = 10-1 → 10.0 ft
    // (R802.4.1(5)) vs 14-10 → 14.8 ft in the low-snow band
    expect(tableSpanFor(at50.rafterSpans, at50.rafterSize, at50.rafterSpacing)).toBeCloseTo(
      feet(10.0),
      6,
    )
    expect(tableSpanFor(at30.rafterSpans, '2x8', at30.rafterSpacing)).toBeCloseTo(feet(14.8), 6)
    // real state profiles land in the right band: VT researches at 60 psf,
    // TX at 5 — the ceiling-joist table is snow-independent
    expect(applyJurisdiction(DEFAULT_SPEC, profileFor('VT')).rafterSpans).toBe(RAFTER_SPANS_SNOW50)
    expect(applyJurisdiction(DEFAULT_SPEC, profileFor('TX')).rafterSpans).toBe(RAFTER_SPANS_SNOW20)
    expect(applyJurisdiction(DEFAULT_SPEC, profileFor('VT')).ceilingJoistSpans).toBe(
      DEFAULT_SPEC.ceilingJoistSpans,
    )
  })

  test('pure — never mutates the input spec', () => {
    const before = { ...DEFAULT_SPEC }
    applyJurisdiction(DEFAULT_SPEC, { ...INTL_PROFILE, frostLineIn: 60 })
    expect(DEFAULT_SPEC).toEqual(before)
  })

  // ---- LOD-400 B11: header rules by snow load — Table R602.7(1) ----

  test('snow band swaps the HEADER RULES; the band snaps UP to the governing column (B11)', () => {
    // ≤ 30 psf: the 30-psf column IS the shipped default — reference
    // identity, so low-snow jurisdictions stay byte-equal to master.
    const at30 = applyJurisdiction(DEFAULT_SPEC, { ...INTL_PROFILE, groundSnowLoadPsf: 30 })
    expect(at30.headerRules).toBe(DEFAULT_SPEC.headerRules)
    expect(at30.headerRules).toBe(HEADER_RULES_SNOW30)
    expect(at30.headerAssumption).toBeUndefined()
    // a column may not serve loads above it — 40 psf reads the 50 column,
    // 60 psf the 70 column (snap UP, never the unconservative neighbor)
    const at40 = applyJurisdiction(DEFAULT_SPEC, { ...INTL_PROFILE, groundSnowLoadPsf: 40 })
    expect(at40.headerRules).toBe(HEADER_RULES_SNOW50)
    const at50 = applyJurisdiction(DEFAULT_SPEC, { ...INTL_PROFILE, groundSnowLoadPsf: 50 })
    expect(at50.headerRules).toBe(HEADER_RULES_SNOW50)
    const at60 = applyJurisdiction(DEFAULT_SPEC, { ...INTL_PROFILE, groundSnowLoadPsf: 60 })
    expect(at60.headerRules).toBe(HEADER_RULES_SNOW70)
    // real state profiles: VT researches at 60 psf → 70 column; MN at 50 →
    // 50 column; NY at 40 → 50 column; TX at 5 stays the low-snow default
    expect(applyJurisdiction(DEFAULT_SPEC, profileFor('VT')).headerRules).toBe(HEADER_RULES_SNOW70)
    expect(applyJurisdiction(DEFAULT_SPEC, profileFor('MN')).headerRules).toBe(HEADER_RULES_SNOW50)
    expect(applyJurisdiction(DEFAULT_SPEC, profileFor('NY')).headerRules).toBe(HEADER_RULES_SNOW50)
    expect(applyJurisdiction(DEFAULT_SPEC, profileFor('TX')).headerRules).toBe(
      DEFAULT_SPEC.headerRules,
    )
    expect(applyJurisdiction(DEFAULT_SPEC, profileFor('TX')).headerAssumption).toBeUndefined()
  })

  test('B11: band thresholds encode the tabulated 24-ft-width spans, clamped to the default', () => {
    // 50-psf column @ 24 ft (2-ply rows): 2-2x8 = 5-0 (60"), 2-2x10 = 5-11
    // (71"); 70-psf: 2-2x8 = 4-5 (53"), 2-2x10 = 5-3 (63"). The 4x4/4x6
    // steps clamp at the default's 24"/36" (tabulated 31"/47" and 28"/42"
    // are LOOSER than the shipped rounding — heavier snow must never print
    // a shallower header than the low-snow band).
    const spansIn = (rules: typeof HEADER_RULES_SNOW50): number[] =>
      rules.filter((r) => Number.isFinite(r.maxSpan)).map((r) => r.maxSpan / inches(1))
    expect(spansIn(HEADER_RULES_SNOW50).map((v) => Math.round(v * 10) / 10)).toEqual([
      24, 36, 60, 71,
    ])
    expect(spansIn(HEADER_RULES_SNOW70).map((v) => Math.round(v * 10) / 10)).toEqual([
      24, 36, 53, 63,
    ])
    // sizes ladder unchanged; terminal rule stays the open-ended 4x12
    for (const rules of [HEADER_RULES_SNOW50, HEADER_RULES_SNOW70]) {
      expect(rules.map((r) => r.size)).toEqual(['4x4', '4x6', '4x8', '4x10', '4x12'])
      expect(Number.isFinite(rules[rules.length - 1]?.maxSpan)).toBe(false)
    }
    // headerFor plumb-through at the moved thresholds (boundary inclusive)
    const vt = applyJurisdiction(DEFAULT_SPEC, profileFor('VT'))
    expect(headerFor(vt, inches(53))).toBe('4x8')
    expect(headerFor(vt, inches(56))).toBe('4x10')
    expect(headerFor(DEFAULT_SPEC, inches(56))).toBe('4x8')
    expect(headerFor(vt, inches(66))).toBe('4x12')
    expect(headerFor(DEFAULT_SPEC, inches(66))).toBe('4x10')
    const mn = applyJurisdiction(DEFAULT_SPEC, profileFor('MN'))
    expect(headerFor(mn, inches(56))).toBe('4x8') // 50-band 4x8 cap = 60"
    expect(headerFor(mn, inches(80))).toBe('4x12') // past the 71" 4x10 cap
    expect(headerFor(DEFAULT_SPEC, inches(80))).toBe('4x10')
  })

  test('B11: the heavy-snow bands carry the building-width assumption; sites past 70 psf confess', () => {
    const vt = applyJurisdiction(DEFAULT_SPEC, profileFor('VT'))
    expect(vt.headerAssumption).toContain('Table R602.7(1)')
    expect(vt.headerAssumption).toContain('70 psf ground snow')
    expect(vt.headerAssumption).toContain('≤ 24 ft building width')
    expect(vt.headerAssumption).toContain('assumed')
    const mn = applyJurisdiction(DEFAULT_SPEC, profileFor('MN'))
    expect(mn.headerAssumption).toContain('50 psf ground snow')
    // beyond the deepest column the table stops being prescriptive
    const at90 = applyJurisdiction(DEFAULT_SPEC, { ...INTL_PROFILE, groundSnowLoadPsf: 90 })
    expect(at90.headerRules).toBe(HEADER_RULES_SNOW70)
    expect(at90.headerAssumption).toContain('exceeds')
    expect(at90.headerAssumption).toContain('engineered')
  })

  test('B11 round 2 (skeptic): the band CAPS engineeredHeaderSpan at its 2-2x12 cell — the 4x12 rule never claims the table past its domain', () => {
    // 70-psf column ends at 6-2 (74"); 50-psf at 6-11 (83") — reference
    // identity with the exported terminal constants, derived from the same
    // encoded cells as the rules
    const vt = applyJurisdiction(DEFAULT_SPEC, profileFor('VT'))
    expect(vt.engineeredHeaderSpan).toBe(HEADER_TERMINAL_SPAN_SNOW70 as number)
    expect(vt.engineeredHeaderSpan).toBeCloseTo(inches(74), 9)
    const mn = applyJurisdiction(DEFAULT_SPEC, profileFor('MN'))
    expect(mn.engineeredHeaderSpan).toBe(HEADER_TERMINAL_SPAN_SNOW50 as number)
    expect(mn.engineeredHeaderSpan).toBeCloseTo(inches(83), 9)
    // the cap only ever LOWERS the threshold (min with the shipped 10 ft)
    expect(vt.engineeredHeaderSpan).toBeLessThan(DEFAULT_SPEC.engineeredHeaderSpan)
    expect(mn.engineeredHeaderSpan).toBeLessThan(DEFAULT_SPEC.engineeredHeaderSpan)
    // low-snow keeps the shipped 10 ft untouched — its labels make no
    // table claim (pre-existing terminal gap, out of B11 scope) and
    // low-snow output must stay byte-equal
    expect(applyJurisdiction(DEFAULT_SPEC, profileFor('INTL')).engineeredHeaderSpan).toBe(
      DEFAULT_SPEC.engineeredHeaderSpan,
    )
    expect(applyJurisdiction(DEFAULT_SPEC, profileFor('TX')).engineeredHeaderSpan).toBe(
      DEFAULT_SPEC.engineeredHeaderSpan,
    )
  })

  test('B11: 51-state sweep — every jurisdiction lands in exactly ONE band; the deepened set is enumerated', () => {
    // THE EXPECTED-DIFF MANIFEST (docs/plans/B11-EXPECTED-DIFF.md): only
    // these states' header rules move off the shipped default — everything
    // else is required byte-equal. Researched ground snow: 35–40 psf +
    // AK/MN at 50 → 50-psf column; ME/NH/VT at 60 → 70-psf column.
    // CANADA (docs/plans/CANADA-EXPECTED-DIFF.md): the CA-* rows carry NBC
    // Ss-derived ground snow (kPa → psf) and join the bands the same
    // data-driven way — BC/GEN/MB/SK/YT land in 30–50; the snowier
    // provinces land past 50 (CA-NL at 73 psf rides the 70-psf column with
    // the 'exceeds the table — engineered design required' assumption).
    const DEEPENED_50 = [
      'AK',
      'CA-BC',
      'CA-GEN',
      'CA-MB',
      'CA-SK',
      'CA-YT',
      'ID',
      'MA',
      'MN',
      'MT',
      'ND',
      'NY',
      'SD',
      'UT',
      'WI',
      'WY',
    ]
    const DEEPENED_70 = [
      'CA-NB',
      'CA-NL',
      'CA-NS',
      'CA-NT',
      'CA-NU',
      'CA-ON-E',
      'CA-ON-N',
      'CA-PE',
      'CA-QC',
      'ME',
      'NH',
      'VT',
    ]
    const band50: string[] = []
    const band70: string[] = []
    for (const { code } of jurisdictionOptions()) {
      const spec = applyJurisdiction(DEFAULT_SPEC, profileFor(code))
      const bands = [HEADER_RULES_SNOW30, HEADER_RULES_SNOW50, HEADER_RULES_SNOW70].filter(
        (b) => spec.headerRules === b,
      )
      expect(bands, code).toHaveLength(1) // exactly one band, no throws
      if (spec.headerRules === HEADER_RULES_SNOW50) band50.push(code)
      if (spec.headerRules === HEADER_RULES_SNOW70) band70.push(code)
      // the assumption label rides the deepened bands and ONLY them
      expect(spec.headerAssumption !== undefined, code).toBe(
        spec.headerRules !== HEADER_RULES_SNOW30,
      )
    }
    expect(band50.sort()).toEqual(DEEPENED_50)
    expect(band70.sort()).toEqual(DEEPENED_70)
  })
})
