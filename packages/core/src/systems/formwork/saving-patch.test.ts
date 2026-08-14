import { describe, expect, test } from 'bun:test'
import {
  type FormworkSavings,
  noSuchSaving,
  SAVING_CLASSES,
  type SavingClass,
  type SavingProposal,
  savingByKey,
  savingCaveats,
  savingKey,
} from './saving-patch'

/**
 * Naming one saving so it can be taken.
 *
 * What is worth asserting here is not the string but the two properties the string has to
 * have, and either would go unnoticed in a passing implementation: the money must never be
 * in it (a rate edit restates the same offer, and a key that moved with the money would
 * refuse the very proposal it printed), and the decision must be — a different alternative
 * is a different offer that must not answer for the old one.
 */

const FRAMAX = 'doka-framax-xlife'
const TRIO = 'peri-trio'

function proposal(overrides: Partial<SavingProposal> = {}): SavingProposal {
  const merged = {
    class: 'substitution' as SavingClass,
    target: FRAMAX,
    alternative: TRIO,
    description: 'TRIO forms this scope cheaper than Framax.',
    saving: {
      label: 'Hire, recharge and consumables over this job',
      from: 12000,
      to: 9500,
      delta: -2500,
      unit: 'GBP',
    },
    currency: 'GBP',
    tradeOffs: [{ label: 'Picks the hook makes', from: 40, to: 52, delta: 12, unit: 'picks' }],
    write: 'system' as const,
    ...overrides,
  }
  // The key is a consequence of the decision, so the fixture recomputes it from the merged
  // halves rather than letting a stale key disagree with the alternative it claims to name.
  return { ...merged, key: savingKey(merged.class, merged.target, merged.alternative) }
}

function savings(
  proposals: SavingProposal[],
  classes?: FormworkSavings['classes'],
): FormworkSavings {
  const byClass = new Map<SavingClass, SavingProposal[]>()
  for (const entry of proposals) {
    byClass.set(entry.class, [...(byClass.get(entry.class) ?? []), entry])
  }
  return {
    currency: 'GBP',
    proposals,
    classes: classes ?? {
      substitution: { proposals: proposals.filter((entry) => entry.class === 'substitution') },
      cycle: { proposals: proposals.filter((entry) => entry.class === 'cycle') },
      reuse: { proposals: [] },
      'grid-relaxation': { proposals: [] },
      standardisation: { proposals: [] },
    },
  }
}

describe('savingKey', () => {
  test('a rate edit keeps the key — the money is never in it', () => {
    // The whole contract, and the opposite of `moveKey`: substituting grade A for grade B is
    // the same offer whether it saves £400 or £380 after a rate edit, so the key must not
    // move with the money. A key that did would refuse the proposal it printed the moment
    // the desk quoted a better price.
    const cheap = proposal({
      saving: { ...proposal().saving, from: 12000, to: 9500 },
    } as SavingProposal)
    const dearer = proposal({
      saving: { ...proposal().saving, from: 12000, to: 9800 },
    } as SavingProposal)
    expect(cheap.key).toBe(dearer.key)
  })

  test('a different alternative is a different proposal', () => {
    // The decision half: offering the same scope in a second candidate is a second offer,
    // and a key that did not change would let a reader take the wrong write by quoting the
    // first key.
    expect(savingKey('substitution', FRAMAX, TRIO)).not.toBe(
      savingKey('substitution', FRAMAX, 'doka-framax-xl'),
    )
  })

  test('a different class is a different proposal', () => {
    expect(savingKey('substitution', FRAMAX, TRIO)).not.toBe(
      savingKey('cycle', 'doka-framax-0.90x2.70', 'pour-2'),
    )
  })

  test('the money changing does not change the key, and the decision changing does', () => {
    // The two halves asserted against each other, so a refactor cannot quietly fix one at
    // the other's expense.
    const before = proposal().key
    const afterRateEdit = proposal({
      saving: { ...proposal().saving, to: 9400 },
    } as SavingProposal).key
    const afterDecisionChange = proposal({ alternative: 'doka-framax-xl' } as SavingProposal).key
    expect(afterRateEdit).toBe(before)
    expect(afterDecisionChange).not.toBe(before)
  })
})

describe('savingByKey', () => {
  test('finds the proposal the key names', () => {
    const read = savings([proposal()])
    expect(savingByKey(read, proposal().key)?.alternative).toBe(TRIO)
  })

  test('a superseded key finds nothing rather than the nearest proposal', () => {
    const read = savings([proposal()])
    expect(savingByKey(read, savingKey('substitution', FRAMAX, 'doka-framax-xl'))).toBe(undefined)
  })
})

describe('noSuchSaving', () => {
  test('names the key and the reason, rather than reporting a missing record', () => {
    const sentence = noSuchSaving('substitution|doka-framax-xlife|peri-trio')

    expect(sentence).toContain('substitution|doka-framax-xlife|peri-trio')
    expect(sentence).toContain('superseded')
    expect(sentence).toContain('takeoff')
  })
})

describe('savingCaveats', () => {
  test('a read with proposals refuses a total and states mutual exclusivity', () => {
    const caveats = savingCaveats(savings([proposal()]))

    expect(caveats.some((line) => line.includes('do not add up'))).toBe(true)
    expect(caveats.some((line) => line.includes('mutually exclusive'))).toBe(true)
  })

  test('a read with no proposals says nothing, not a clean bill of health', () => {
    expect(savingCaveats(savings([]))).toEqual([])
  })

  test('a class that could not be evaluated is named with its missing input', () => {
    const read = savings([proposal()], {
      substitution: { proposals: [proposal()] },
      cycle: { proposals: [] },
      reuse: {
        proposals: [],
        refusal: {
          kind: 'missing-input',
          needs: 'the per-pour quantities the set count was swept over',
        },
      },
      'grid-relaxation': {
        proposals: [],
        refusal: { kind: 'nothing-cheaper', note: 'The tie spacing is the design’s own.' },
      },
      standardisation: {
        proposals: [],
        refusal: {
          kind: 'missing-input',
          needs: 'the per-mark geometry',
        },
      },
    })

    const caveats = savingCaveats(read)
    expect(caveats.some((line) => line.includes('could not be evaluated'))).toBe(true)
    expect(caveats.some((line) => line.includes('per-pour quantities'))).toBe(true)
    expect(caveats.some((line) => line.includes('per-mark geometry'))).toBe(true)
  })

  test('every class has an outcome on the read, so no class is silently absent', () => {
    const read = savings([])
    for (const savingClass of SAVING_CLASSES) {
      expect(read.classes[savingClass]).toBeDefined()
    }
  })
})
