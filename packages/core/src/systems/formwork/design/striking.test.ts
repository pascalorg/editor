import { describe, expect, test } from 'bun:test'
import {
  ACI_HALVED_FLOOR_DAYS,
  BS_TEMPERATURE_CAP_C,
  isSubstitutedStrikingStandard,
  strikeTargetForPartKind,
  strikingStandardFor,
  strikingTime,
} from './striking'

/**
 * The period the form is held, which is what a hire invoice multiplies.
 *
 * Every assertion here is keyed on a figure transcribed in
 * `wiki/formwork/reference/design.md` §3.2–3.3 rather than on the code's own
 * arithmetic, because the failure this module can have is a plausible number: a
 * table row read from the wrong column, or a temperature formula that returns
 * something reasonable at 16 °C and nonsense at 4. The BS row is checked *against
 * its own printed column*, which is the check the standard itself provides —
 * 300/(16+10) is 11.5 h and the table prints 12.
 */

describe('strikingTime — BS 8110 Table 6.2', () => {
  test('the formula reproduces the table’s own printed column', () => {
    // The standard prints 12 h / 4 d / 10 d / 14 d at 16 °C and above, and those are
    // the formulas evaluated there. If a coefficient is transcribed wrong this is
    // where it shows, without needing the standard in hand.
    const at16 = (target: Parameters<typeof strikingTime>[1]['target']) =>
      strikingTime('BS_8110', { target, temperatureC: 16 })

    expect(at16('vertical-form').hours).toBeCloseTo(11.54, 1)
    expect(at16('slab-soffit-form').days).toBeCloseTo(3.85, 1)
    expect(at16('slab-props').days).toBeCloseTo(9.62, 1)
    expect(at16('beam-props').days).toBeCloseTo(13.85, 1)
  })

  test('a colder cure is held longer, and the rule says at what temperature', () => {
    const warm = strikingTime('BS_8110', { target: 'slab-props', temperatureC: 16 })
    const cold = strikingTime('BS_8110', { target: 'slab-props', temperatureC: 4 })

    expect(cold.days).toBeGreaterThan(warm.days)
    expect(cold.days).toBeCloseTo(250 / 14, 4)
    expect(cold.governingRule).toContain('t = 4 °C')
  })

  test('a warm cure earns no more than the table allows', () => {
    // BS caps the benefit at 16 °C. Without the cap a 30 °C day computes 6.25 d for
    // props against the table's 10, which is the unsafe direction.
    const hot = strikingTime('BS_8110', { target: 'slab-props', temperatureC: 30 })
    const capped = strikingTime('BS_8110', {
      target: 'slab-props',
      temperatureC: BS_TEMPERATURE_CAP_C,
    })

    expect(hot.days).toBe(capped.days)
    expect(hot.governingRule).toContain('t = 16 °C')
  })

  test('an unstated temperature is the table’s column, and says so', () => {
    const assumed = strikingTime('BS_8110', { target: 'slab-props' })

    expect(assumed.days).toBeCloseTo(250 / 26, 4)
    expect(assumed.assumed.map((entry) => entry.kind)).toEqual(['temperature'])
    expect(assumed.assumed[0]?.message).toContain('16 °C')
  })

  test('below freezing is reported rather than extrapolated', () => {
    // The table stops at 0 °C, and a negative t would divide by a smaller number and
    // return a longer period as though the formula still held. It does not: frozen
    // concrete is not curing at all.
    const frozen = strikingTime('BS_8110', { target: 'slab-props', temperatureC: -5 })

    expect(frozen.days).toBeCloseTo(25, 4)
    expect(frozen.warnings.map((warning) => warning.kind)).toContain('temperature-below-table')
  })

  test('the props under a slab are held far longer than the deck over them', () => {
    // The whole reason the target is per part rather than per element. Priced as one
    // period the deck sheets are charged 2.5× their real hire.
    const form = strikingTime('BS_8110', { target: 'slab-soffit-form', temperatureC: 16 })
    const props = strikingTime('BS_8110', { target: 'slab-props', temperatureC: 16 })

    expect(props.days / form.days).toBeCloseTo(2.5, 2)
  })

  test('the period is calendar time, unlike ACI’s', () => {
    expect(strikingTime('BS_8110', { target: 'vertical-form' }).basis).toBe('calendar')
  })
})

describe('strikingTime — ACI 347 §3.7.2.3', () => {
  test('a vertical form is 12 h whatever the temperature says', () => {
    // ACI publishes one figure and folds the temperature into the clock instead —
    // which is exactly why `basis` exists, and why a temperature passed here must not
    // silently change the answer the way it does under BS.
    const warm = strikingTime('ACI_347', { target: 'vertical-form', temperatureC: 25 })
    const cold = strikingTime('ACI_347', { target: 'vertical-form', temperatureC: 2 })

    expect(warm.hours).toBe(12)
    expect(cold.hours).toBe(12)
    expect(warm.basis).toBe('qualifying-time')
  })

  test('the accumulator is warned about on every answer', () => {
    // The one warning that turns a correct figure into a missed date. A reader who
    // takes "4 days" off a cold-spring programme strikes early.
    const time = strikingTime('ACI_347', { target: 'slab-soffit-form', clearSpanM: 2 })

    expect(time.warnings.map((warning) => warning.kind)).toContain('qualifying-time-not-calendar')
  })

  test('the soffit table bands on clear span', () => {
    const short = strikingTime('ACI_347', { target: 'slab-soffit-form', clearSpanM: 2 })
    const mid = strikingTime('ACI_347', { target: 'slab-soffit-form', clearSpanM: 5 })
    const long = strikingTime('ACI_347', { target: 'slab-soffit-form', clearSpanM: 8 })

    expect([short.days, mid.days, long.days]).toEqual([4, 7, 10])
    expect(mid.governingRule).toContain('3–6 m')
  })

  test('a 6 m span is the middle band, not the long one', () => {
    // The table reads "10–20 ft" inclusive, and an off-by-one at the boundary is a
    // period 3 days long that reads as plausible either way.
    expect(strikingTime('ACI_347', { target: 'slab-soffit-form', clearSpanM: 6 }).days).toBe(7)
  })

  test('live load over dead load takes the shorter column', () => {
    const reserve = strikingTime('ACI_347', {
      target: 'slab-soffit-form',
      clearSpanM: 5,
      liveExceedsDead: true,
    })

    expect(reserve.days).toBe(4)
    expect(reserve.governingRule).toContain('live load over dead load')
  })

  test('a beam soffit is held far longer than a slab of the same span', () => {
    const slab = strikingTime('ACI_347', { target: 'slab-soffit-form', clearSpanM: 5 })
    const beam = strikingTime('ACI_347', { target: 'beam-soffit-form', clearSpanM: 5 })

    expect(slab.days).toBe(7)
    expect(beam.days).toBe(14)
  })

  test('footnote ‡ halves a form that leaves its shores behind', () => {
    // The clause the whole drophead market exists on: 14 d becomes 7.
    const held = strikingTime('ACI_347', { target: 'beam-soffit-form', clearSpanM: 5 })
    const dropped = strikingTime('ACI_347', {
      target: 'beam-soffit-form',
      clearSpanM: 5,
      shoresRemain: true,
    })

    expect(held.days).toBe(14)
    expect(dropped.days).toBe(7)
    expect(dropped.governingRule).toContain('footnote ‡')
  })

  test('the halved period is floored at 3 days, not halved to 2', () => {
    // A 4 d slab soffit halves to 2, and the footnote says "but not less than 3
    // days". Without the floor this is the one case where the clause reads as a
    // saving and is a slab struck a day early.
    const dropped = strikingTime('ACI_347', {
      target: 'slab-soffit-form',
      clearSpanM: 2,
      shoresRemain: true,
    })

    expect(dropped.days).toBe(ACI_HALVED_FLOOR_DAYS)
  })

  test('props are never halved, because they are the shores', () => {
    // Footnote ‡ is conditional on the form coming away *without disturbing the
    // shores*, which cannot apply to the shores themselves. Halving here would
    // remove the support the clause depends on.
    const props = strikingTime('ACI_347', {
      target: 'slab-props',
      clearSpanM: 2,
      shoresRemain: true,
    })
    const plain = strikingTime('ACI_347', { target: 'slab-props', clearSpanM: 2 })

    expect(props.days).toBe(plain.days)
    expect(props.governingRule).not.toContain('footnote ‡')
  })

  test('the halving does not apply in the live-over-dead column', () => {
    // The footnote marks only the left-hand column's figures. Applying it to both
    // takes a 4 d soffit to 3 on the strength of a mark that is not on that number.
    const reserve = strikingTime('ACI_347', {
      target: 'beam-soffit-form',
      clearSpanM: 5,
      liveExceedsDead: true,
      shoresRemain: true,
    })

    expect(reserve.days).toBe(7)
    expect(reserve.governingRule).not.toContain('footnote ‡')
  })

  test('unstated span and load ratio take the long end and are named', () => {
    const assumed = strikingTime('ACI_347', { target: 'slab-soffit-form' })

    expect(assumed.days).toBe(10)
    expect(assumed.assumed.map((entry) => entry.kind).sort()).toEqual(['clear-span', 'load-ratio'])
  })

  test('a vertical form carrying a soffit form says the soffit governs', () => {
    // Footnote *. The 12 h figure is right for the form and wrong for the job, and
    // there is nothing in the number itself to show it.
    const carrying = strikingTime('ACI_347', {
      target: 'vertical-form',
      supportsSoffitForm: true,
    })

    expect(carrying.hours).toBe(12)
    expect(carrying.warnings.map((warning) => warning.kind)).toContain('soffit-form-governs')
  })
})

describe('a stated strength criterion (spec "Striking may be governed by strength")', () => {
  // The strength criterion is Nurse–Saul maturity at a single recorded cure
  // temperature, so `hours = M_target / (t - T0)` (design.md §3.4). These tests
  // key on that arithmetic and on the three spec scenarios: strength governs,
  // time governs, and a criterion missing an input falls back and says so.

  test('strength governs when the maturity target is reached later than the table', () => {
    // BS 8110 props at 16 °C are held 250/26 = 9.6 d. A target of 6000 °C·h
    // accumulates at (16 − 0) °C·h per hour, so it takes 6000/16 = 375 h = 15.6 d.
    const t = strikingTime('BS_8110', {
      target: 'slab-props',
      temperatureC: 16,
      maturityTargetDegreeHours: 6000,
    })

    expect(t.criterion).toBe('strength')
    expect(t.days).toBeCloseTo(6000 / 16 / 24, 4)
    expect(t.hours).toBeCloseTo(375, 4)
    expect(t.maturity?.targetDegreeHours).toBe(6000)
    // At the strength-governed strike date the accumulated maturity meets the target.
    expect(t.maturity?.accumulatedDegreeHours).toBeCloseTo(6000, 1)
    expect(t.governingRule).toContain('governed by the strength criterion')
  })

  test('time governs when it is the later of the two, and the maturity is reported', () => {
    // A target of 1000 °C·h is met in 62.5 h, well inside the table's 230.8 h —
    // so the form stays for the table's period and the strength has long been met.
    const t = strikingTime('BS_8110', {
      target: 'slab-props',
      temperatureC: 16,
      maturityTargetDegreeHours: 1000,
    })

    expect(t.criterion).toBe('elapsed-time')
    expect(t.days).toBeCloseTo(250 / 26, 4)
    // Accumulated by the time-governed strike date: 16 °C·h per hour over 230.8 h.
    expect(t.maturity?.accumulatedDegreeHours).toBeCloseTo(16 * (250 / 26) * 24, 1)
    expect(t.governingRule).toContain('time governs')
  })

  test('a target met in exactly the table’s own period does not switch to strength', () => {
    // At a datum of −10 °C the same 6000 °C·h takes 6000/26 = 230.8 h, the table’s
    // own period. Equality goes to elapsed time, the conservative reading of "later".
    const t = strikingTime('BS_8110', {
      target: 'slab-props',
      temperatureC: 16,
      maturityDatumC: -10,
      maturityTargetDegreeHours: 6000,
    })

    expect(t.criterion).toBe('elapsed-time')
  })

  test('the criterion governs under ACI too, on the same clock the table uses', () => {
    const t = strikingTime('ACI_347', {
      target: 'slab-props',
      clearSpanM: 2,
      temperatureC: 16,
      maturityTargetDegreeHours: 6000,
    })

    expect(t.criterion).toBe('strength')
    expect(t.basis).toBe('qualifying-time')
    expect(t.days).toBeCloseTo(6000 / 16 / 24, 4)
  })

  test('a criterion missing the curing temperature falls back to time and names it', () => {
    const t = strikingTime('BS_8110', {
      target: 'slab-props',
      maturityTargetDegreeHours: 6000,
    })

    expect(t.criterion).toBe('elapsed-time')
    expect(t.days).toBeCloseTo(250 / 26, 4)
    expect(t.warnings.map((warning) => warning.kind)).toContain('strength-criterion-not-evaluated')
    const warning = t.warnings.find((entry) => entry.kind === 'strength-criterion-not-evaluated')
    expect(warning?.message).toMatch(/temperature history/)
  })

  test('a cure at or below the datum accumulates nothing, and that is the missing input', () => {
    const t = strikingTime('BS_8110', {
      target: 'slab-props',
      temperatureC: 0,
      maturityTargetDegreeHours: 6000,
    })

    expect(t.criterion).toBe('elapsed-time')
    const warning = t.warnings.find((entry) => entry.kind === 'strength-criterion-not-evaluated')
    expect(warning?.message).toMatch(/no maturity accumulates/)
  })

  test('a strength stated without the maturity target behind it is not silently dropped', () => {
    // "70 % of f'c" alone is a criterion with nothing to evaluate: the maturity at
    // which that strength is reached (from job-cured specimens) is the missing input.
    const t = strikingTime('BS_8110', {
      target: 'slab-props',
      temperatureC: 16,
      requiredStrengthFraction: 0.7,
      designStrengthMpa: 40,
    })

    expect(t.criterion).toBe('elapsed-time')
    const warning = t.warnings.find((entry) => entry.kind === 'strength-criterion-not-evaluated')
    expect(warning?.message).toMatch(/calibrated from job-cured specimens/)
  })

  test('an unstated datum takes 0 °C and is named as assumed', () => {
    const assumed = strikingTime('BS_8110', {
      target: 'slab-props',
      temperatureC: 16,
      maturityTargetDegreeHours: 6000,
    })
    const stated = strikingTime('BS_8110', {
      target: 'slab-props',
      temperatureC: 16,
      maturityDatumC: -10,
      maturityTargetDegreeHours: 6000,
    })

    expect(assumed.assumed.map((entry) => entry.kind)).toContain('maturity-datum')
    expect(stated.assumed.map((entry) => entry.kind)).not.toContain('maturity-datum')
  })

  test('the strength is named as the contract would when its parts are stated', () => {
    const named = strikingTime('BS_8110', {
      target: 'slab-props',
      temperatureC: 16,
      maturityTargetDegreeHours: 6000,
      requiredStrengthFraction: 0.7,
      designStrengthMpa: 40,
    })

    expect(named.governingRule).toContain('70 % of the design strength (40 MPa)')
    expect(named.maturity?.requiredStrengthFraction).toBe(0.7)
    expect(named.maturity?.designStrengthMpa).toBe(40)
  })

  test('a fraction alone, or a design strength alone, names the criterion it can', () => {
    const fractionOnly = strikingTime('BS_8110', {
      target: 'slab-props',
      temperatureC: 16,
      maturityTargetDegreeHours: 6000,
      requiredStrengthFraction: 0.7,
    })
    const designOnly = strikingTime('BS_8110', {
      target: 'slab-props',
      temperatureC: 16,
      maturityTargetDegreeHours: 6000,
      designStrengthMpa: 40,
    })
    const neither = strikingTime('BS_8110', {
      target: 'slab-props',
      temperatureC: 16,
      maturityTargetDegreeHours: 6000,
    })

    expect(fractionOnly.governingRule).toContain('70 % of the design strength')
    expect(designOnly.governingRule).toContain('the design strength of 40 MPa')
    expect(neither.governingRule).toContain('the required strength')
  })

  test('stating none of the strength inputs keeps the elapsed-only answer untouched', () => {
    const plain = strikingTime('BS_8110', { target: 'slab-props', temperatureC: 16 })

    expect(plain.criterion).toBe('elapsed-time')
    expect(plain.maturity).toBeUndefined()
    expect(plain.days).toBeCloseTo(250 / 26, 4)
  })
})

describe('the two adjustments neither code quantifies', () => {
  test('high-early-strength concrete is reported as available, not applied', () => {
    // "Can be reduced as approved" is a person's decision with no factor attached.
    // Applying an invented one shortens the period that decides when a floor carries
    // itself.
    const plain = strikingTime('BS_8110', { target: 'slab-props', temperatureC: 16 })
    const rapid = strikingTime('BS_8110', {
      target: 'slab-props',
      temperatureC: 16,
      highEarlyStrength: true,
    })

    expect(rapid.days).toBe(plain.days)
    expect(rapid.warnings.map((warning) => warning.kind)).toContain(
      'reduction-permitted-not-quantified',
    )
  })

  test('a retarder lengthens the period and the figure says it is short', () => {
    const delayed = strikingTime('ACI_347', {
      target: 'slab-soffit-form',
      clearSpanM: 2,
      delayedSetting: true,
    })

    expect(delayed.days).toBe(4)
    expect(delayed.warnings.map((warning) => warning.kind)).toContain(
      'increase-required-not-quantified',
    )
  })
})

describe('strikingStandardFor', () => {
  test('an ACI project takes ACI’s own table', () => {
    expect(strikingStandardFor('ACI_347')).toBe('ACI_347')
    expect(isSubstitutedStrikingStandard('ACI_347')).toBe(false)
  })

  test('a DIN project has no striking table of its own, and that is flagged', () => {
    // DIN 18218 tabulates pressure and nothing about removal; its family answers this
    // in EN 13670 §5.5, which is open item 4 and genuinely uncovered. Falling to BS is
    // right and is a substitution across families, not a match.
    expect(strikingStandardFor('DIN_18218')).toBe('BS_8110')
    expect(isSubstitutedStrikingStandard('DIN_18218')).toBe(true)
  })

  test('a CIRIA project is already in BS’s family', () => {
    expect(strikingStandardFor('CIRIA_108')).toBe('BS_8110')
    expect(isSubstitutedStrikingStandard('CIRIA_108')).toBe(false)
  })
})

describe('strikeTargetForPartKind', () => {
  test('a slab’s props and its deck are different targets', () => {
    expect(strikeTargetForPartKind('prop', 'slab')).toBe('slab-props')
    expect(strikeTargetForPartKind('ply-piece', 'slab')).toBe('slab-soffit-form')
    expect(strikeTargetForPartKind('joist', 'slab')).toBe('slab-soffit-form')
  })

  test('a wall’s prop is a raker, not a shore', () => {
    // It holds the form on line against wind. Reading it as a slab prop would hold a
    // wall's bracing for ten days instead of twelve hours.
    expect(strikeTargetForPartKind('prop', 'wall')).toBe('vertical-form')
    expect(strikeTargetForPartKind('panel', 'column')).toBe('vertical-form')
  })

  test('a tie and a consumable are not struck at all', () => {
    // A tie is cut off inside the wall and a drum of release agent is gone. Returning
    // a target for either prices spent material as held plant.
    expect(strikeTargetForPartKind('tie', 'wall')).toBeUndefined()
    expect(strikeTargetForPartKind('consumable', 'slab')).toBeUndefined()
    expect(strikeTargetForPartKind('tie', 'slab')).toBeUndefined()
  })
})
