import { describe, expect, it } from 'bun:test'
import adoptionData from '../../data/jurisdictions-adoption.json'
import climateData from '../../data/jurisdictions-climate.json'
import { DEFAULT_SPEC, HEADER_RULES_SNOW70 } from '../core/spec'
import { INCH } from '../core/units'
import { baselineConfig, baselineScene } from '../framing/baseline-scene'
import { computeLevel } from '../framing/compute'
import { guessJurisdiction, TZ_GUESS_TABLE } from './guess'
import { applyJurisdiction, jurisdictionOptions, nonIrcCodeWarning, profileFor } from './profiles'

/**
 * Canada rides the same data path as the US states: two JSON rows merged by
 * `profileFor`, then mapped onto the FramingSpec by `applyJurisdiction`. These
 * tests pin the parts that would silently regress — a missing data row
 * degrades to the INTL fallback rather than throwing, so "it still renders"
 * is not evidence that a province actually landed.
 */

const CANADA = [
  'CA-ON-S',
  'CA-ON-E',
  'CA-ON-N',
  'CA-BC',
  'CA-AB',
  'CA-SK',
  'CA-MB',
  'CA-QC',
  'CA-NB',
  'CA-NS',
  'CA-PE',
  'CA-NL',
  'CA-YT',
  'CA-NT',
  'CA-NU',
  'CA-GEN',
] as const

const footingInches = (code: string): number =>
  applyJurisdiction(DEFAULT_SPEC, profileFor(code)).footingDepth / INCH

describe('Canadian jurisdictions', () => {
  it('every province resolves to real data, not the INTL fallback', () => {
    for (const code of CANADA) {
      const p = profileFor(code)
      // The fallback returns `{...INTL_PROFILE, code, name: code}` — so a name
      // equal to the bare code means the data row is missing.
      expect(p.name).not.toBe(code)
      expect(p.name.startsWith('Canada')).toBe(true)
      expect(p.residentialCode).not.toBe('IRC (edition unverified)')
    }
  })

  it('cites the National Building Code, not the IRC', () => {
    expect(profileFor('CA-SK').residentialCode).toContain('National Building Code')
    expect(profileFor('CA-ON-S').residentialCode).toContain('Ontario Building Code')
    expect(profileFor('CA-QC').residentialCode).toContain('2015')
  })

  it('no Canadian code collides with a US state code', () => {
    const codes = jurisdictionOptions().map((o) => o.code)
    expect(new Set(codes).size).toBe(codes.length)
    // The obvious trap: bare 'CA' is California and must stay California.
    expect(profileFor('CA').name).toBe('California')
  })

  it('southern Ontario frames like the GTA: shallow-ish frost, no ties, 2x6 rafters', () => {
    const spec = applyJurisdiction(DEFAULT_SPEC, profileFor('CA-ON-S'))
    expect(footingInches('CA-ON-S')).toBeCloseTo(47, 5)
    expect(spec.hurricaneTies).toBe(false)
    expect(spec.seismicHoldDowns).toBe(false)
    expect(spec.rafterSize).toBe(DEFAULT_SPEC.rafterSize)
  })

  it('the Ottawa Valley digs deeper and bumps the rafter for snow', () => {
    const spec = applyJurisdiction(DEFAULT_SPEC, profileFor('CA-ON-E'))
    expect(footingInches('CA-ON-E')).toBeCloseTo(71, 5)
    expect(spec.rafterSize).toBe('2x8')
  })

  it('prairie frost depths exceed every US state', () => {
    // The reason Canada needed real rows instead of a US proxy: the deepest
    // US frost line in the data is 60in, and Saskatchewan runs deeper.
    expect(footingInches('CA-SK')).toBeCloseTo(83, 5)
    expect(footingInches('CA-MB')).toBeCloseTo(78, 5)
    expect(footingInches('CA-SK')).toBeGreaterThan(footingInches('ND'))
  })

  it('coastal BC turns on seismic hold-downs and tightens anchor bolts', () => {
    const spec = applyJurisdiction(DEFAULT_SPEC, profileFor('CA-BC'))
    expect(spec.seismicHoldDowns).toBe(true)
    expect(spec.anchorBoltSpacing).toBeCloseTo(4 * 12 * INCH, 5)
  })

  it('Atlantic Canada gets uplift ties, the interior does not', () => {
    expect(applyJurisdiction(DEFAULT_SPEC, profileFor('CA-NS')).hurricaneTies).toBe(true)
    expect(applyJurisdiction(DEFAULT_SPEC, profileFor('CA-NL')).hurricaneTies).toBe(true)
    expect(applyJurisdiction(DEFAULT_SPEC, profileFor('CA-SK')).hurricaneTies).toBe(false)
  })

  it('exterior walls stay framed everywhere in Canada', () => {
    for (const code of CANADA) {
      expect(profileFor(code).exteriorWallDefault).toBe('framed')
    }
  })

  it('permafrost territories carry an explicit warning in their notes', () => {
    for (const code of ['CA-YT', 'CA-NT', 'CA-NU']) {
      expect(profileFor(code).notes.join(' ')).toContain('PERMAFROST')
    }
  })

  it('the dropdown still leads with INTL and now carries Canada', () => {
    const options = jurisdictionOptions()
    expect(options[0]?.code).toBe('INTL')
    expect(options.filter((o) => o.code.startsWith('CA-')).length).toBe(CANADA.length)
  })

  it('the CA-* codes group as ONE contiguous dropdown block, right after California', () => {
    // The ISO-style 'CA-' prefix is the grouping mechanism: the options
    // sort by code, so every Canadian entry must land in one unbroken run
    // ('CA-' < 'CO' in ASCII) — a stray code spelling would scatter it.
    const codes = jurisdictionOptions().map((o) => o.code)
    const first = codes.findIndex((c) => c.startsWith('CA-'))
    const last = codes.length - 1 - [...codes].reverse().findIndex((c) => c.startsWith('CA-'))
    expect(first).toBeGreaterThan(0)
    expect(last - first + 1).toBe(CANADA.length)
    for (let i = first; i <= last; i++) expect(codes[i]?.startsWith('CA-')).toBe(true)
    expect(codes[first - 1]).toBe('CA') // California immediately precedes the block
  })
})

// ---------------------------------------------------------------------------
// Citation completeness — the CA data gate (the LGS citation-gate style):
// every Canadian row must carry its code source, its unit-conversion
// documentation, and the not-site-specific caveat. A row is data, and data
// without its citation is a wish.
// ---------------------------------------------------------------------------

type CaAdoptionRow = {
  /** IRC edition year for adopting states; null for non-IRC codes (WI, CA-*). */
  ircBase: number | null
  residentialCode: string
  note?: string
}
type CaClimateRow = {
  frostLineIn: number
  frostLineNote: string
  groundSnowLoadPsf: number
  snowNote: string
  caveat?: string
}

const adoptionRows = (adoptionData as { states: Record<string, CaAdoptionRow> }).states
const climateRows = (climateData as { states: Record<string, CaClimateRow> }).states
const CA_CODES = Object.keys(adoptionRows).filter((c) => c.startsWith('CA-'))

const KPA_TO_PSF = 20.885
const MM_PER_IN = 25.4
/** First figure of a (possibly ranged) `<n>[-<m>] <unit>` mention. */
const firstFigure = (text: string, unit: string): number | null => {
  const m = new RegExp(`(\\d+(?:\\.\\d+)?)(?:\\s*[-–]\\s*\\d+(?:\\.\\d+)?)?\\s*${unit}`).exec(text)
  return m ? Number(m[1]) : null
}
/** Every figure adjacent to a `<unit>` mention, range ends included. */
const allFigures = (text: string, unit: string): number[] =>
  [...text.matchAll(new RegExp(`(\\d+(?:\\.\\d+)?)(?:\\s*[-–]\\s*(\\d+(?:\\.\\d+)?))?\\s*${unit}`, 'g'))]
    .flatMap((m) => [Number(m[1]), ...(m[2] ? [Number(m[2])] : [])])

describe('citation completeness — the CA data gate', () => {
  it('there are exactly 16 CA rows, present in BOTH data files', () => {
    expect(CA_CODES.sort()).toEqual([...CANADA].sort())
    for (const code of CA_CODES) expect(climateRows[code], code).toBeDefined()
  })

  it('every CA adoption row: ircBase null + an NBC-based code + the verbatim inference-engine note', () => {
    for (const code of CA_CODES) {
      const row = adoptionRows[code] as CaAdoptionRow
      // Canada is NOT an IRC jurisdiction (the Wisconsin-UDC precedent) —
      // and the note tells inference engines so, verbatim, including the
      // NBC 9.23.13 bracing difference (noted, deliberately NOT implemented).
      expect(row.ircBase, code).toBeNull()
      expect(/NBC|National Building Code/.test(row.residentialCode), code).toBe(true)
      expect(row.note ?? '', code).toContain('NOT an IRC adoption')
      expect(row.note ?? '', code).toContain('NBC Division B Part 9')
      expect(row.note ?? '', code).toContain(
        'NBC 9.23.13 selects lateral bracing from Sa(0.2) and hourly wind pressure',
      )
    }
  })

  it("Quebec carries its one-cycle-behind flag: NBC 2015 base, on the row AND in the note", () => {
    const qc = adoptionRows['CA-QC'] as CaAdoptionRow
    expect(qc.residentialCode).toContain('NBC 2015')
    expect(qc.note).toContain('NBC 2015')
    expect(qc.note).toContain('not NBC 2020')
  })

  it('every CA climate row carries the typical-not-site-specific caveat with its NBC source', () => {
    for (const code of CA_CODES) {
      const caveat = (climateRows[code] as CaClimateRow).caveat ?? ''
      expect(caveat, code).toContain('Canadian entry')
      expect(caveat, code).toContain('typical provincial values')
      expect(caveat, code).toContain('NBC 2020 Division B Appendix C')
      expect(caveat, code).toContain('authority having jurisdiction')
    }
  })

  it('the data-file disclaimer states the CA conversion factors (kPa→psf 20.885, 25.4 mm/in)', () => {
    const disclaimer = (climateData as { disclaimer: string }).disclaimer
    expect(disclaimer).toContain('20.885')
    expect(disclaimer).toContain('25.4 mm')
  })

  it('per-row snow conversion is documented AND arithmetically honest (kPa → psf at 20.885)', () => {
    for (const code of CA_CODES) {
      const row = climateRows[code] as CaClimateRow
      // Canadian codes state ground snow as Ss in kPa — every row documents
      // the source unit…
      expect(row.snowNote, code).toContain('kPa')
      const kpa = firstFigure(row.snowNote, 'kPa')
      const psf = firstFigure(row.snowNote, 'psf')
      if (psf !== null) {
        // …and the printed psf pair reproduces the stated factor (±0.75
        // absorbs the note's integer rounding, nothing more).
        expect(Math.abs((kpa as number) * KPA_TO_PSF - psf), code).toBeLessThanOrEqual(0.75)
        // the row's schema value lives inside the documented range
        const figures = allFigures(row.snowNote, 'psf')
        expect(row.groundSnowLoadPsf, code).toBeGreaterThanOrEqual(Math.min(...figures) - 1)
        expect(row.groundSnowLoadPsf, code).toBeLessThanOrEqual(Math.max(...figures) + 1)
      } else {
        // the only pair-less row is the national placeholder — and it says so
        expect(code).toBe('CA-GEN')
        expect(row.snowNote).toContain('placeholder')
      }
    }
  })

  it('per-row frost conversion is documented (mm, with honest inches where paired) or PERMAFROST-flagged', () => {
    for (const code of CA_CODES) {
      const row = climateRows[code] as CaClimateRow
      const note = row.frostLineNote
      // Permafrost territories replace the spread-footing figure with the
      // explicit warning — a meaningless depth must never read as sited data.
      if (note.includes('PERMAFROST')) continue
      expect(note, code).toContain('mm')
      const mm = firstFigure(note, 'mm')
      const inch = firstFigure(note, 'in')
      if (inch !== null) {
        expect(Math.abs((mm as number) / MM_PER_IN - inch), code).toBeLessThanOrEqual(1)
        const inches = allFigures(note, 'in')
        expect(row.frostLineIn, code).toBeGreaterThanOrEqual(Math.min(...inches) - 1)
        expect(row.frostLineIn, code).toBeLessThanOrEqual(Math.max(...inches) + 1)
      }
    }
    // the PERMAFROST escape hatch is exactly the three territories — a
    // province may never use it to dodge the conversion documentation
    const flagged = CA_CODES.filter((c) =>
      (climateRows[c] as CaClimateRow).frostLineNote.includes('PERMAFROST'),
    )
    expect(flagged.sort()).toEqual(['CA-NT', 'CA-NU', 'CA-YT'])
  })
})

// ---------------------------------------------------------------------------
// ircBase:null honesty — the seam the CA rows expose. NOTHING in the engines
// keys IRC citations on the adoption row's `ircBase` (swept 2026-08-24:
// zero src/ consumers existed): member labels, flags and prescriptive checks
// cite IRC/IECC/NEC sections unconditionally. On a jurisdiction whose
// researched code is NOT an IRC adoption (WI's UDC — the precedent row —
// VT's no-statewide-code row, and all 16 CA-* rows) that silence implied
// local law. The honest, gated
// answer is the compute-level confession below; the panel warnings drawer
// and the paper P4 flag block both print level warnings, so one channel
// serves all three surfaces. Per-label suppression/re-citation is the real
// fix and stays board-tracked (blast radius: every engine).
// ---------------------------------------------------------------------------

describe('ircBase:null honesty — non-IRC jurisdictions confess their generic-IRC machinery', () => {
  const NON_IRC = /^non-IRC jurisdiction/

  it('every CA jurisdiction computes with exactly ONE non-IRC confession naming its code', () => {
    for (const code of ['CA-GEN', 'CA-SK', 'CA-QC'] as const) {
      const result = computeLevel(baselineScene(), baselineConfig(code))
      const hits = result.warnings.filter((w) => NON_IRC.test(w))
      expect(hits, code).toHaveLength(1)
      expect(hits[0], code).toContain(profileFor(code).name)
      expect(hits[0], code).toContain(profileFor(code).residentialCode)
      expect(hits[0], code).toContain('generic practice')
    }
  })

  it('Wisconsin (the UDC precedent row) carries the same confession — the gap was never CA-only', () => {
    const result = computeLevel(baselineScene(), baselineConfig('WI'))
    expect(result.warnings.filter((w) => NON_IRC.test(w))).toHaveLength(1)
  })

  it("Vermont (ircBase:null since its row landed — 'No statewide residential building code') confesses with the local-requirements tail", () => {
    // Round-1 skeptic F2: VT was the unenumerated 18th member — its row
    // DESCRIBES the absence of a statewide code, so 'verify against the
    // governing code: No statewide…' read incoherently. Absence-rows point
    // at local/municipal requirements instead.
    const result = computeLevel(baselineScene(), baselineConfig('VT'))
    const hits = result.warnings.filter((w) => NON_IRC.test(w))
    expect(hits).toHaveLength(1)
    expect(hits[0]).toContain(
      'verify against local/municipal requirements: No statewide residential building code',
    )
    expect(hits[0]).not.toContain('governing code: No')
    // the special tail is the ABSENCE class only — WI and the CA rows keep
    // the governing-code tail (their strings are examiner-verified on paper)
    expect(nonIrcCodeWarning(profileFor('WI'))).toContain('verify against the governing code:')
    expect(nonIrcCodeWarning(profileFor('CA-GEN'))).toContain(
      'verify against the governing code:',
    )
  })

  it('the confession set is EXACTLY the ircBase:null rows: 16 CA + WI + VT — enumerated', () => {
    const confessing = jurisdictionOptions()
      .map((o) => o.code)
      .filter((code) => nonIrcCodeWarning(profileFor(code)) !== null)
    expect(confessing.sort()).toEqual([...CANADA, 'VT', 'WI'].sort())
  })

  it('IRC adopters and INTL never confess: no warning on TX, CA (California), INTL', () => {
    for (const code of ['TX', 'CA', 'INTL'] as const) {
      const result = computeLevel(baselineScene(), baselineConfig(code))
      expect(result.warnings.filter((w) => NON_IRC.test(w)), code).toEqual([])
      expect(nonIrcCodeWarning(profileFor(code)), code).toBeNull()
    }
  })

  it('LOD 200 makes no code claims — the confession stays out with the rest of them', () => {
    const config = { ...baselineConfig('CA-GEN'), detail: '200' as const }
    const result = computeLevel(baselineScene(), config)
    expect(result.warnings.filter((w) => NON_IRC.test(w))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Canadian compose — the E5-class end-to-end gate: the PR's motivating case
// (prairie frost deeper than any US state) must reach composed GEOMETRY,
// not just the spec; snow rides the documented kPa→psf conversion into the
// header/rafter machinery; the seismic field is exercised on the Ontario
// split that exists because of it.
// ---------------------------------------------------------------------------

describe('Canadian compose — frost, snow and seismic reach the composed level', () => {
  it('CA-SK digs its footings to 83 in — deeper than EVERY US jurisdiction — in real members', () => {
    const result = computeLevel(baselineScene(), baselineConfig('CA-SK'))
    expect(result.spec.footingDepth).toBeCloseTo(83 * INCH, 9)
    // the composed foundation actually reaches frost depth: the deepest
    // foundation member bottom sits exactly at −footingDepth
    const foundation = result.members.filter((m) => m.system === 'foundation')
    expect(foundation.length).toBeGreaterThan(0)
    const minY = Math.min(...foundation.map((m) => m.position[1] - m.dims[1] / 2))
    expect(minY).toBeCloseTo(-result.spec.footingDepth, 9)
    // …and no US state (nor INTL) digs that deep — the reason a US proxy
    // under-dug Canadian footings by a foot or more
    for (const { code } of jurisdictionOptions()) {
      if (code.startsWith('CA-')) continue
      const spec = applyJurisdiction(DEFAULT_SPEC, profileFor(code))
      expect(spec.footingDepth, code).toBeLessThan(result.spec.footingDepth)
    }
  })

  it('CA-ON-E rides its kPa-converted 52 psf into the deepened snow machinery', () => {
    const result = computeLevel(baselineScene(), baselineConfig('CA-ON-E'))
    expect(profileFor('CA-ON-E').groundSnowLoadPsf).toBe(52)
    expect(result.spec.rafterSize).toBe('2x8') // ≥50 psf bump
    // 52 psf snaps UP to the 70-psf header column, assumption stated
    expect(result.spec.headerRules).toBe(HEADER_RULES_SNOW70)
    expect(result.spec.headerAssumption).toContain('70 psf ground snow')
  })

  it('tz + locale guessing: Canadian zones land on provinces, en-CA on CA-GEN, and every mapped code is real', () => {
    // Every zone→code mapping must resolve to a researched data row — a
    // typo'd 'CA-XX' would silently fall to the INTL-clone fallback.
    for (const [tz, code] of Object.entries(TZ_GUESS_TABLE)) {
      expect(profileFor(code).name, `${tz} → ${code}`).not.toBe(code)
      expect(guessJurisdiction({ tz }).code, tz).toBe(code)
    }
    // provincial spot pins (the split-Ontario mapping included)
    expect(guessJurisdiction({ tz: 'America/Winnipeg' }).code).toBe('CA-MB')
    expect(guessJurisdiction({ tz: 'America/Vancouver' }).code).toBe('CA-BC')
    expect(guessJurisdiction({ tz: 'America/Thunder_Bay' }).code).toBe('CA-ON-N')
    // the DOCUMENTED caveat: tzdata folds Montreal into America/Toronto, so
    // Quebec browsers guess southern Ontario — the dropdown always wins.
    expect(guessJurisdiction({ tz: 'America/Toronto' }).code).toBe('CA-ON-S')
    // …but a LEGACY environment still reporting America/Montreal names
    // Montreal — the zone picks the region it names (Quebec directly)
    expect(guessJurisdiction({ tz: 'America/Montreal' }).code).toBe('CA-QC')
    // locale fallbacks: an unknown-province Canadian locale reaches the
    // NBC-2020 generic row, never INTL; the US/other paths are untouched
    expect(guessJurisdiction({ tz: 'Europe/Paris', lang: 'en-CA' }).code).toBe('CA-GEN')
    expect(guessJurisdiction({ tz: 'Europe/Paris', lang: 'fr-CA' }).code).toBe('CA-GEN')
    expect(guessJurisdiction({ tz: 'Europe/Berlin', lang: 'en-US' }).code).toBe('TX')
    expect(guessJurisdiction({ tz: 'Europe/Paris', lang: 'fr-FR' }).code).toBe('INTL')
  })

  it('the seismic field is live on the Ontario split: ON-E carries SDC C — noted, below the hold-down line', () => {
    // Ontario is split S/E/N partly on seismic spread: the Ottawa Valley
    // (CA-ON-E) is Canada's second-highest hazard zone but sits at SDC C —
    // BELOW the D threshold that builds hold-down hardware. The field must
    // be real data (not a fallback 'B') and must NOT trip the SDC-D kit.
    const onE = profileFor('CA-ON-E')
    expect(onE.seismicSdc).toBe('C')
    const spec = applyJurisdiction(DEFAULT_SPEC, onE)
    expect(spec.seismicHoldDowns).toBe(false)
    expect(spec.anchorBoltSpacing).toBeCloseTo(6 * 12 * INCH, 9)
    // the contrast pair: BC's D-class DOES trip it (pinned above) — the
    // field drives the split, not the CA- prefix
    expect(profileFor('CA-BC').seismicSdc).toBe('D')
  })
})
