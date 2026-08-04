import { describe, expect, it } from 'bun:test'
import { bandFace, faceMeasurementLabel, stageAt, statedWidth } from './banding'
import { measurementStandard } from './standards'
import type { MeasurementStandard } from './types'

/**
 * Banding is where geometry becomes a bill, so the tests are written as the
 * clauses read: a nib is a run not an area, a 200 mm slab is in the base
 * thickness stage and a 250 mm one is not, and the same face bands differently
 * under HKSMM4 and NRM2 because the two standards say different things.
 */

const HKSMM4 = measurementStandard('HKSMM4')
const NRM2 = measurementStandard('NRM2')
const IS_1200_5 = measurementStandard('IS_1200_5')

function band(
  standard: MeasurementStandard,
  role: string,
  extentsM: [number, number],
  overrides: Record<string, unknown> = {},
) {
  return bandFace({
    role,
    standard,
    measuredAreaSqM: extentsM[0] * extentsM[1],
    extentsM,
    surfaceClass: 'vertical',
    ...overrides,
  })
}

describe('stage arithmetic', () => {
  it('puts a value on a band boundary in the lower band, not the one above', () => {
    // 200 mm is the top of HKSMM4's base thickness stage. Floating-point drift
    // on 0.2/0.1 would push it up one and bill the wrong item.
    expect(stageAt(0.2, 0.2, 0.1, 'mm').index).toBe(0)
    expect(stageAt(0.3, 0.2, 0.1, 'mm').index).toBe(1)
    expect(stageAt(3.5, 3.5, 1.5, 'm').index).toBe(0)
    expect(stageAt(5, 3.5, 1.5, 'm').index).toBe(1)
  })

  it('labels the base band as a ceiling and the rest as a range', () => {
    expect(stageAt(0.15, 0.2, 0.1, 'mm').label).toBe('≤ 200 mm')
    expect(stageAt(0.25, 0.2, 0.1, 'mm').label).toBe('200 mm–300 mm')
    expect(stageAt(2, 3.5, 1.5, 'm').label).toBe('≤ 3.50 m')
    expect(stageAt(4.2, 3.5, 1.5, 'm').label).toBe('3.50 m–5.00 m')
  })

  it('counts every step, however many bands up', () => {
    const stage = stageAt(9.1, 3.5, 1.5, 'm')
    expect(stage.index).toBe(4)
    expect(stage.lowerM).toBeCloseTo(8, 9)
    expect(stage.upperM).toBeCloseTo(9.5, 9)
  })
})

describe('the stated width', () => {
  it('rounds up to the clause stage where the clause stages it', () => {
    const rule = HKSMM4.narrowWidth
    if (!rule) throw new Error('HKSMM4 states a narrow-width rule')
    expect(statedWidth(0.13, rule)).toBeCloseTo(0.2, 9)
    expect(statedWidth(0.2, rule)).toBeCloseTo(0.2, 9)
    expect(statedWidth(0.21, rule)).toBeCloseTo(0.3, 9)
  })

  it('states the width as measured where the clause only asks for it stated', () => {
    const rule = NRM2.narrowWidth
    if (!rule) throw new Error('NRM2 states a narrow-width rule')
    expect(statedWidth(0.34, rule)).toBeCloseTo(0.34, 9)
  })
})

describe('the narrow-width switch', () => {
  it('bills a nib by the metre of its run, not by area', () => {
    // A 150 mm return, 3 m tall. HKSMM4 reaches wall sides, so this is 3 m of
    // 200 mm-stage formwork rather than 0.45 m².
    const measurement = band(HKSMM4, 'side-a', [0.15, 3])
    expect(measurement.unit).toBe('m')
    expect(measurement.quantity).toBeCloseTo(3, 9)
    expect(measurement.widthM).toBeCloseTo(0.15, 9)
    expect(measurement.statedWidthM).toBeCloseTo(0.2, 9)
  })

  it('leaves an ordinary wall face in m²', () => {
    const measurement = band(HKSMM4, 'side-a', [6, 3])
    expect(measurement.unit).toBe('m2')
    expect(measurement.quantity).toBeCloseTo(18, 9)
    expect(measurement.statedWidthM).toBeUndefined()
  })

  it('holds the 300 mm boundary in the wide band', () => {
    expect(band(HKSMM4, 'side-a', [0.3, 3]).unit).toBe('m')
    expect(band(HKSMM4, 'side-a', [0.301, 3]).unit).toBe('m2')
  })

  it('reaches only the roles its clause names', () => {
    // NRM2 item 24 is about wall ends and steps, so a thin wall's *side* face is
    // still m² however narrow the wall — a different answer from HKSMM4 on the
    // same geometry, which is the whole reason the rule is data.
    expect(band(NRM2, 'side-a', [0.4, 3]).unit).toBe('m2')
    expect(band(NRM2, 'end-start', [0.4, 3]).unit).toBe('m')
    expect(band(HKSMM4, 'side-a', [0.25, 3]).unit).toBe('m')
  })

  it('applies each standard’s own threshold', () => {
    // 400 mm is over HKSMM4's 300 and under NRM2's 500.
    expect(band(HKSMM4, 'end-start', [0.4, 3]).unit).toBe('m2')
    expect(band(NRM2, 'end-start', [0.4, 3]).unit).toBe('m')
  })

  it('never switches unit for a standard that has no width rule', () => {
    expect(IS_1200_5.narrowWidth).toBeUndefined()
    expect(band(IS_1200_5, 'side-a', [0.1, 3]).unit).toBe('m2')
  })

  it('measures the run over the full length, undiscounted by trim', () => {
    // `measuredAreaSqM` arrives already reduced; the run must not inherit that,
    // because no standard deducts at an intersection.
    const measurement = bandFace({
      role: 'side-a',
      standard: HKSMM4,
      measuredAreaSqM: 0.3,
      extentsM: [0.2, 4],
      surfaceClass: 'vertical',
    })
    expect(measurement.quantity).toBeCloseTo(4, 9)
  })
})

describe('soffit stages', () => {
  function soffit(standard: MeasurementStandard, thicknessM: number, heightM?: number) {
    return bandFace({
      role: 'soffit',
      standard,
      measuredAreaSqM: 24,
      surfaceClass: 'horizontal',
      thicknessM,
      soffitHeightAboveSupportM: heightM,
    })
  }

  it('bands thickness and prop height independently', () => {
    const measurement = soffit(HKSMM4, 0.35, 4.2)
    expect(measurement.thicknessStage?.label).toBe('300 mm–400 mm')
    expect(measurement.heightStage?.label).toBe('3.50 m–5.00 m')
    expect(measurement.unit).toBe('m2')
    expect(measurement.quantity).toBeCloseTo(24, 9)
  })

  it('puts a thin slab at a normal storey height in both base stages', () => {
    const measurement = soffit(HKSMM4, 0.15, 2.7)
    expect(measurement.thicknessStage?.index).toBe(0)
    expect(measurement.heightStage?.index).toBe(0)
  })

  it('omits the height stage when nobody has stated the prop height', () => {
    // A guessed prop length is worse than a gap: it would bill falsework nobody
    // priced. The thickness stage still applies — that one is always known.
    const measurement = soffit(HKSMM4, 0.25)
    expect(measurement.thicknessStage?.index).toBe(1)
    expect(measurement.heightStage).toBeUndefined()
  })

  it('leaves a soffit unstaged under a standard that does not stage it', () => {
    expect(NRM2.soffitStages).toBeUndefined()
    const measurement = soffit(NRM2, 0.35, 4.2)
    expect(measurement.thicknessStage).toBeUndefined()
    expect(measurement.heightStage).toBeUndefined()
  })

  it('does not stage a face that is not a soffit', () => {
    const measurement = bandFace({
      role: 'top',
      standard: HKSMM4,
      measuredAreaSqM: 24,
      surfaceClass: 'horizontal',
      thicknessM: 0.35,
      soffitHeightAboveSupportM: 4.2,
    })
    expect(measurement.thicknessStage).toBeUndefined()
    expect(measurement.heightStage).toBeUndefined()
  })
})

describe('the sloping-top band', () => {
  function top(standard: MeasurementStandard, slopeDeg: number) {
    return bandFace({
      role: 'top',
      standard,
      measuredAreaSqM: 3,
      surfaceClass: slopeDeg > 0 ? 'sloping' : 'horizontal',
      slopeDeg,
    })
  }

  it('splits at the standard’s boundary, not at the form-it-or-not angle', () => {
    // NRM2 item 28 bands at 15°, while `DEFAULT_TOP_FORM_ANGLE_THRESHOLD_DEG` is
    // 10° and answers a different question — whether the concrete would run.
    // A 12° top is therefore formed *and* in the ≤ 15° band.
    expect(top(NRM2, 12).slopeBand).toEqual({ boundaryDeg: 15, over: false })
    expect(top(NRM2, 15).slopeBand).toEqual({ boundaryDeg: 15, over: false })
    expect(top(NRM2, 20).slopeBand).toEqual({ boundaryDeg: 15, over: true })
  })

  it('leaves a level top unbanded', () => {
    expect(top(NRM2, 0).slopeBand).toBeUndefined()
  })

  it('omits the band for a standard that does not split by slope', () => {
    expect(HKSMM4.slopingTopBandDeg).toBeUndefined()
    expect(top(HKSMM4, 20).slopeBand).toBeUndefined()
  })
})

describe('the audit trail', () => {
  it('carries the standard plus every band clause, without repeating one', () => {
    const nib = band(HKSMM4, 'side-a', [0.15, 3])
    expect(nib.sourceRefs).toEqual([HKSMM4.sourceRef, HKSMM4.narrowWidth?.sourceRef ?? ''])

    const soffit = bandFace({
      role: 'soffit',
      standard: HKSMM4,
      measuredAreaSqM: 24,
      surfaceClass: 'horizontal',
      thicknessM: 0.35,
      soffitHeightAboveSupportM: 4.2,
    })
    expect(soffit.sourceRefs).toEqual([HKSMM4.sourceRef, HKSMM4.soffitStages?.sourceRef ?? ''])
  })

  it('names the standard alone when no band clause applies', () => {
    expect(band(HKSMM4, 'side-a', [6, 3]).sourceRefs).toEqual([HKSMM4.sourceRef])
  })
})

describe('the readable label', () => {
  it('reads as a run with its stated width for a nib', () => {
    expect(faceMeasurementLabel(band(HKSMM4, 'side-a', [0.15, 3]))).toBe(
      '3.00 m run · width 200 mm',
    )
  })

  it('reads as an area with its stages for a soffit', () => {
    const measurement = bandFace({
      role: 'soffit',
      standard: HKSMM4,
      measuredAreaSqM: 24,
      surfaceClass: 'horizontal',
      thicknessM: 0.35,
      soffitHeightAboveSupportM: 4.2,
    })
    expect(faceMeasurementLabel(measurement)).toBe(
      '24.00 m² · thickness 300 mm–400 mm · height 3.50 m–5.00 m',
    )
  })
})
