import { describe, expect, test } from 'bun:test'
import { DOKA_FRAMAX_XLIFE, type FormworkSystem } from './catalog'
import { layOutFace } from './layout/courses'
import { type FaceGangs, gangFace } from './layout/gangs'
import { stackCourses } from './layout/stack'
import { packStrip } from './layout/strip-pack'
import { type ElementGangs, formworkLiftCaveats, formworkLifts } from './lifts'

/**
 * The lifting schedule, which is arithmetic over answers other modules gave.
 *
 * So the failures worth testing are not the arithmetic. They are the three ways a rollup
 * lies about its input: a pick counted twice or dropped as the walk crosses faces and
 * elements; an unweighed pick quietly excluded so a short schedule reads as a whole one;
 * and a summed pick weight appearing anywhere at all, which is a load nothing ever lifts
 * and the one figure here somebody hangs a crane off.
 *
 * Every fixture is real `gangFace` output rather than a hand-built pick, because the claim
 * under test in most of these is that this module agrees with the layout about where a gang
 * breaks and what it weighs. A hand-built gang satisfies the assertions and proves nothing.
 */

const face = (runMm: number, liftMm: number, system: FormworkSystem = DOKA_FRAMAX_XLIFE) =>
  layOutFace(system, { runMm, liftHeightMm: liftMm, kickerMm: 100 }).courses

/** One course of a stated height, for the runs where the stack is not the point. */
function oneCourse(runMm: number, heightMm: number, system: FormworkSystem = DOKA_FRAMAX_XLIFE) {
  const stack = stackCourses(system, heightMm, { kickerMm: 0, minFreeboardMm: 0 })
  return stack.courses.map((course) => ({
    course,
    pack: packStrip(system, runMm, { heightMm: course.panelHeightMm }),
  }))
}

/**
 * Three 416 kg picks off an 8.1 m face held to 4 m of transport width — the ordinary
 * shape: a face that divides, every pick the same weight, every one of them weighed.
 */
const threePicks = (): FaceGangs => gangFace(face(8100, 2600), { maxWidthMm: 4000 })

/** One 1248 kg pick: the same face with nothing stated, so it comes back undivided. */
const onePick = (): FaceGangs => gangFace(face(8100, 2600))

/** 4225 mm is 25 mm off every Framax width, so it packs a cut board nobody weighed. */
const unweighedPick = (): FaceGangs => gangFace(oneCourse(4225, 2700))

const element = (elementId: string, ...faces: FaceGangs[]): ElementGangs => ({ elementId, faces })

/** Worst 400 kg at the tip, best 1000 near the mast — small enough to fail a real gang. */
const SMALL_CHART = [
  { radiusM: 14, capacityKg: 1000 },
  { radiusM: 30, capacityKg: 400 },
]

/** 8 t at the mast, 2.2 t at the tip: the chart every pick in these fixtures clears. */
const BIG_CHART = [
  { radiusM: 14, capacityKg: 8000 },
  { radiusM: 40, capacityKg: 2200 },
]

describe('a schedule of no picks is absent rather than empty', () => {
  test('nothing ganged at all is undefined', () => {
    // A conventional carpenter's shutter is struck panel by panel and there is no assembly
    // to lift. A schedule of zero picks reads as a crane with nothing to do, which is a
    // claim about this crane rather than about how the job is built.
    expect(formworkLifts([])).toBeUndefined()
    expect(formworkLifts([element('wall_1')])).toBeUndefined()
  })

  test('a face too short to form is not a pick', () => {
    // `gangFace` returns no gangs for a 15 mm run, and a face carrying an empty gang list
    // must not become a row in a lifting schedule.
    const empty = gangFace(oneCourse(15, 2700))
    expect(empty.gangs).toHaveLength(0)
    expect(formworkLifts([element('wall_1', empty)])).toBeUndefined()
  })
})

describe('every pick on the job, and each of them once', () => {
  test('walks every face of every element, not the first of each', () => {
    // The rule `validate-project` states about the identical input: a 9 m wall in three
    // lifts is three sets of picks and the heavy one may be in any of them.
    const lifts = formworkLifts([
      element('wall_1', threePicks(), threePicks()),
      element('wall_2', onePick()),
    ])

    expect(lifts?.pickCount).toBe(7)
    expect(lifts?.picks).toHaveLength(7)
  })

  test('identical faces are not deduped, because two gangs are two lifts', () => {
    // Two lifts of the same wall are two assemblies craned in on two different days, and
    // a schedule that collapsed them would report half the picks the crane makes.
    const lifts = formworkLifts([element('wall_1', threePicks(), threePicks())])
    const first = lifts?.picks.filter((pick) => pick.faceNumber === 1) ?? []
    const second = lifts?.picks.filter((pick) => pick.faceNumber === 2) ?? []

    expect(first).toHaveLength(3)
    expect(second).toHaveLength(3)
  })

  test('numbers faces and gangs from 1, matching the validator wording', () => {
    // `face 2 gang 1` is what a report says, so a schedule that started at 0 would name a
    // different gang than the fault the user is holding.
    const lifts = formworkLifts([element('wall_1', threePicks())])

    expect(lifts?.picks.map((pick) => pick.faceNumber)).toEqual([1, 1, 1])
    expect(lifts?.picks.map((pick) => pick.gangNumber)).toEqual([1, 2, 3])
  })

  test('carries the gang geometry a rigger reads, off the layout', () => {
    const gangs = threePicks()
    const lifts = formworkLifts([element('wall_1', gangs)])
    const pick = lifts?.picks[0]

    expect(pick?.widthMm).toBe(Math.round(gangs.gangs[0]?.widthMm as number))
    expect(pick?.heightMm).toBe(Math.round(gangs.gangs[0]?.heightMm as number))
    expect(pick?.panelCount).toBe(gangs.gangs[0]?.panelCount as number)
    expect(pick?.minHookHeightMm).toBe(gangs.gangs[0]?.minHookHeightMm as number)
  })
})

describe('heaviest first, and never a sum', () => {
  test('sorts on the pick weight descending', () => {
    const lifts = formworkLifts([element('wall_1', threePicks()), element('wall_2', onePick())])
    const weights = lifts?.picks.map((pick) => pick.pickWeightKg) ?? []

    expect(weights).toEqual([1248, 416, 416, 416])
  })

  test('the heaviest pick is the largest single one, not the tonnage', () => {
    // The whole point of the block: 416 kg is what the crane is chosen against on this
    // face and 1248 kg is what the lorry brings. A crane sized on the second is three
    // times the crane the job needs.
    const gangs = threePicks()
    const lifts = formworkLifts([element('wall_1', gangs)])

    expect(lifts?.heaviestPickKg).toBe(416)
    expect(gangs.totalWeightKg).toBe(1248)
    expect(lifts?.heaviestPickKg).toBeLessThan(gangs.totalWeightKg as number)
  })

  test('holds no summed pick weight at all', () => {
    // Structural rather than behavioural, and deliberate: a field summing the picks is a
    // load nothing ever lifts, and its absence is what stops a surface printing one.
    const lifts = formworkLifts([element('wall_1', threePicks())])
    const keys = Object.keys(lifts ?? {})

    expect(keys.some((key) => /^total.*Kg$|^picksKg$|^sum/.test(key))).toBe(false)
  })

  test('breaks ties by element, then face, then gang, so the order is stable', () => {
    // Three identical picks per face: with nothing but the weight to sort on, a reader
    // comparing two exports of the same scene would see the rows move.
    const lifts = formworkLifts([
      element('wall_2', threePicks()),
      element('wall_1', threePicks(), threePicks()),
    ])

    expect(
      lifts?.picks.map((pick) => `${pick.elementId}/${pick.faceNumber}/${pick.gangNumber}`),
    ).toEqual([
      'wall_1/1/1',
      'wall_1/1/2',
      'wall_1/1/3',
      'wall_1/2/1',
      'wall_1/2/2',
      'wall_1/2/3',
      'wall_2/1/1',
      'wall_2/1/2',
      'wall_2/1/3',
    ])
  })
})

describe('an unweighed pick is counted, never estimated', () => {
  test('is in the schedule with a blank weight, and in the count', () => {
    // The crane still lifts it. A schedule that printed only the weighed picks would say
    // this job makes fewer lifts than it makes.
    const lifts = formworkLifts([element('wall_1', unweighedPick())])

    expect(lifts?.pickCount).toBe(1)
    expect(lifts?.unweighedPicks).toBe(1)
    expect(lifts?.picks[0]?.pickWeightKg).toBeUndefined()
    expect(lifts?.heaviestPickKg).toBeUndefined()
  })

  test('sorts last rather than first, because it is the unknown and not the largest', () => {
    const lifts = formworkLifts([
      element('wall_1', unweighedPick()),
      element('wall_2', threePicks()),
    ])

    expect(lifts?.picks.at(-1)?.pickWeightKg).toBeUndefined()
    expect(lifts?.picks[0]?.pickWeightKg).toBe(416)
  })

  test('has no verdict even where a chart is recorded', () => {
    // Checked against nothing rather than passed: the alternative reads as a gang the
    // crane takes, over a weight nobody stated.
    const lifts = formworkLifts([element('wall_1', unweighedPick())], {
      capacityCurve: SMALL_CHART,
    })

    expect(lifts?.picks[0]?.verdict).toBeUndefined()
    expect(lifts?.overChartPicks).toBe(0)
    expect(lifts?.positionPicks).toBe(0)
  })

  test('does not stop the weighed picks having a heaviest', () => {
    const lifts = formworkLifts([
      element('wall_1', unweighedPick()),
      element('wall_2', threePicks()),
    ])

    expect(lifts?.heaviestPickKg).toBe(416)
    expect(lifts?.unweighedPicks).toBe(1)
    expect(lifts?.pickCount).toBe(4)
  })
})

describe('what the chart says about each pick', () => {
  test('with no chart nothing is checked, and the crane block is absent', () => {
    // Not a schedule of picks that passed: every verdict is missing because there was
    // nothing to ask, and each face came back as one gang for the same reason.
    const lifts = formworkLifts([element('wall_1', onePick())])

    expect(lifts?.crane).toBeUndefined()
    expect(lifts?.picks[0]?.verdict).toBeUndefined()
    expect(lifts?.picks[0]?.liftsInsideM).toBeUndefined()
    expect(lifts?.overChartPicks).toBe(0)
    expect(lifts?.pickCount).toBe(1)
  })

  test('inside the worst figure lifts anywhere the jib reaches', () => {
    const lifts = formworkLifts([element('wall_1', threePicks())], { capacityCurve: BIG_CHART })

    expect(lifts?.picks.map((pick) => pick.verdict)).toEqual(['lifts', 'lifts', 'lifts'])
    expect(lifts?.positionPicks).toBe(0)
    expect(lifts?.overChartPicks).toBe(0)
  })

  test('over the worst and inside the best is a position, with the radius that takes it', () => {
    // 416 kg over a 400 kg tip and under a 1000 kg near-mast rating. The radius is the
    // published 14 m row rather than the interpolated crossing, because a rigger reads
    // rows and the line between them sits above the real sagging curve.
    const lifts = formworkLifts([element('wall_1', threePicks())], { capacityCurve: SMALL_CHART })

    expect(lifts?.picks[0]?.verdict).toBe('position')
    expect(lifts?.picks[0]?.liftsInsideM).toBe(14)
    expect(lifts?.positionPicks).toBe(3)
    expect(lifts?.overChartPicks).toBe(0)
  })

  test('a pick that lifts everywhere carries no radius, because the jib tip says nothing', () => {
    const lifts = formworkLifts([element('wall_1', threePicks())], { capacityCurve: BIG_CHART })

    expect(lifts?.picks[0]?.liftsInsideM).toBeUndefined()
  })

  test('over the best anywhere is over the chart, and carries no radius either', () => {
    // 1248 kg against a 1000 kg plateau: no radius on that jib takes it, so a radius here
    // would name a position where the lift still cannot be made.
    const lifts = formworkLifts([element('wall_1', onePick())], { capacityCurve: SMALL_CHART })

    expect(lifts?.picks[0]?.verdict).toBe('over-chart')
    expect(lifts?.picks[0]?.liftsInsideM).toBeUndefined()
    expect(lifts?.overChartPicks).toBe(1)
  })

  test('reports the chart it read, so a file says what it checked against', () => {
    const lifts = formworkLifts([element('wall_1', threePicks())], {
      capacityCurve: SMALL_CHART,
      hookHeightM: 30,
    })

    expect(lifts?.crane).toEqual({
      worstCapacityKg: 400,
      bestCapacityKg: 1000,
      reachFromM: 14,
      reachToM: 30,
      hookHeightMm: 30_000,
    })
  })
})

describe('the height under the hook, which is a third failure', () => {
  test('faults a gang whose slings want more height than the crane has', () => {
    // 8.1 m in one pick spreads the eyes 4.1 m above the gang at 60°, and a hook 3 m up
    // does not take it at any weight — the remedy is a lifting beam, not a lighter gang.
    const lifts = formworkLifts([element('wall_1', onePick())], {
      capacityCurve: BIG_CHART,
      hookHeightM: 3,
    })

    expect(lifts?.picks[0]?.minHookHeightMm).toBeGreaterThan(3000)
    expect(lifts?.picks[0]?.overHookHeight).toBe(true)
    expect(lifts?.overHookHeightPicks).toBe(1)
    // And it is not the weight: this pick lifts anywhere the jib reaches.
    expect(lifts?.picks[0]?.verdict).toBe('lifts')
  })

  test('leaves a gang inside the height alone', () => {
    const lifts = formworkLifts([element('wall_1', threePicks())], {
      capacityCurve: BIG_CHART,
      hookHeightM: 3,
    })

    expect(lifts?.picks.every((pick) => pick.overHookHeight === undefined)).toBe(true)
    expect(lifts?.overHookHeightPicks).toBe(0)
  })

  test('faults nothing where no height was recorded', () => {
    // Reported but not checked, which `formworkCraneCaveats` already says: a crane with no
    // stated hook height is not a crane with none.
    const lifts = formworkLifts([element('wall_1', onePick())], { capacityCurve: BIG_CHART })

    expect(lifts?.picks[0]?.minHookHeightMm).toBeGreaterThan(0)
    expect(lifts?.picks[0]?.overHookHeight).toBeUndefined()
    expect(lifts?.overHookHeightPicks).toBe(0)
  })
})

describe('a gang that breaks a limit with nowhere to break', () => {
  test('carries the layout own refusal through to the schedule', () => {
    // One 2.70 m panel against a 10 kg capacity: nothing inside it is a joint, so the
    // layout could not divide it and the schedule has to say the pick exists anyway.
    const stuck = gangFace(oneCourse(2700, 2700), { maxPickWeightKg: 10 })
    expect(stuck.gangs[0]?.overLimit).toBe(true)

    const lifts = formworkLifts([element('col_1', stuck)], { capacityCurve: SMALL_CHART })

    expect(lifts?.picks[0]?.overLimit).toBe(true)
    expect(lifts?.pickCount).toBe(1)
  })
})

describe('what the schedule says it is not', () => {
  test('always leads with what travels with a gang and is not in the figures', () => {
    // First rather than conditional: every pick in every schedule is short by the
    // steelwork, which on a steel-framed gang is around a fifth of the hook load.
    const lifts = formworkLifts([element('wall_1', threePicks())], { capacityCurve: BIG_CHART })
    const caveats = formworkLiftCaveats(lifts as never)

    expect(caveats[0]).toContain('Walers, ties')
    expect(caveats[0]).toContain('higher than what is printed')
  })

  test('says the heaviest pick is never a sum, where there is a heaviest', () => {
    const lifts = formworkLifts([element('wall_1', threePicks())], { capacityCurve: BIG_CHART })
    const caveats = formworkLiftCaveats(lifts as never)

    expect(caveats.some((line) => line.includes('416 kg'))).toBe(true)
    expect(caveats.some((line) => line.includes('a load nothing ever lifts'))).toBe(true)
  })

  test('says no pick was checked at all where no chart is recorded', () => {
    const lifts = formworkLifts([element('wall_1', threePicks())])
    const caveats = formworkLiftCaveats(lifts as never)

    expect(caveats.some((line) => line.includes('No load chart is recorded'))).toBe(true)
    expect(caveats.some((line) => line.includes('what the layout allows'))).toBe(true)
  })

  test('counts the unweighed picks against the total, not on their own', () => {
    // "1 of 4" rather than "1", because a bare count of gaps in a schedule of unstated
    // length is not something a reader can weigh.
    const lifts = formworkLifts([
      element('wall_1', unweighedPick()),
      element('wall_2', threePicks()),
    ])
    const caveats = formworkLiftCaveats(lifts as never)

    expect(caveats.some((line) => line.includes('1 of 4 picks have no weight'))).toBe(true)
  })

  test('says a position pick is a position rather than a fail', () => {
    const lifts = formworkLifts([element('wall_1', threePicks())], { capacityCurve: SMALL_CHART })
    const caveats = formworkLiftCaveats(lifts as never)
    const line = caveats.find((entry) => entry.includes('nearer the mast')) as string

    expect(line).toContain('3 picks lift')
    expect(line).toContain('rather than a layout to redo')
  })

  test('says an over-chart pick is a layout to redo, and how', () => {
    const lifts = formworkLifts([element('wall_1', onePick())], { capacityCurve: SMALL_CHART })
    const caveats = formworkLiftCaveats(lifts as never)
    const line = caveats.find((entry) => entry.includes('over the best figure')) as string

    expect(line).toContain('1 pick is')
    expect(line).toContain('narrower panels give more joints')
  })

  test('says the remedy for a hook height is hardware and not a lighter gang', () => {
    const lifts = formworkLifts([element('wall_1', onePick())], {
      capacityCurve: BIG_CHART,
      hookHeightM: 3,
    })
    const caveats = formworkLiftCaveats(lifts as never)
    const line = caveats.find((entry) => entry.includes('between the gang and the hook')) as string

    expect(line).toContain('1 pick wants')
    expect(line).toContain('lifting beam')
    expect(line).toContain('a flatter sling does not')
  })

  test('says nothing conditional about a schedule with none of those states', () => {
    // The clean case is one sentence, so the caveats above read as findings rather than
    // as boilerplate a reader learns to skip.
    const lifts = formworkLifts([element('wall_1', threePicks())], {
      capacityCurve: BIG_CHART,
      hookHeightM: 30,
    })

    expect(formworkLiftCaveats(lifts as never)).toHaveLength(2)
  })
})
