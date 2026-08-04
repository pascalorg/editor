import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_MEASUREMENT_STANDARD_ID,
  MEASUREMENT_STANDARDS,
  measurementStandard,
  openingBandIndex,
  openingBandLabel,
} from './standards'
import type { MeasurementStandardId } from './types'

const ALL_IDS: MeasurementStandardId[] = ['IS_1200_5', 'NRM2', 'HKSMM4', 'CESMM4', 'POMI']

describe('the shipped rule sets', () => {
  it('carries every standard the plan calls for, each with a clause reference', () => {
    for (const id of ALL_IDS) {
      const standard = measurementStandard(id)
      expect(standard.id).toBe(id)
      expect(standard.sourceRef.length).toBeGreaterThan(0)
    }
    expect(Object.keys(MEASUREMENT_STANDARDS).sort()).toEqual([...ALL_IDS].sort())
  })

  it('flags the two standards whose clause text was never obtained', () => {
    const unverified = ALL_IDS.filter((id) => measurementStandard(id).verification === 'unverified')
    expect(unverified.sort()).toEqual(['CESMM4', 'POMI'])
  })

  it('defaults to a verified standard', () => {
    expect(measurementStandard(DEFAULT_MEASUREMENT_STANDARD_ID).verification).toBe('verified')
  })
})

describe('opening thresholds differ by standard', () => {
  it('IS 1200 ignores openings up to 0.4 m²', () => {
    expect(measurementStandard('IS_1200_5').openings).toEqual({
      kind: 'deduct-above-area',
      thresholdSqM: 0.4,
    })
  })

  it('HKSMM4 ignores openings up to 1.00 m²', () => {
    expect(measurementStandard('HKSMM4').openings).toEqual({
      kind: 'deduct-above-area',
      thresholdSqM: 1,
    })
  })

  it('NRM2 never deducts — openings are enumerated extra over', () => {
    const nrm2 = measurementStandard('NRM2')
    expect(nrm2.openings.kind).toBe('extra-over-count')
    // 11.24 excludes the ends and soffits an opening creates, so measuring the
    // reveals again would bill the same plywood twice.
    expect(nrm2.revealsMeasured).toBe(false)
  })
})

describe('the band rules', () => {
  // `WidthBandRule.roles` is `string[]` because `FaceRole` lives a layer up, so
  // a typo in a role name would silently switch the rule off. This is the guard.
  const FACE_ROLES = new Set<string>([
    'side-a',
    'side-b',
    'end-start',
    'end-end',
    'top',
    'bottom',
    'column-face-1',
    'column-face-2',
    'column-face-3',
    'column-face-4',
    'shaft',
    'soffit',
    'edge',
  ])

  it('names only real face roles', () => {
    for (const id of ALL_IDS) {
      for (const role of measurementStandard(id).narrowWidth?.roles ?? []) {
        expect(FACE_ROLES.has(role)).toBe(true)
      }
    }
  })

  it('gives every band rule a clause reference of its own', () => {
    for (const id of ALL_IDS) {
      const standard = measurementStandard(id)
      for (const rule of [standard.narrowWidth, standard.soffitStages]) {
        if (rule) expect(rule.sourceRef.length).toBeGreaterThan(0)
      }
    }
  })

  it('switches wall sides to linear metres only where HKSMM4 says so', () => {
    // §4.1 item 7: "wall-side formwork ≤ 300 mm wide is measured by the metre in
    // 100 mm stages". NRM2 item 24 reaches ends and steps at 500 mm, not sides.
    expect(measurementStandard('HKSMM4').narrowWidth).toEqual({
      roles: ['side-a', 'side-b', 'end-start', 'end-end', 'edge'],
      thresholdM: 0.3,
      stageM: 0.1,
      sourceRef: expect.any(String),
    })
    const nrm2 = measurementStandard('NRM2').narrowWidth
    expect(nrm2?.thresholdM).toBe(0.5)
    expect(nrm2?.stageM).toBeUndefined()
    expect(nrm2?.roles).not.toContain('side-a')
  })

  it('stages a soffit only under HKSMM4, and by both thickness and prop height', () => {
    const staged = ALL_IDS.filter((id) => measurementStandard(id).soffitStages !== undefined)
    expect(staged).toEqual(['HKSMM4'])
    const stages = measurementStandard('HKSMM4').soffitStages
    expect(stages?.thicknessBaseM).toBe(0.2)
    expect(stages?.thicknessStepM).toBe(0.1)
    expect(stages?.heightBaseM).toBe(3.5)
    expect(stages?.heightStepM).toBe(1.5)
  })

  it('bands a sloping top only under NRM2, at its 15° boundary', () => {
    const banded = ALL_IDS.filter((id) => measurementStandard(id).slopingTopBandDeg !== undefined)
    expect(banded).toEqual(['NRM2'])
    expect(measurementStandard('NRM2').slopingTopBandDeg).toBe(15)
  })
})

describe('NRM2 nr bands', () => {
  const bands = [5, 10]

  it('places an opening in the band its area falls in', () => {
    expect(openingBandIndex(1.8, bands)).toBe(0)
    expect(openingBandIndex(5, bands)).toBe(0)
    expect(openingBandIndex(7.5, bands)).toBe(1)
    expect(openingBandIndex(12, bands)).toBe(2)
  })

  it('labels each band the way the rules table reads', () => {
    expect(openingBandLabel(1.8, bands)).toBe('≤ 5.00 m²')
    expect(openingBandLabel(7.5, bands)).toBe('5.00–10.00 m²')
    expect(openingBandLabel(12, bands)).toBe('> 10.00 m²')
  })
})
