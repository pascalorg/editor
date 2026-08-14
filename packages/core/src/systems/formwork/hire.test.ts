import { describe, expect, test } from 'bun:test'
import type { StrikeTarget } from './design/striking'
import { bomHire, strikingInputFor } from './hire'
import type { BomLine } from './parts'
import { DEFAULT_FORMWORK_SETTINGS } from './settings'

/**
 * The join between a striking table and a bill.
 *
 * `striking.test.ts` covers the periods themselves against the published tables, so
 * nothing here re-checks a figure from a code. What is left to get wrong is the
 * mapping: a line quietly given one period when its parts have two, a tie priced as
 * held plant, or a total that sums periods instead of taking the longest.
 */

function line(overrides: Partial<BomLine> = {}): BomLine {
  return {
    kind: 'panel',
    catalogId: 'panel-a',
    description: 'Panel 600 × 2700',
    provenance: 'standard',
    quantity: 4,
    unit: 'no',
    marks: ['P-A-1-00000'],
    ...overrides,
  }
}

/** A lookup built the way a caller builds one: mark → what that mark is struck as. */
function lookup(map: Record<string, StrikeTarget[]>) {
  return (mark: string): readonly StrikeTarget[] => map[mark] ?? []
}

describe('bomHire', () => {
  test('a line takes the period of the thing it is', () => {
    const deck = line({ kind: 'ply-piece', marks: ['DK-00000-00000'] })
    const props = line({ kind: 'prop', marks: ['PR-00000-00000'] })

    const hire = bomHire(
      [deck, props],
      lookup({ 'DK-00000-00000': ['slab-soffit-form'], 'PR-00000-00000': ['slab-props'] }),
      'BS_8110',
      { temperatureC: 16 },
    )

    // The gap drophead systems exist to exploit: 2.5× between one slab's deck and its
    // own props. A per-element period would price both at the props' duration.
    expect(hire.lines[0]?.hours).toBeCloseTo((100 / 26) * 24, 4)
    expect(hire.lines[1]?.hours).toBeCloseTo((250 / 26) * 24, 4)
    expect(hire.complete).toBe(true)
  })

  test('a line whose parts span two periods says so and takes the longest', () => {
    // The case the module is shaped around. One catalog id props a slab and rakes a
    // wall, `bomLines` groups them because a delivery note does, and there is no single
    // duration for the row — averaging it under-charges the shores by five days.
    const props = line({ kind: 'prop', marks: ['PR-00000-00000', 'PR-A-00000'] })

    const hire = bomHire(
      [props],
      lookup({ 'PR-00000-00000': ['slab-props'], 'PR-A-00000': ['vertical-form'] }),
      'BS_8110',
      { temperatureC: 16 },
    )

    const entry = hire.lines[0]
    expect(entry?.hours).toBeCloseTo((250 / 26) * 24, 4)
    expect(entry?.mixed?.targets).toEqual(['slab-props', 'vertical-form'])
    expect(entry?.mixed?.message).toContain('struck at different times')
    expect(hire.mixedLines).toHaveLength(1)
  })

  test('a part nothing strikes carries no period, not a zero', () => {
    // A tie is cut off inside the wall and a drum of release agent is gone. A zero
    // would price spent material as plant returned the same day, and would enter the
    // longest-period comparison as though it were an answer.
    const ties = line({ kind: 'tie', marks: ['T-A-01000'] })
    const panels = line({ marks: ['P-A-1-00000'] })

    const hire = bomHire([ties, panels], lookup({ 'P-A-1-00000': ['vertical-form'] }), 'BS_8110', {
      temperatureC: 16,
    })

    expect(hire.lines[0]?.hours).toBeUndefined()
    expect(hire.lines[1]?.hours).toBeCloseTo(300 / 26, 4)
    expect(hire.complete).toBe(false)
  })

  test('the bill’s period is its slowest release, not the sum of its lines', () => {
    // Three lines held 12 h, 4 d and 10 d are not held 14 days. The props holding one
    // slab do not shorten the props holding the next, so a set comes free when the last
    // of it does — a sum would produce a duration longer than the job.
    const hire = bomHire(
      [
        line({ marks: ['P-A-1-00000'] }),
        line({ kind: 'ply-piece', marks: ['DK-00000-00000'] }),
        line({ kind: 'prop', marks: ['PR-00000-00000'] }),
      ],
      lookup({
        'P-A-1-00000': ['vertical-form'],
        'DK-00000-00000': ['slab-soffit-form'],
        'PR-00000-00000': ['slab-props'],
      }),
      'BS_8110',
      { temperatureC: 16 },
    )

    expect(hire.longestHours).toBeCloseTo((250 / 26) * 24, 4)
    expect(hire.periods.map((period) => period.target)).toEqual([
      'slab-props',
      'slab-soffit-form',
      'vertical-form',
    ])
  })

  test('the distinct periods are solved once however many lines share them', () => {
    // A 200-line bill has three periods in it. Solving per line is the same arithmetic
    // 200 times, and `periods` is the readout a planner actually wants.
    const marks = Array.from({ length: 40 }, (_, index) => `P-A-1-0000${index}`)
    const hire = bomHire(
      marks.map((mark) => line({ marks: [mark] })),
      () => ['vertical-form'],
      'BS_8110',
      { temperatureC: 16 },
    )

    expect(hire.lines).toHaveLength(40)
    expect(hire.periods).toHaveLength(1)
  })

  test('the assumptions and warnings behind the figures travel with the bill', () => {
    // Every line of an ACI bill is on a clock that is not the calendar, and a reader who
    // does not know it strikes early in a cold spring. Deduped, because the same warning
    // repeated per line reads as several problems.
    const hire = bomHire(
      [line({ kind: 'ply-piece', marks: ['DK-1'] }), line({ kind: 'ply-piece', marks: ['DK-2'] })],
      lookup({ 'DK-1': ['slab-soffit-form'], 'DK-2': ['slab-soffit-form'] }),
      'ACI_347',
      {},
    )

    expect(hire.basis).toBe('qualifying-time')
    expect(hire.warnings.map((warning) => warning.kind)).toEqual(['qualifying-time-not-calendar'])
    expect(hire.assumed.map((entry) => entry.kind).sort()).toEqual(['clear-span', 'load-ratio'])
  })

  test('an empty bill has no period rather than a zero-hour one', () => {
    const hire = bomHire([], () => [], 'BS_8110', {})

    expect(hire.longestHours).toBe(0)
    expect(hire.periods).toEqual([])
    // Vacuously true, and it has to be: a bill with nothing in it is not a bill with an
    // unpriced line in it.
    expect(hire.complete).toBe(true)
    expect(hire.basis).toBe('calendar')
  })
})

describe('strikingInputFor', () => {
  test('an unconfigured project states nothing, and the tables default themselves', () => {
    // Deliberately not the shape the pressure settings take. A resolved 16 °C here would
    // reach the same figure as BS's own printed column and lose the `assumed` entry that
    // says nobody chose it.
    expect(strikingInputFor(DEFAULT_FORMWORK_SETTINGS)).toEqual({})
  })

  test('the curing temperature is read, and it is not the placing temperature', () => {
    // The two move the design in opposite directions — a colder mix raises the pressure,
    // a colder cure lengthens the hold — so reading one as the other is how a January
    // pour gets July's strike time.
    const input = strikingInputFor({
      ...DEFAULT_FORMWORK_SETTINGS,
      concreteTemperatureC: 25,
      curing: { surfaceTemperatureC: 5 },
    })

    expect(input.temperatureC).toBe(5)
  })

  test('a retarder already on the mix lengthens the hold without being asked twice', () => {
    // The same admixture is worth 20 % of the pressure and a longer period on the form.
    // Asked separately, a project could state it for one and not the other, and the
    // strike time is the one that decides when a floor carries itself.
    const input = strikingInputFor({
      ...DEFAULT_FORMWORK_SETTINGS,
      concrete: { cement: { retarder: true } },
    })

    expect(input.delayedSetting).toBe(true)
  })

  test('a cure below 10 °C is the codes’ other trigger for a longer period', () => {
    const cold = strikingInputFor({
      ...DEFAULT_FORMWORK_SETTINGS,
      curing: { surfaceTemperatureC: 4 },
    })
    const warm = strikingInputFor({
      ...DEFAULT_FORMWORK_SETTINGS,
      curing: { surfaceTemperatureC: 18 },
    })

    expect(cold.delayedSetting).toBe(true)
    expect(warm.delayedSetting).toBeUndefined()
  })

  test('a drophead system carries the clause it exists on', () => {
    const input = strikingInputFor({
      ...DEFAULT_FORMWORK_SETTINGS,
      curing: { shoresRemain: true, highEarlyStrength: true },
    })

    expect(input.shoresRemain).toBe(true)
    expect(input.highEarlyStrength).toBe(true)
  })

  test('a stated strength criterion passes through as it was stated', () => {
    const input = strikingInputFor({
      ...DEFAULT_FORMWORK_SETTINGS,
      curing: {
        maturityTargetDegreeHours: 6000,
        maturityDatumC: -10,
        requiredStrengthFraction: 0.7,
        designStrengthMpa: 40,
      },
    })

    expect(input.maturityTargetDegreeHours).toBe(6000)
    expect(input.maturityDatumC).toBe(-10)
    expect(input.requiredStrengthFraction).toBe(0.7)
    expect(input.designStrengthMpa).toBe(40)
  })

  test('an unstated strength criterion adds nothing, so the tables stay the answer', () => {
    // Not resolved to a default here: a strength criterion that cannot be evaluated
    // is the striking module's fallback to decide, not a number to invent in settings.
    expect(strikingInputFor(DEFAULT_FORMWORK_SETTINGS).maturityTargetDegreeHours).toBeUndefined()
    expect(
      strikingInputFor({
        ...DEFAULT_FORMWORK_SETTINGS,
        curing: { surfaceTemperatureC: 16 },
      }).maturityTargetDegreeHours,
    ).toBeUndefined()
  })
})
