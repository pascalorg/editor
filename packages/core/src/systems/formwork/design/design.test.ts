import { describe, expect, it } from 'bun:test'
import {
  beamLengthForSpanMm,
  DOKA_FRAMAX_XLIFE,
  EUREX_20,
  EUREX_30,
  FILM_FACED_PLY_18MM,
  H20_BEAM,
  PERI_TRIO,
  PLYFORM_CLASS_I_19MM,
  PLYFORM_STRUCTURAL_I_19MM,
  propCapacityKn,
} from '../catalog'
import { pressureAtDepth, pressureEnvelope } from '../pressure'
import {
  adoptSpan,
  allowableSpan,
  DEFLECTION_ARCHITECTURAL,
  DEFLECTION_LUMBER,
  DEFLECTION_STRUCTURAL,
  solveSpan,
  spanCoefficients,
  spanCountForRun,
  utilisation,
} from './beam'
import { falseworkDesign } from './falsework'
import {
  MIN_COMBINED_CARTS_KPA,
  MIN_COMBINED_KPA,
  MIN_LIVE_LOAD_KPA,
  verticalLoad,
} from './vertical-load'
import {
  braceDesign,
  MAX_TIE_SPACING_M,
  MAX_WALER_SPACING_M,
  MIN_BRACE_LINE_LOAD_KN_M,
  MIN_STUDS_BETWEEN_TIES_FOR_UNIFORM_LOAD,
  MIN_WIND_PRESSURE_KPA,
  type WallDesignOptions,
  wallDesign,
} from './wall'

/** psf → kPa, for checking against APA's published tables. */
const PSF = 0.0478803

describe('continuous-beam coefficients', () => {
  it('two spans is stiffer than three but takes more shear', () => {
    const two = spanCoefficients(2)
    const three = spanCoefficients(3)
    expect(two.deflection).toBeGreaterThan(three.deflection)
    expect(two.shear).toBeGreaterThan(three.shear)
    // And weaker in bending — wL²/8 against wL²/10.
    expect(two.moment).toBeGreaterThan(three.moment)
  })

  it('a single span is the simply-supported case', () => {
    const one = spanCoefficients(1)
    expect(one.moment).toBeCloseTo(1 / 8, 6)
    expect(one.shear).toBeCloseTo(0.5, 6)
    // 5wL⁴/384EI as a divisor.
    expect(one.deflection).toBeCloseTo(384 / 5, 6)
  })
})

describe('APA Example 2 — 3/4in Plyform Class I, grain across supports at 16in', () => {
  // The published answer: bending 412 psf, shear 714 psf, deflection 370 psf
  // governing. Reproducing all three is what says the metric conversion of the
  // section properties and the coefficient table are both right.
  const spanM = 16 * 0.0254
  const member = {
    momentKnM: PLYFORM_CLASS_I_19MM.acrossSupports.momentKnMPerM,
    shearKn: PLYFORM_CLASS_I_19MM.acrossSupports.shearKnPerM,
    eiKnM2: PLYFORM_CLASS_I_19MM.acrossSupports.eiKnM2PerM,
  }

  it('bending allows about 412 psf', () => {
    // p = 10·M_R/L² at three spans, inverted from the span solver.
    const pressureKpa = (10 * member.momentKnM) / spanM ** 2
    expect(pressureKpa / PSF).toBeGreaterThan(390)
    expect(pressureKpa / PSF).toBeLessThan(435)
  })

  it('shear allows far more than bending, so it never governs here', () => {
    const pressureKpa = member.shearKn / (0.6 * spanM)
    expect(pressureKpa / PSF).toBeGreaterThan(600)
    expect(pressureKpa / PSF).toBeGreaterThan((10 * member.momentKnM) / spanM ** 2 / PSF)
  })

  it('deflection governs, below the bending figure', () => {
    // l/360, three spans: Δ = pL⁴/(145·EI) ≤ L/360.
    const pressureKpa = (145 * member.eiKnM2) / (360 * spanM ** 3)
    const bendingKpa = (10 * member.momentKnM) / spanM ** 2
    expect(pressureKpa).toBeLessThan(bendingKpa)
    expect(pressureKpa / PSF).toBeGreaterThan(340)
    expect(pressureKpa / PSF).toBeLessThan(400)
  })

  it('the solver picks deflection as the governing check at this pressure', () => {
    const solved = allowableSpan(370 * PSF, member, { ratio: 360 }, 3)
    expect(solved.governedBy).toBe('deflection')
    expect(solved.spanM).toBeCloseTo(spanM, 1)
  })
})

describe('orientation is a design input, not a detail', () => {
  it('grain parallel to supports loses about half the stiffness', () => {
    const across = PLYFORM_CLASS_I_19MM.acrossSupports
    const parallel = PLYFORM_CLASS_I_19MM.parallelToSupports
    expect(parallel.eiKnM2PerM / across.eiKnM2PerM).toBeCloseTo(0.462, 2)
    expect(parallel.momentKnMPerM).toBeLessThan(across.momentKnMPerM)
  })

  it('and that costs real span', () => {
    const load = 40
    const strong = allowableSpan(
      load,
      {
        momentKnM: PLYFORM_CLASS_I_19MM.acrossSupports.momentKnMPerM,
        shearKn: PLYFORM_CLASS_I_19MM.acrossSupports.shearKnPerM,
        eiKnM2: PLYFORM_CLASS_I_19MM.acrossSupports.eiKnM2PerM,
      },
      DEFLECTION_LUMBER,
      3,
    )
    const weak = allowableSpan(
      load,
      {
        momentKnM: PLYFORM_CLASS_I_19MM.parallelToSupports.momentKnMPerM,
        shearKn: PLYFORM_CLASS_I_19MM.parallelToSupports.shearKnPerM,
        eiKnM2: PLYFORM_CLASS_I_19MM.parallelToSupports.eiKnM2PerM,
      },
      DEFLECTION_LUMBER,
      3,
    )
    expect(weak.spanM).toBeLessThan(strong.spanM)
  })
})

describe('Structural I against Class I', () => {
  it('gains on shear only — 102 psi rolling shear against 72', () => {
    expect(PLYFORM_STRUCTURAL_I_19MM.acrossSupports.shearKnPerM).toBeGreaterThan(
      PLYFORM_CLASS_I_19MM.acrossSupports.shearKnPerM,
    )
    // Same Fb, so bending is within a couple of percent (KS differs slightly).
    const ratio =
      PLYFORM_STRUCTURAL_I_19MM.acrossSupports.momentKnMPerM /
      PLYFORM_CLASS_I_19MM.acrossSupports.momentKnMPerM
    expect(ratio).toBeGreaterThan(0.98)
    expect(ratio).toBeLessThan(1.05)
  })
})

describe('deflection limits', () => {
  it('the architectural absolute cap bites on a long span', () => {
    const member = { momentKnM: 100, shearKn: 100, eiKnM2: 1000 }
    const architectural = allowableSpan(5, member, DEFLECTION_ARCHITECTURAL, 3)
    const ratioOnly = allowableSpan(5, member, { ratio: 360 }, 3)
    expect(architectural.spanM).toBeLessThan(ratioOnly.spanM)
    expect(architectural.governedBy).toBe('deflection')
  })

  it('l/270 allows more span than l/360', () => {
    const member = { momentKnM: 5, shearKn: 11, eiKnM2: 450 }
    const loose = allowableSpan(10, member, DEFLECTION_STRUCTURAL, 3)
    const tight = allowableSpan(10, member, { ratio: 360 }, 3)
    expect(loose.spanM).toBeGreaterThanOrEqual(tight.spanM)
  })
})

describe('span count resolution', () => {
  it('a run shorter than two spans is a single span', () => {
    expect(spanCountForRun(1.5, 1.0)).toBe(1)
    expect(spanCountForRun(2.0, 1.0)).toBe(2)
    expect(spanCountForRun(3.5, 1.0)).toBe(3)
    expect(spanCountForRun(10, 1.0)).toBe(3)
  })

  it('solveSpan does not assume three spans on a short run', () => {
    // A stiff member on a 2 m run: three-span coefficients would allow more span
    // than the run holds, so the count has to fall back.
    const member = { momentKnM: 5, shearKn: 11, eiKnM2: 450 }
    const solved = solveSpan(4, member, DEFLECTION_LUMBER, 2)
    expect(solved.spans).toBeLessThan(3)
  })

  it('and is never wider than the three-span assumption in bending', () => {
    const member = { momentKnM: 5, shearKn: 11, eiKnM2: 450 }
    const one = allowableSpan(20, member, DEFLECTION_LUMBER, 1)
    const three = allowableSpan(20, member, DEFLECTION_LUMBER, 3)
    expect(one.bendingM).toBeLessThan(three.bendingM)
  })
})

describe('H20 beam against the design.md worked spans', () => {
  // design.md §2.3: bending L ≤ √(50/w), shear L ≤ 18.33/w at three spans.
  it('reproduces the bending span at 10 kN/m', () => {
    const solved = allowableSpan(10, H20_BEAM, DEFLECTION_LUMBER, 3)
    expect(solved.bendingM).toBeCloseTo(Math.sqrt(50 / 10), 3)
  })

  it('reproduces the shear span at 10 kN/m', () => {
    const solved = allowableSpan(10, H20_BEAM, DEFLECTION_LUMBER, 3)
    expect(solved.shearM).toBeCloseTo(18.333 / 10, 2)
  })

  it('carries permissible values, not the conflicting design ones', () => {
    expect(H20_BEAM.capacityBasis).toBe('permissible')
    expect(H20_BEAM.momentKnM).toBe(5)
    expect(H20_BEAM.shearKn).toBe(11)
  })

  it('records both published capacities with both sources, designing on the conservative one (4.7)', () => {
    // The conflict is a fact about the entry, not a transcription slip: another source
    // publishes 11 kNm / 24 kN on a design basis, and taking those against a working
    // load over-spans a deck by about two. The entry designs on the permissible pair
    // and carries the other pair with its own basis and its own document, so a reader
    // of the conservative answer can see what was not taken and why.
    expect(H20_BEAM.conflict).toBeDefined()
    expect(H20_BEAM.conflict?.momentKnM).toBe(11)
    expect(H20_BEAM.conflict?.shearKn).toBe(24)
    expect(H20_BEAM.conflict?.capacityBasis).toBe('design')
    expect(H20_BEAM.conflict?.source.length).toBeGreaterThan(0)
    // The conservative pair is strictly the smaller one in both axes.
    expect(H20_BEAM.momentKnM).toBeLessThan(H20_BEAM.conflict?.momentKnM as number)
    expect(H20_BEAM.shearKn).toBeLessThan(H20_BEAM.conflict?.shearKn as number)
  })
})

describe('beam stock lengths', () => {
  it('picks the shortest length that reaches, on a non-uniform series', () => {
    expect(beamLengthForSpanMm(H20_BEAM, 2.5)).toBe(2650)
    expect(beamLengthForSpanMm(H20_BEAM, 2.65)).toBe(2650)
    expect(beamLengthForSpanMm(H20_BEAM, 2.7)).toBe(2900)
  })

  it('returns undefined past the longest, rather than a rounded-up figure', () => {
    expect(beamLengthForSpanMm(H20_BEAM, 7)).toBeUndefined()
  })
})

describe('prop capacity is a lookup, not a curve', () => {
  it('reads the tabulated row at an exact length', () => {
    expect(propCapacityKn(EUREX_30, 3.0, 'bottom')).toBe(30.9)
    expect(propCapacityKn(EUREX_30, 3.0, 'top')).toBe(34.8)
  })

  it('flipping the prop changes the capacity', () => {
    const bottom = propCapacityKn(EUREX_30, 2.5, 'bottom') as number
    const top = propCapacityKn(EUREX_30, 2.5, 'top') as number
    expect(top).toBeGreaterThan(bottom)
    expect(top / bottom).toBeCloseTo(37.0 / 30.9, 3)
  })

  it('rounds up to the next row rather than interpolating', () => {
    // 3.2 m is checked against 3.5 m, because capacity falls with extension.
    expect(propCapacityKn(EUREX_30, 3.2, 'top')).toBe(34.2)
  })

  it('does not invent capacity in the dip', () => {
    // The series rises 32.7 → 41.2 between 4.5 and 5.0 m. A prop at 4.6 m must not
    // be credited with anything above the 5.0 m row it is checked against, and
    // certainly not with an interpolated value above 4.5's.
    const at46 = propCapacityKn(EUREX_30, 4.6, 'bottom') as number
    expect(at46).toBe(41.2)
    expect(propCapacityKn(EUREX_30, 4.5, 'bottom')).toBe(32.7)
  })

  it('returns undefined past the prop reach', () => {
    expect(propCapacityKn(EUREX_30, 6.0)).toBeUndefined()
  })

  it('falls back to the lower of the pair where one orientation is unpublished', () => {
    // The 1.5 m row publishes `top` only.
    expect(propCapacityKn(EUREX_30, 1.5, 'bottom')).toBe(41.2)
  })

  it('the lighter prop is genuinely lighter in capacity', () => {
    const twenty = propCapacityKn(EUREX_20, 3.0, 'bottom') as number
    const thirty = propCapacityKn(EUREX_30, 3.0, 'bottom') as number
    expect(twenty).toBeLessThan(thirty)
  })
})

describe('vertical load — the code minimum is the point', () => {
  it('a thin topping is lifted to ACI 4.8 kPa', () => {
    // 50 mm on permanent deck: 0.05 × 26.5 + 0.5 + 2.4 = 4.2 kPa, below the floor.
    // The combined floor only reaches this far down, which is why it is easy to
    // miss and why the pours it catches are the ones nobody calculates.
    const load = verticalLoad({ slabThicknessM: 0.05 })
    expect(load.calculatedKpa).toBeLessThan(MIN_COMBINED_KPA)
    expect(load.totalKpa).toBe(MIN_COMBINED_KPA)
    expect(load.governedBy).toBe('code-minimum')
  })

  it('an ordinary slab is not — the combined floor is not a design load', () => {
    // 100 mm already computes past 4.8, so quoting the floor here would *under*-load
    // the deck. The floor is a minimum, not a substitute for the arithmetic.
    const load = verticalLoad({ slabThicknessM: 0.1 })
    expect(load.calculatedKpa).toBeGreaterThan(MIN_COMBINED_KPA)
    expect(load.governedBy).toBe('calculated')
  })

  it('a thick slab governs on its own weight', () => {
    const load = verticalLoad({ slabThicknessM: 0.3 })
    expect(load.governedBy).toBe('calculated')
    expect(load.totalKpa).toBeGreaterThan(MIN_COMBINED_KPA)
  })

  it('the live load floor applies when nothing is specified', () => {
    const load = verticalLoad({ slabThicknessM: 0.2 })
    expect(load.liveKpa).toBe(MIN_LIVE_LOAD_KPA)
    expect(load.liveGovernedBy).toBe('code-minimum')
  })

  it('a specified live load below the floor is raised to it', () => {
    const load = verticalLoad({ slabThicknessM: 0.2, liveLoadKpa: 1.0 })
    expect(load.liveKpa).toBe(MIN_LIVE_LOAD_KPA)
    expect(load.liveGovernedBy).toBe('code-minimum')
  })

  it('a specified live load above the floor is used', () => {
    const load = verticalLoad({ slabThicknessM: 0.2, liveLoadKpa: 5.0 })
    expect(load.liveKpa).toBe(5.0)
    expect(load.liveGovernedBy).toBe('specified')
  })

  it('motorized carts raise both floors', () => {
    const plain = verticalLoad({ slabThicknessM: 0.05 })
    const carts = verticalLoad({ slabThicknessM: 0.05, motorizedCarts: true })
    expect(carts.totalKpa).toBe(MIN_COMBINED_CARTS_KPA)
    expect(carts.totalKpa).toBeGreaterThan(plain.totalKpa)
    expect(carts.liveKpa).toBeGreaterThan(plain.liveKpa)
  })

  it('a 200 mm slab computes on loaded weight, rebar included', () => {
    // 0.2 × (25 + 1.5) + 0.5 = 5.8 dead, + 2.4 live = 8.2 kPa. The rebar is 1.5 of
    // that 26.5 and dropping it would under-load the deck by 0.3 kPa.
    const load = verticalLoad({ slabThicknessM: 0.2 })
    expect(load.deadKpa).toBeCloseTo(0.2 * 26.5 + 0.5, 3)
    expect(load.totalKpa).toBeCloseTo(0.2 * 26.5 + 0.5 + 2.4, 3)
  })
})

describe('falsework chain', () => {
  it('the deck is the closest-spaced layer, but the prop pitch is not the widest', () => {
    const fw = falseworkDesign({ slabThicknessM: 0.2, soffitHeightM: 3.0 })
    // Joists are always tighter than the beams under them: plywood against an H20.
    expect(fw.joist.adoptedM).toBeLessThan(fw.bearer.adoptedM)
    // Bearer and prop pitch are the *same* H20, so what separates them is load, and
    // the prop pitch carries more of it — pressure over the bearer spacing rather
    // than over the joist spacing. So the prop pitch comes out tighter, and a
    // layout that assumed spacings widen all the way down would over-span it.
    expect(fw.propSpacing.loadKnM).toBeGreaterThan(fw.bearer.loadKnM)
    expect(fw.propSpacing.adoptedM).toBeLessThanOrEqual(fw.bearer.adoptedM)
  })

  it('each step is loaded by the one above it', () => {
    const fw = falseworkDesign({ slabThicknessM: 0.2, soffitHeightM: 3.0 })
    expect(fw.joist.loadKnM).toBeCloseTo(fw.load.totalKpa, 6)
    expect(fw.bearer.loadKnM).toBeCloseTo(fw.load.totalKpa * fw.joist.adoptedM, 6)
    expect(fw.propSpacing.loadKnM).toBeCloseTo(fw.load.totalKpa * fw.bearer.adoptedM, 6)
  })

  it('adopted spacings land on the setting-out module', () => {
    const fw = falseworkDesign({ slabThicknessM: 0.25, soffitHeightM: 3.0 })
    for (const member of [fw.joist, fw.bearer, fw.propSpacing]) {
      expect(Math.round(member.adoptedM * 1000) % 50).toBe(0)
    }
  })

  it('adopted is never wider than calculated', () => {
    const fw = falseworkDesign({ slabThicknessM: 0.3, soffitHeightM: 3.0 })
    for (const member of [fw.joist, fw.bearer, fw.propSpacing]) {
      expect(member.adoptedM).toBeLessThanOrEqual(member.calculatedM + 1e-9)
      expect(member.utilisation).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  it('a thicker slab needs a tighter prop grid', () => {
    const thin = falseworkDesign({ slabThicknessM: 0.15, soffitHeightM: 3.0 })
    const thick = falseworkDesign({ slabThicknessM: 0.45, soffitHeightM: 3.0 })
    expect(thick.propsPerM2).toBeGreaterThan(thin.propsPerM2)
    expect(thick.propLoadKn).toBeGreaterThan(0)
  })

  it('warns rather than silently over-propping when the prop cannot reach', () => {
    const fw = falseworkDesign({ slabThicknessM: 0.2, soffitHeightM: 7.0 })
    expect(fw.propCapacityKn).toBeUndefined()
    expect(fw.warnings.map((w) => w.kind)).toContain('prop-does-not-reach')
  })

  it('flags the unverified sheathing values it ran on', () => {
    const fw = falseworkDesign({ slabThicknessM: 0.2, soffitHeightM: 3.0 })
    expect(fw.sheathing?.id).toBe(FILM_FACED_PLY_18MM.id)
    expect(fw.warnings.map((w) => w.kind)).toContain('unverified-sheathing')
  })

  it('architectural work tightens the deck', () => {
    const plain = falseworkDesign({ slabThicknessM: 0.2, soffitHeightM: 3.0 })
    const architectural = falseworkDesign({
      slabThicknessM: 0.2,
      soffitHeightM: 3.0,
      architectural: true,
    })
    // l/360 against l/270, and both governed by deflection — so the class shows up
    // as closer joists rather than as a note on the drawing.
    expect(architectural.joist.governedBy).toBe('deflection')
    expect(architectural.joist.calculatedM).toBeLessThan(plain.joist.calculatedM)
    expect(architectural.joist.adoptedM).toBeLessThan(plain.joist.adoptedM)
  })

  it('a verified sheathing grade raises no unverified warning', () => {
    const fw = falseworkDesign({
      slabThicknessM: 0.2,
      soffitHeightM: 3.0,
      sheathingId: PLYFORM_CLASS_I_19MM.id,
    })
    expect(fw.warnings.map((w) => w.kind)).not.toContain('unverified-sheathing')
  })

  it('the prop load is the tributary cell, and it is checked', () => {
    const fw = falseworkDesign({ slabThicknessM: 0.2, soffitHeightM: 3.0 })
    const cell = fw.bearer.adoptedM * fw.propSpacing.adoptedM
    expect(fw.propLoadKn).toBeCloseTo(fw.load.totalKpa * cell, 6)
    expect(fw.propsPerM2).toBeCloseTo(1 / cell, 6)
  })

  it('practical ceilings are recorded rather than hidden', () => {
    // A very thin slab: the arithmetic would open the joists past 600 mm.
    const fw = falseworkDesign({ slabThicknessM: 0.05, soffitHeightM: 2.5 })
    expect(fw.joist.adoptedM).toBeLessThanOrEqual(0.6)
    if (fw.joist.calculatedM > 0.6) expect(fw.joist.cappedBy).toBe('practical-maximum')
  })
})

describe('wall chain', () => {
  /** A DIN envelope for a wall poured at `riseRateMH` to `heightM`. */
  const envelope = (riseRateMH: number, heightM: number) =>
    pressureEnvelope(
      'DIN_18218',
      {},
      {
        riseRateMH,
        concreteTemperatureC: 20,
        pourHeightM: heightM,
        elementKind: 'wall',
        vibration: 'internal',
      },
    )

  /** An ordinary storey-height shutter poured at 2 m/h. */
  const ordinary = (over: Partial<WallDesignOptions> = {}) =>
    wallDesign({
      envelope: envelope(2, 3),
      liftHeightM: 3,
      runM: 6,
      wallThicknessMm: 200,
      ...over,
    })

  it('each step is loaded by the one above it', () => {
    const w = ordinary()
    // The sheathing sees the pressure, the stud sees it over its own spacing, and the
    // waler sees it over *its* own — which is the whole chain in three lines.
    expect(w.stud.loadKnM).toBeCloseTo(w.designPressureKnM2, 6)
    expect(w.waler.loadKnM).toBeCloseTo(w.designPressureKnM2 * w.stud.adoptedM, 6)
    expect(w.tieSpacing.loadKnM).toBeCloseTo(w.designPressureKnM2 * w.waler.adoptedM, 6)
  })

  it('a doubled waler carries half the line load per member', () => {
    const single = ordinary()
    const doubled = ordinary({ doubledWalers: true })
    // APA: "since the wales are doubled, each 2×4 wale carries 600 lbf (1200 ÷ 2)".
    // Compared at the same waler spacing, so the halving is visible rather than
    // absorbed into a different layout.
    const at = (w: ReturnType<typeof wallDesign>) => w.tieSpacing.loadKnM / w.waler.adoptedM
    expect(at(doubled)).toBeCloseTo(at(single) / 2, 6)
    expect(doubled.waler.adoptedM).toBeGreaterThanOrEqual(single.waler.adoptedM)
  })

  it('members are sized on the pressure at the base of the pour', () => {
    const w = ordinary()
    expect(w.designPressureKnM2).toBeCloseTo(pressureAtDepth(w.envelope, 3), 6)
    // And the base row of ties sees exactly that, not an average up the wall.
    expect(w.rows[0]?.pressureKnM2).toBeCloseTo(w.designPressureKnM2, 6)
  })

  it('the tie grid opens out as it rises and never closes', () => {
    // A 6 m lift poured fast: the envelope tops out well below the base, so the upper
    // rows genuinely have less pressure to carry and the grid should show it.
    const w = wallDesign({
      envelope: envelope(7, 6),
      liftHeightM: 6,
      runM: 10,
      wallThicknessMm: 300,
    })
    expect(w.rows.length).toBeGreaterThan(4)
    const spacings = w.rows.map((row) => row.horizontalSpacingMm)
    expect(Math.max(...spacings)).toBeGreaterThan(Math.min(...spacings))
    for (let i = 1; i < spacings.length; i++) {
      expect(spacings[i] as number).toBeGreaterThanOrEqual(spacings[i - 1] as number)
    }
  })

  it('tie spacing is a whole number of stud bays', () => {
    // A rod passes *between* studs. A spacing that is not a multiple of the stud pitch
    // puts half the ties where a stud already is.
    for (const riseRateMH of [0.5, 2, 5, 10]) {
      const w = wallDesign({
        envelope: envelope(riseRateMH, 4),
        liftHeightM: 4,
        runM: 8,
        wallThicknessMm: 250,
      })
      for (const row of w.rows) {
        const bays = row.horizontalSpacingMm / (w.stud.adoptedM * 1000)
        expect(Math.abs(bays - Math.round(bays))).toBeLessThan(1e-6)
        expect(bays).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('closes the walers rather than adding ties it cannot place', () => {
    // A 400 mm wall poured at 10 m/h. At a metre of waling the tie force leaves less
    // than one stud bay, and there is nowhere to put a tie inside a bay — so the
    // walers come in and the ties open back out to something buildable.
    const w = wallDesign({
      envelope: envelope(10, 5),
      liftHeightM: 5,
      runM: 8,
      wallThicknessMm: 400,
      system: PERI_TRIO,
    })
    expect(w.waler.adoptedM).toBeLessThan(MAX_WALER_SPACING_M)
    expect(w.tieSpacing.adoptedM).toBeGreaterThanOrEqual(w.stud.adoptedM - 1e-9)
  })

  it('the tie is limited by its weakest component, not by the rod', () => {
    const w = ordinary({ system: DOKA_FRAMAX_XLIFE })
    const rod = w.tie?.capacityKn ?? 0
    expect(w.tieCapacityKn).toBeLessThanOrEqual(rod)
    // And the report names the part, because "the tie is overloaded" sends a crew
    // looking for a heavier rod when the bracket is what gave way.
    expect(w.tieCapacityComponent.length).toBeGreaterThan(0)
  })

  it("a system's published tie spacing governs over the generic practical cap", () => {
    // Framax is drilled at 1.35 m and the loose practice figure is 0.9 m. The system's
    // own spacing wins, because it comes with a stiffer panel behind it. A slow pour on
    // a doubled waler, so the cap is what binds rather than the arithmetic.
    const light = { envelope: envelope(0.3, 2.4), liftHeightM: 2.4, doubledWalers: true }
    const framax = ordinary({ ...light, system: DOKA_FRAMAX_XLIFE })
    const generic = ordinary(light)
    expect(DOKA_FRAMAX_XLIFE.maxPracticalTieSpacingMm / 1000).toBeGreaterThan(MAX_TIE_SPACING_M)
    expect(generic.tieSpacing.cappedBy).toBe('practical-maximum')
    expect(framax.tieSpacing.cappedBy).toBe('practical-maximum')
    expect(framax.tieSpacing.adoptedM).toBeGreaterThan(generic.tieSpacing.adoptedM)
  })

  it('reports the point-load case rather than relying on the uniform tables', () => {
    const w = ordinary()
    expect(w.studsBetweenTies).toBeLessThan(MIN_STUDS_BETWEEN_TIES_FOR_UNIFORM_LOAD)
    expect(w.warnings.map((x) => x.kind)).toContain('point-load-analysis-required')
    // Three studs in the bay is where APA's tables become adequate, and the warning
    // has to go away there or it is noise rather than a finding.
    const close = ordinary({ statedStudSpacingM: 0.2, statedWalerSpacingM: 0.5 })
    expect(close.studsBetweenTies).toBeGreaterThanOrEqual(MIN_STUDS_BETWEEN_TIES_FOR_UNIFORM_LOAD)
    expect(close.warnings.map((x) => x.kind)).not.toContain('point-load-analysis-required')
  })

  it('the point-load correction only touches bending, which is not always what governs', () => {
    // At the line loads a wall waler sees, an H20 shears before it bends — so the
    // concentration is real and the span reduction is not. Scaling the governing span
    // regardless would cut a shear-governed waler for a bending effect it does not
    // have, so the warning has to say which happened.
    const w = ordinary({ statedStudSpacingM: 0.45, statedWalerSpacingM: 0.6 })
    expect(w.tieSpacing.governedBy).toBe('shear')
    const message = w.warnings.find((x) => x.kind === 'point-load-analysis-required')?.message
    expect(message).toContain('governed by shear')
  })

  it('a stated spacing over capacity is reported, not silently retightened', () => {
    const w = wallDesign({
      envelope: envelope(3, 3),
      liftHeightM: 3,
      runM: 6,
      wallThicknessMm: 250,
      statedStudSpacingM: 0.6,
      statedWalerSpacingM: 1.0,
    })
    expect(w.stud.adoptedM).toBe(0.6)
    expect(w.waler.adoptedM).toBe(1.0)
    expect(w.stud.stated).toBe(true)
    expect(w.warnings.map((x) => x.kind)).toContain('stated-spacing-over-capacity')
  })

  it('adopted is never wider than calculated', () => {
    const w = ordinary()
    for (const member of [w.stud, w.waler, w.tieSpacing]) {
      expect(member.adoptedM).toBeLessThanOrEqual(member.calculatedM + 1e-9)
      expect(member.utilisation).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  it('architectural work tightens the shutter', () => {
    const plain = ordinary()
    const architectural = ordinary({ architectural: true })
    expect(architectural.stud.governedBy).toBe('deflection')
    expect(architectural.stud.calculatedM).toBeLessThan(plain.stud.calculatedM)
  })

  it('a faster pour needs more ties per square metre', () => {
    const slow = wallDesign({
      envelope: envelope(0.5, 3),
      liftHeightM: 3,
      runM: 6,
      wallThicknessMm: 200,
    })
    const fast = wallDesign({
      envelope: envelope(8, 3),
      liftHeightM: 3,
      runM: 6,
      wallThicknessMm: 200,
    })
    expect(fast.designPressureKnM2).toBeGreaterThan(slow.designPressureKnM2)
    expect(fast.tiesPerM2).toBeGreaterThan(slow.tiesPerM2)
    expect(fast.stud.adoptedM).toBeLessThanOrEqual(slow.stud.adoptedM)
  })

  it('the tie density follows the graded rows, not the base band', () => {
    const w = wallDesign({
      envelope: envelope(7, 6),
      liftHeightM: 6,
      runM: 10,
      wallThicknessMm: 300,
    })
    const atBase = 1 / (w.waler.adoptedM * w.tieSpacing.adoptedM)
    // Counting the base spacing all the way up buys ties nobody fixes.
    expect(w.tiesPerM2).toBeLessThan(atBase)
    const perM = w.rows.reduce((sum, row) => sum + 1000 / row.horizontalSpacingMm, 0)
    expect(w.tiesPerM2).toBeCloseTo(perM / 6, 6)
  })

  it('a tie with no published range is a rod cut to length, so it reaches any wall', () => {
    const w = ordinary({ wallThicknessMm: 2000, system: PERI_TRIO })
    expect(w.tie?.wallRangeMm).toBeUndefined()
    expect(w.warnings.map((x) => x.kind)).not.toContain('no-tie-for-thickness')
  })

  it('says so when no tie in the system reaches the wall', () => {
    // A system served only by clamping hardware runs out at the top of its range —
    // there is no rod to cut longer — and then the tie spacing below is a waler span
    // check with nothing holding it.
    const clampsOnly = { ...PERI_TRIO, ties: PERI_TRIO.ties.filter((t) => t.wallRangeMm) }
    const w = ordinary({ wallThicknessMm: 2000, system: clampsOnly })
    expect(w.tie).toBeUndefined()
    expect(w.warnings.map((x) => x.kind)).toContain('no-tie-for-thickness')
  })

  it('flags the unverified sheathing values it ran on', () => {
    expect(ordinary().warnings.map((x) => x.kind)).toContain('unverified-sheathing')
    expect(
      ordinary({ sheathingId: PLYFORM_STRUCTURAL_I_19MM.id }).warnings.map((x) => x.kind),
    ).not.toContain('unverified-sheathing')
  })

  it('a lift shorter than one waler spacing still gets a row of ties', () => {
    const w = wallDesign({
      envelope: envelope(2, 0.3),
      liftHeightM: 0.3,
      runM: 3,
      wallThicknessMm: 200,
    })
    expect(w.rows.length).toBe(1)
    expect(w.rows[0]?.elevationMm).toBeGreaterThan(0)
    expect(w.rows[0]?.elevationMm).toBeLessThan(300)
  })
})

describe('wall bracing', () => {
  it('the code minimum governs a short wall and wind a tall one', () => {
    const short = braceDesign({ liftHeightM: 1.5 })
    const tall = braceDesign({ liftHeightM: 8 })
    expect(short.lineLoadKnM).toBe(MIN_BRACE_LINE_LOAD_KN_M)
    expect(short.governedBy).toBe('code-minimum')
    expect(tall.governedBy).toBe('wind')
    expect(tall.lineLoadKnM).toBeCloseTo(MIN_WIND_PRESSURE_KPA * 8, 6)
  })

  it('2 % of a heavy form can beat both', () => {
    const brace = braceDesign({ liftHeightM: 2, formDeadLoadKnM: 200 })
    expect(brace.governedBy).toBe('dead-load-fraction')
    expect(brace.lineLoadKnM).toBeCloseTo(4, 6)
  })

  it('the lever amplifies the load, and a low connection amplifies it more', () => {
    const high = braceDesign({ liftHeightM: 3, connectionHeightM: 2 })
    const low = braceDesign({ liftHeightM: 3, connectionHeightM: 1 })
    // R = H·h/a. This is the step people leave out, and it is why the anchor fails
    // rather than the raker.
    expect(high.reactionKnM).toBeCloseTo((high.lineLoadKnM * 3) / 2, 6)
    expect(low.reactionKnM).toBeCloseTo(high.reactionKnM * 2, 6)
    expect(low.rakerForceKn).toBeGreaterThan(low.reactionKnM)
  })

  it('the raker pushes down as hard as it pushes in, at 45°', () => {
    const brace = braceDesign({ liftHeightM: 3, rakerAngleDeg: 45 })
    expect(brace.anchorUpliftKn).toBeCloseTo(brace.rakerForceKn / Math.SQRT2, 6)
  })

  it('guy wires need both sides; rakers do not', () => {
    // A wire takes tension only, so wind from the other side has nothing to resist it.
    expect(braceDesign({ liftHeightM: 3, guyWires: true }).bothSidesRequired).toBe(true)
    expect(braceDesign({ liftHeightM: 3 }).bothSidesRequired).toBe(false)
  })
})

describe('span adoption', () => {
  it('rounds down onto the module', () => {
    expect(adoptSpan(0.4713, 0.05)).toBeCloseTo(0.45, 6)
    expect(adoptSpan(0.6, 0.05)).toBeCloseTo(0.6, 6)
  })

  it('never returns zero', () => {
    expect(adoptSpan(0.01, 0.05)).toBeCloseTo(0.05, 6)
  })

  it('utilisation is the adopted-to-allowable ratio', () => {
    expect(utilisation(0.45, 0.9)).toBeCloseTo(0.5, 6)
    expect(utilisation(0.45, Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('zero load', () => {
  it('has no span limit rather than throwing', () => {
    const solved = allowableSpan(0, H20_BEAM, DEFLECTION_LUMBER, 3)
    expect(solved.spanM).toBe(Number.POSITIVE_INFINITY)
  })
})
