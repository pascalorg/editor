import { describe, expect, test } from 'bun:test'
import {
  aciMaxRiseRateMH,
  aciPressure,
  bsShortcutPressure,
  type ConcreteMix,
  chemistryCoefficient,
  ciriaK,
  ciriaPressure,
  dinCharacteristicKnM2,
  dinMaxRiseRateMH,
  dinPressure,
  type Placement,
  pressureAtDepth,
  pressureAtElevationMm,
  pressureEnvelope,
  unitWeightCoefficient,
  verticalElementKind,
} from './index'

/**
 * The published worked examples, as tests. Every figure here is traceable to
 * `wiki/formwork/reference/design.md` §1 — either transcribed from ACI/CIRIA or
 * reproduced from the PASCHAL calculator probe — so a change that breaks one of
 * these is a change that disagrees with a code, not with a preference.
 */

/** 20 °C is DIN's reference temperature, so the base cases read as published. */
const wall = (over: Partial<Placement> = {}): Placement => ({
  riseRateMH: 2,
  concreteTemperatureC: 20,
  pourHeightM: 3,
  elementKind: 'wall',
  vibration: 'internal',
  ...over,
})

describe('ACI 347 lateral pressure', () => {
  test('brackets normal-weight concrete at Cw = 1.0 and scales outside it', () => {
    expect(unitWeightCoefficient(2400)).toBe(1)
    expect(unitWeightCoefficient(2300)).toBe(1)
    // Lightweight: the formula, with the 0.80 floor holding at the bottom end.
    expect(unitWeightCoefficient(2000)).toBeCloseTo(0.931, 3)
    expect(unitWeightCoefficient(1000)).toBe(0.8)
    // Heavyweight has no cap.
    expect(unitWeightCoefficient(2600)).toBeCloseTo(1.121, 3)
  })

  test('counts a superplasticizer as a retarder, per the Table 2.2 footnote', () => {
    expect(chemistryCoefficient(undefined)).toBe(1)
    expect(chemistryCoefficient({ retarder: true })).toBe(1.2)
    // The clause everyone misses: an HRWR that delays set is a retarder.
    expect(chemistryCoefficient({ superplasticizer: true })).toBe(1.2)
    expect(chemistryCoefficient({ slagFraction: 0.3 })).toBe(1.2)
    expect(chemistryCoefficient({ slagFraction: 0.3, retarder: true })).toBe(1.4)
    expect(chemistryCoefficient({ slagFraction: 0.8 })).toBe(1.4)
    expect(chemistryCoefficient({ flyAshFraction: 0.5 })).toBe(1.4)
  })

  test('takes Eq. 2.2 on a column at any height', () => {
    const envelope = aciPressure(
      {},
      { ...wall(), elementKind: 'column', pourHeightM: 6, riseRateMH: 3 },
    )
    // 7.2 + 785×3/(20+17.8) = 69.5 kN/m², under the 141 kN/m² fluid head over 6 m.
    expect(envelope.maxKnM2).toBeCloseTo(69.5, 2)
    expect(envelope.governingEquation).toContain('Eq. 2.2')
  })

  test('takes Eq. 2.3 on a short slow wall and Eq. 2.4 on a tall one', () => {
    const short = aciPressure({}, wall({ riseRateMH: 1.5, pourHeightM: 4 }))
    expect(short.governingEquation).toContain('Eq. 2.3')
    const tall = aciPressure({}, wall({ riseRateMH: 1.5, pourHeightM: 5 }))
    expect(tall.governingEquation).toContain('Eq. 2.4')
    // Eq. 2.4 carries the extra 1156/(T+17.8) term, so it is the higher of the two
    // at the same rate — which is why the height threshold matters.
    expect(tall.maxKnM2).toBeGreaterThan(short.maxKnM2)
  })

  test('caps every special case at the fluid head', () => {
    // A 1 m pour cannot exert more than 1 m of concrete weighs, whatever the rate.
    const envelope = aciPressure({}, wall({ pourHeightM: 1, riseRateMH: 4 }))
    expect(envelope.maxKnM2).toBeCloseTo(23.54, 2)
    expect(envelope.governingEquation).toContain('hydrostatic')
    expect(envelope.warnings.some((w) => w.kind === 'code-bound-governs')).toBe(true)
  })

  test('holds the 30·Cw floor on a slow pour', () => {
    // Eq. 2.2 at 0.2 m/h: 7.2 + 785×0.2/37.8 = 11.4, below the 30 kN/m² minimum —
    // and the 6 m pour is deep enough that the fluid head does not cap it away.
    const envelope = aciPressure(
      {},
      wall({ elementKind: 'column', riseRateMH: 0.2, pourHeightM: 6 }),
    )
    expect(envelope.maxKnM2).toBe(30)
    expect(envelope.governingEquation).toContain('minimum')
  })

  test('forces the fluid head for SCC and says the minimum is suppressed', () => {
    const envelope = aciPressure({ selfCompacting: true }, wall({ pourHeightM: 4 }))
    expect(envelope.maxKnM2).toBeCloseTo(94.18, 2)
    expect(envelope.hydrostaticHeightM).toBe(4)
    const forced = envelope.warnings.find((w) => w.kind === 'hydrostatic-forced')
    expect(forced?.message).toContain('minimum is suppressed')
  })

  test('forces the fluid head outside the slump and vibration envelope', () => {
    expect(aciPressure({ slumpMm: 200 }, wall()).governingEquation).toContain('hydrostatic')
    expect(aciPressure({}, wall({ vibration: 'external' })).governingEquation).toContain(
      'hydrostatic',
    )
    expect(aciPressure({}, wall({ vibratorImmersionDepthM: 1.5 })).governingEquation).toContain(
      'hydrostatic',
    )
    // Above 4.5 m/h Eq. 2.4 has no data behind it, so it does not apply.
    expect(aciPressure({}, wall({ riseRateMH: 5 })).governingEquation).toContain('hydrostatic')
  })

  test('adds 25 % surge when pumped from the base, on top of the fluid head', () => {
    const envelope = aciPressure({}, wall({ pourHeightM: 4, pumpedFromBase: true }))
    expect(envelope.maxKnM2).toBeCloseTo(94.176 * 1.25, 2)
    // The ramp steepens too — the surge is in the diagram, not just its peak.
    expect(envelope.gradientKnM3).toBeCloseTo(29.43, 2)
    expect(envelope.warnings.some((w) => w.kind === 'pump-surge')).toBe(true)
  })

  test('solves backwards for the rate a rated form may be poured at', () => {
    const placement = { ...wall(), elementKind: 'column' as const, pourHeightM: 6 }
    const rate = aciMaxRiseRateMH({}, placement, 90)
    // (90 − 7.2) × 37.8 / 785 = 3.99 m/h.
    expect(rate).toBeCloseTo(3.99, 2)
    // Round trip: pouring at that rate lands on the rating.
    expect(aciPressure({}, { ...placement, riseRateMH: rate as number }).maxKnM2).toBeCloseTo(90, 6)
  })

  test('reports no workable rate when the mix exceeds the rating at a standstill', () => {
    // 7.2 kN/m² is the constant term; a form rated below it cannot be used at all.
    expect(aciMaxRiseRateMH({}, wall(), 5)).toBeUndefined()
  })
})

describe('DIN 18218 lateral pressure', () => {
  test('reproduces the calculator at the base condition', () => {
    // F3 at v = 2, tE = 5, T = TRef: 18 + 14×2 = 46 kN/m².
    expect(dinCharacteristicKnM2({ consistencyClass: 'F3' }, wall())).toBeCloseTo(46, 6)
  })

  test('scales exactly with density', () => {
    const at = (unitWeightKnM3: number) =>
      dinCharacteristicKnM2({ consistencyClass: 'F3', unitWeightKnM3 }, wall())
    // Probed values from the reference: 1.84 kN/m² per unit γc, exactly.
    expect(at(20)).toBeCloseTo(36.8, 6)
    expect(at(22)).toBeCloseTo(40.48, 6)
    expect(at(28)).toBeCloseTo(51.52, 6)
  })

  test('applies the setting-time correction to the whole expression for F1–F4', () => {
    // F3, tE = 10, v = 2 → 46 × 1.385 = 63.71.
    expect(
      dinCharacteristicKnM2({ consistencyClass: 'F3', endOfSettingH: 10 }, wall()),
    ).toBeCloseTo(63.71, 2)
  })

  test('applies it to the rate term only for the flowable classes', () => {
    // F5, tE = 10, v = 3 → 25 + 30×3×2 = 205. The constant does not scale.
    expect(
      dinCharacteristicKnM2({ consistencyClass: 'F5', endOfSettingH: 10 }, wall({ riseRateMH: 3 })),
    ).toBeCloseTo(205, 6)
    // SCC, tE = 8, v = 2 → 25 + 33×2×1.6 = 130.6.
    expect(dinCharacteristicKnM2({ selfCompacting: true, endOfSettingH: 8 }, wall())).toBeCloseTo(
      130.6,
      6,
    )
  })

  test('corrects temperature asymmetrically for flowable mixes', () => {
    // F3 base 46: colder is +3 %/°C, warmer −3 %/°C, both classes.
    const f3 = (concreteTemperatureC: number) =>
      dinCharacteristicKnM2({ consistencyClass: 'F3' }, wall({ concreteTemperatureC }))
    expect(f3(10)).toBeCloseTo(59.8, 6)
    expect(f3(30)).toBeCloseTo(32.2, 6)
    // SCC base 91 (v = 2 at tE 5 is 25 + 66): colder is +5 %/°C, warmer still −3 %.
    const scc = (concreteTemperatureC: number) =>
      dinCharacteristicKnM2({ selfCompacting: true }, wall({ concreteTemperatureC }))
    expect(scc(16)).toBeCloseTo(109.2, 6)
    expect(scc(25)).toBeCloseTo(77.35, 6)
    // 4 °C colder costs an SCC mix 20 % and a vibrated one 12 % — the asymmetry is
    // only on the cold side, and only for the flowable classes.
    expect(scc(16) / scc(20)).toBeCloseTo(1.2, 6)
    expect(f3(16) / f3(20)).toBeCloseTo(1.12, 6)
  })

  test('depends only on the difference from the reference temperature', () => {
    const a = dinCharacteristicKnM2(
      { consistencyClass: 'F3', referenceTemperatureC: 15 },
      wall({ concreteTemperatureC: 15 }),
    )
    const b = dinCharacteristicKnM2(
      { consistencyClass: 'F3', referenceTemperatureC: 20 },
      wall({ concreteTemperatureC: 20 }),
    )
    expect(a).toBeCloseTo(b, 6)
  })

  test('caps at the fluid head over a shallow pour', () => {
    // F3, v = 2 at H = 1 m → γc·H = 25 governs over the formula's 46.
    const shallow = dinPressure({ consistencyClass: 'F3' }, wall({ pourHeightM: 1 }))
    expect(shallow.maxKnM2).toBeCloseTo(25, 6)
    expect(shallow.governingEquation).toContain('hydrostatic')
    // At 2 m the formula governs again.
    expect(dinPressure({ consistencyClass: 'F3' }, wall({ pourHeightM: 2 })).maxKnM2).toBeCloseTo(
      46,
      6,
    )
  })

  test('clamps at the 250 kN/m² ceiling', () => {
    // The ceiling only bites where the fluid head does not reach it first, which at
    // γc = 25 needs a pour over 10 m — outside DIN's own scope. So it is a heavy mix
    // at the top of the rate and height range that gets there.
    const envelope = dinPressure(
      { consistencyClass: 'F6', unitWeightKnM3: 28 },
      wall({ riseRateMH: 7, pourHeightM: 10 }),
    )
    expect(envelope.maxKnM2).toBe(250)
    expect(envelope.governingEquation).toContain('250')
  })

  test('flags every DIN result as derived from a probed calculator', () => {
    const envelope = dinPressure({ consistencyClass: 'F3' }, wall())
    expect(envelope.warnings.some((w) => w.kind === 'derived-coefficients')).toBe(true)
  })

  test('names the scope limits rather than silently exceeding them', () => {
    const kinds = dinPressure(
      { consistencyClass: 'F3' },
      wall({ riseRateMH: 9, pourHeightM: 12 }),
    ).warnings.map((w) => w.message)
    expect(kinds.some((m) => m.includes('7 m/h'))).toBe(true)
    expect(kinds.some((m) => m.includes('10 m'))).toBe(true)
  })

  test('flags a poker reaching below the hydrostatic zone', () => {
    // F3 at v = 2 gives hs = 46/25 = 1.84 m, so a 2 m immersion is below it.
    const envelope = dinPressure(
      { consistencyClass: 'F3' },
      wall({ pourHeightM: 4, vibratorImmersionDepthM: 2 }),
    )
    expect(envelope.warnings.some((w) => w.kind === 'immersion-below-hydrostatic-zone')).toBe(true)
  })

  test('solves backwards for the rate, and round-trips', () => {
    const rate = dinMaxRiseRateMH({ consistencyClass: 'F3' }, wall({ pourHeightM: 6 }), 80)
    // (80 − 18)/14 = 4.43 m/h.
    expect(rate).toBeCloseTo(4.43, 2)
    expect(
      dinCharacteristicKnM2(
        { consistencyClass: 'F3' },
        wall({ riseRateMH: rate as number, pourHeightM: 6 }),
      ),
    ).toBeCloseTo(80, 6)
  })

  test('reports no workable rate when the constant term already exceeds the rating', () => {
    // F5's constant is 25 kN/m², so a form rated 20 is unusable at any rate.
    expect(dinMaxRiseRateMH({ consistencyClass: 'F5' }, wall(), 20)).toBeUndefined()
  })
})

describe('CIRIA 108 / BS 5975 lateral pressure', () => {
  test('reproduces the published worked example', () => {
    // D = 25, R = 3.0 m/h, H = 3.30 m, C1 = 1.0, K = 0.56 → Pd1 = 53.87, Hz = 2.15.
    // Back-solving the published Pd1 gives C2 = 0.60, the slowest blend — which is
    // the only one of the three figures the spreadsheet did not print.
    const k = ciriaK(32.14)
    expect(k).toBeCloseTo(0.56, 2)
    const envelope = ciriaPressure(
      { ciriaC2: 0.6 },
      wall({ riseRateMH: 3, pourHeightM: 3.3, concreteTemperatureC: 32.14 }),
    )
    expect(envelope.maxKnM2).toBeCloseTo(53.8, 1)
    // And the published Hz of 2.15 m is Pmax/D, not the C1√R first term of 1.73 —
    // the ramp is hydrostatic, so that is the only depth at which it meets Pmax.
    expect(envelope.hydrostaticHeightM).toBeCloseTo(2.152, 3)
  })

  test('charges a column more than a wall through C1', () => {
    const at = (elementKind: 'wall' | 'column') =>
      ciriaPressure({}, wall({ elementKind, riseRateMH: 4, pourHeightM: 6 }))
    // C1√R is 2.00 m on a wall against 3.00 m on a narrow section, so the column
    // carries 1 m more fluid head: 25×(2 + 0.3√4) = 65 against 25×(3 + 0.3√3) = 88.
    expect(at('wall').maxKnM2).toBeCloseTo(65, 6)
    expect(at('column').maxKnM2).toBeCloseTo(87.99, 2)
    expect(at('column').hydrostaticHeightM).toBeGreaterThan(at('wall').hydrostaticHeightM)
  })

  test('goes fully hydrostatic when the zone reaches the pour top', () => {
    // C1√R at 1.5 × √9 = 4.5 m on a 4 m pour: no stiffened block below.
    const envelope = ciriaPressure(
      {},
      wall({ elementKind: 'column', riseRateMH: 9, pourHeightM: 4 }),
    )
    expect(envelope.maxKnM2).toBeCloseTo(100, 6)
    expect(envelope.governingEquation).toContain('reaches the full')
  })

  test('walks the C2 groups from plain Portland to the slowest blends', () => {
    const at = (mix: ConcreteMix) => ciriaPressure(mix, wall()).maxKnM2
    expect(at({})).toBeLessThan(at({ cement: { retarder: true } }))
    expect(at({ cement: { retarder: true } })).toBeLessThan(at({ cement: { slagFraction: 0.8 } }))
  })

  test('offers the no-inputs BS 5975 shortcut as flat fluid head', () => {
    const envelope = bsShortcutPressure({}, wall({ pourHeightM: 4 }))
    expect(envelope.maxKnM2).toBe(100)
    expect(envelope.hydrostaticHeightM).toBe(4)
    // And it is conservative against every rate-based answer for the same pour.
    expect(envelope.maxKnM2).toBeGreaterThan(
      dinPressure({ consistencyClass: 'F3' }, wall({ pourHeightM: 4 })).maxKnM2,
    )
  })
})

describe('the envelope as the layout reads it', () => {
  test('ramps to the corner and holds flat below it', () => {
    const envelope = dinPressure({ consistencyClass: 'F3' }, wall({ pourHeightM: 4 }))
    expect(envelope.maxKnM2).toBeCloseTo(46, 6)
    expect(envelope.hydrostaticHeightM).toBeCloseTo(1.84, 6)
    expect(pressureAtDepth(envelope, 0)).toBe(0)
    expect(pressureAtDepth(envelope, 1)).toBeCloseTo(25, 6)
    expect(pressureAtDepth(envelope, 1.84)).toBeCloseTo(46, 6)
    expect(pressureAtDepth(envelope, 3.5)).toBeCloseTo(46, 6)
  })

  test('inverts depth to elevation, so the dense end is at the base', () => {
    const envelope = dinPressure({ consistencyClass: 'F3' }, wall({ pourHeightM: 4 }))
    const at = pressureAtElevationMm(envelope, 4000)
    expect(at(4000)).toBe(0)
    expect(at(3000)).toBeCloseTo(25, 6)
    expect(at(0)).toBeCloseTo(46, 6)
    // Monotonically decreasing upward — the property a graded tie grid depends on.
    expect(at(1000)).toBeGreaterThanOrEqual(at(2000))
  })

  test('classifies a vertical element the way ACI defines it, not the way it is named', () => {
    expect(verticalElementKind([0.4, 0.4])).toBe('column')
    expect(verticalElementKind([2, 2])).toBe('column')
    // A 2.1 m "column" is a wall, and takes a wall's equation.
    expect(verticalElementKind([2.1, 0.4])).toBe('wall')
    expect(verticalElementKind([6, 0.2])).toBe('wall')
  })

  test('dispatches on the selected standard and keeps them distinct', () => {
    const placement = wall({ pourHeightM: 4, riseRateMH: 2 })
    const aci = pressureEnvelope('ACI_347', {}, placement)
    const din = pressureEnvelope('DIN_18218', { consistencyClass: 'F3' }, placement)
    const ciria = pressureEnvelope('CIRIA_108', {}, placement)
    const bs = pressureEnvelope('BS_5975_SHORTCUT', {}, placement)
    expect(aci.standard).toBe('ACI_347')
    expect(din.standard).toBe('DIN_18218')
    expect(ciria.standard).toBe('CIRIA_108')
    expect(bs.standard).toBe('BS_5975_SHORTCUT')
    // Four codes, four answers on one pour. They are not each other's conversions.
    expect(new Set([aci.maxKnM2, din.maxKnM2, ciria.maxKnM2, bs.maxKnM2]).size).toBe(4)
  })
})
