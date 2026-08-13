import { describe, expect, test } from 'bun:test'
import { moveKey, noSuchMove, resequenceMoveByKey } from './move-patch'
import type { FormworkResequence, ResequenceAnswer, ResequenceMove } from './resequence'
import { shiftDays } from './schedule'

/**
 * Naming one proposal so it can be taken.
 *
 * What is worth asserting here is not the string but the two properties the string has to
 * have, because both are the opposite of what `findingKey` needs and either would go unnoticed
 * in a passing implementation: a *changed shift* has to be a changed proposal, and the same
 * pour offered against two shortages has to be two proposals rather than one.
 */

const PANEL = 'doka-framax-0.90x2.70'
const PROP = 'eurex-20-300'

function move(overrides: Partial<ResequenceMove> = {}): ResequenceMove {
  return {
    pourId: 'b',
    members: ['b'],
    days: 8,
    fromDate: '2026-03-09',
    toDate: '2026-03-17',
    peakBefore: 60,
    peakAfter: 30,
    reduction: 30,
    shortfallAfter: 0,
    clearsShortage: true,
    raises: [],
    floatRemaining: 3,
    ...overrides,
  }
}

function answer(catalogId: string, moves: ResequenceMove[]): ResequenceAnswer {
  return {
    catalogId,
    description: catalogId === PANEL ? 'Framax panel 0.90 × 2.70' : 'Eurex 20 prop',
    peakOn: '2026-03-09',
    peakQuantity: 60,
    ownedQuantity: 40,
    shortfall: 20,
    moves,
    pinnedPourIds: [],
    committedPourIds: [],
  }
}

function resequence(...answers: ResequenceAnswer[]): FormworkResequence {
  return {
    answers,
    clearable: answers.filter((entry) => entry.moves.some((entry2) => entry2.clearsShortage)),
    unavoidable: answers.filter((entry) => !entry.moves.some((entry2) => entry2.clearsShortage)),
  }
}

describe('moveKey', () => {
  test('a different shift is a different proposal', () => {
    // The decision this file exists for, and the reverse of `findingKey`'s: the figure *is* the
    // act. A key that held only the pour would let a caller take a 35-day move by quoting a key
    // read when the engine was offering 30, and the write would land the pour on a day whose
    // float no longer exists.
    expect(moveKey(PANEL, move({ days: 8 }))).not.toBe(moveKey(PANEL, move({ days: 12 })))
  })

  test('the same pour against two shortages is two proposals', () => {
    // The same write and not the same decision: the reader accepted a move to relieve panels,
    // and whether it worked is a question about panels. The id is what the second measurement
    // is taken on.
    expect(moveKey(PANEL, move())).not.toBe(moveKey(PROP, move()))
  })

  test('the members are not in it, so a monolithic group can grow without staling the key', () => {
    // Membership is a property of the scene rather than of the proposal, and it is re-read when
    // the move is planned — which is where a changed group has to be caught, not here.
    expect(moveKey(PANEL, move({ members: ['b'] }))).toBe(
      moveKey(PANEL, move({ members: ['b', 'b2'] })),
    )
  })
})

describe('resequenceMoveByKey', () => {
  test('finds the move and the shortage it is against', () => {
    // Both, because the shortage is what the re-measurement is taken on: a caller handed the
    // move alone would have to remember which row it clicked to know what "cleared" means.
    const panels = answer(PANEL, [move()])
    const found = resequenceMoveByKey(resequence(panels), moveKey(PANEL, move()))

    expect(found?.answer.catalogId).toBe(PANEL)
    expect(found?.move.days).toBe(8)
  })

  test('a superseded key finds nothing rather than the nearest move', () => {
    const panels = answer(PANEL, [move({ days: 8 })])

    expect(resequenceMoveByKey(resequence(panels), moveKey(PANEL, move({ days: 12 })))).toBe(
      undefined,
    )
  })
})

describe('noSuchMove', () => {
  test('names the re-read and the reason, rather than reporting a missing record', () => {
    // The likeliest cause is not a typo: the proposal was real when it was read, and every
    // shift is measured against the other pours' stated dates.
    const sentence = noSuchMove('x|b|8')

    expect(sentence).toContain('x|b|8')
    expect(sentence).toContain('superseded')
    expect(sentence).toContain('inspect_project_formwork')
  })
})

describe('shiftDays', () => {
  test('lands a pour on the day the proposal measured, across a month end', () => {
    expect(shiftDays('2026-03-09', 8)).toBe('2026-03-17')
    expect(shiftDays('2026-02-25', 4)).toBe('2026-03-01')
    expect(shiftDays('2026-03-02', -4)).toBe('2026-02-26')
  })

  test('a date the calendar does not have shifts to nothing rather than rolling forward', () => {
    expect(shiftDays('2026-02-30', 1)).toBe(undefined)
  })
})
