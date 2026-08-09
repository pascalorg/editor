import { describe, expect, test } from 'bun:test'
import {
  applyPourLimitsPatch,
  describeFormworkReconciliation,
  describePourSplit,
} from './pour-patch'
import type { PourUnit } from './pours'

/**
 * The pour write contract, and the words a rebuild is reported in.
 *
 * `pours/` owns where the cuts fall and `attach.test.ts` owns which shutters survive a
 * reconcile. What is asserted here is the layer both AI surfaces read: what an agent may
 * state, what `null` means, and what the reply says about work the rebuild deleted. Each
 * of these fails silently on the surface that gets it wrong — a limit set on a slab
 * reported as "ok" reads as a slab about to be poured in bays, a reconcile that changed
 * nothing reported as a rebuild has the model claiming work it did not do, and a
 * discarded override nobody counts is a decision that disappears with no trace at all.
 */

const unit = (segmentIndex: number, liftIndex: number, volumeCuM = 1): PourUnit =>
  ({
    elementId: 'wall_1',
    segmentIndex,
    liftIndex,
    startAlong: 0,
    endAlong: 6,
    baseElevation: 0,
    topElevation: 3,
    volumeCuM,
    hasJointBelow: liftIndex > 0,
  }) as PourUnit

describe('the pour-limit write contract', () => {
  test('a call that states nothing is refused rather than recorded as a no-op', () => {
    const result = applyPourLimitsPatch('wall', {})

    expect(result.error).toContain('nothing to set')
    expect(result.writes).toBeUndefined()
  })

  test('a stated cap is written and read back in the words the reply uses', () => {
    const result = applyPourLimitsPatch('wall', { maxLiftHeight: 3 })

    expect(result.writes).toEqual({ maxLiftHeight: 3 })
    expect(result.changed).toEqual(['maxLiftHeight 3 m'])
  })

  test('null takes a cap off rather than storing it', () => {
    // The third state. An absent key means "leave this alone", so `null` has to spell
    // "unstate it" — otherwise a model can cap an element and never uncap it.
    const result = applyPourLimitsPatch('wall', { maxLiftHeight: null })

    expect(result.writes).toEqual({ maxLiftHeight: undefined })
    expect(Object.keys(result.writes ?? {})).toEqual(['maxLiftHeight'])
    expect(result.changed).toEqual(['maxLiftHeight cleared'])
  })

  test('an unmentioned limit is absent from the writes, so one cap does not clear another', () => {
    const result = applyPourLimitsPatch('wall', { maxPourLength: 7.5 })

    expect(result.writes).toEqual({ maxPourLength: 7.5 })
  })

  test('a limit on a slab is recorded with a caveat, not reported as a split', () => {
    // The schema accepts all three on a slab and the splitter ignores every one, so a
    // plain "ok" here reads as a slab about to be poured in bays.
    const result = applyPourLimitsPatch('slab', { maxLiftHeight: 0.2 })

    expect(result.error).toBeUndefined()
    expect(result.writes).toEqual({ maxLiftHeight: 0.2 })
    expect(result.caveat).toContain('one pour')
  })

  test('clearing a limit on a slab says nothing about splitting it', () => {
    const result = applyPourLimitsPatch('slab', { maxLiftHeight: null })

    expect(result.caveat).toBeUndefined()
  })
})

describe('describePourSplit', () => {
  test('one unit is one pour, with no dimensions to recite', () => {
    expect(describePourSplit([unit(0, 0)])).toBe('cast in one pour')
  })

  test('lifts and bays are counted separately, because they cost differently', () => {
    const units = [unit(0, 0, 2), unit(0, 1, 2), unit(1, 0, 2), unit(1, 1, 2)]

    const said = describePourSplit(units)

    expect(said).toContain('cast in 4 pours')
    expect(said).toContain('2 bays along it')
    expect(said).toContain('2 lifts up it')
    expect(said).toContain('8 m³ total')
  })
})

describe('describeFormworkReconciliation', () => {
  const counts = (over: Partial<Parameters<typeof describeFormworkReconciliation>[0]> = {}) =>
    describeFormworkReconciliation({
      existing: 0,
      keep: 0,
      create: 1,
      orphan: 0,
      discardedPartDecisions: 0,
      joints: 0,
      ...over,
    })

  test('a first attach of one shutter says nothing about keeping anything', () => {
    expect(counts()).toBe('ok')
  })

  test('a first attach of several names the joints between them', () => {
    // The joints are the work the split creates, and they are invisible in a shutter
    // count — a user told "3 assemblies" has no reason to expect two roughened faces
    // with starters through them.
    const said = counts({ create: 3, joints: 2 })

    expect(said).toContain('3 assemblies')
    expect(said).toContain('2 construction joints')
  })

  test('a re-attach that changed nothing says so, and says the decisions survived', () => {
    // Without this the model reports a rebuild, and the user believes a shutter they had
    // edited was replaced.
    const said = counts({ existing: 2, keep: 2, create: 0 })

    expect(said).toContain('unchanged')
    expect(said).toContain('intact')
  })

  test('added and kept are separate counts, because only one of them is new work', () => {
    const said = counts({ existing: 1, keep: 1, create: 2 })

    expect(said).toContain('2 added')
    expect(said).toContain('1 kept with its part decisions')
  })

  test('a removal counts the decisions it destroyed and tells the model to pass it on', () => {
    // The only trace. An orphaned shutter's overrides die with the node, so a count that
    // stayed in the payload and out of the sentence is a decision nobody hears about.
    const said = counts({ existing: 3, keep: 1, create: 0, orphan: 2, discardedPartDecisions: 1 })

    expect(said).toContain('2 removed')
    expect(said).toContain('discarding 1 part decision')
    expect(said).toContain('say so')
  })

  test('a removal that cost nothing does not invent a loss', () => {
    const said = counts({ existing: 3, keep: 1, create: 0, orphan: 2 })

    expect(said).toContain('2 removed')
    expect(said).not.toContain('discarding')
  })
})
