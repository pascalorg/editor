import { describe, expect, it } from 'bun:test'
import { DOKA_FRAMAX_XLIFE, type FormworkSystem, type PanelType, PERI_TRIO } from '../catalog'
import { formworkRelayoutCaveats, relayoutForCrane } from './relayout'

/**
 * What happens when a gang does not lift.
 *
 * `gangs.test.ts` owns the grouping and the pick weight, so nothing here re-derives
 * either. What is left to get wrong is the *decision*: re-laying a face that already
 * lifted spends panels on nobody's objective, taking the narrowest layout instead of the
 * widest that clears spends them on a lift that is already made, and accepting a layout
 * whose gangs have no weight at all reports the failing check as passed.
 */

/** A synthetic system for the cases the real catalogs cannot reach. */
function systemWith(panels: PanelType[]): FormworkSystem {
  const template = DOKA_FRAMAX_XLIFE.panels.find(
    (panel) => panel.heightMm === 2700 && panel.widthMm === 1350,
  ) as PanelType
  return {
    ...DOKA_FRAMAX_XLIFE,
    id: 'synthetic',
    panels: panels.map((panel) => ({ ...template, ...panel })),
    fillers: [],
  }
}

function panel(widthMm: number, weightKg: number): PanelType {
  return {
    widthMm,
    weightKg,
    id: `synthetic-${widthMm}`,
    label: `Synthetic ${widthMm}`,
  } as PanelType
}

describe('a face that already lifts is left exactly as it was laid out', () => {
  it('does not re-lay a face with no stated limits at all', () => {
    // The single 2.7 m panel is a 416 kg pick and perfectly correct with no crane
    // stated. Narrowing it here would be an invented division, which is the same
    // refusal `gangFace` makes about boundaries.
    const relayout = relayoutForCrane(DOKA_FRAMAX_XLIFE, { runMm: 2700, liftHeightMm: 2700 }, {})

    expect(relayout.gangs.gangs).toHaveLength(1)
    expect(relayout.gangs.gangs[0]?.pickWeightKg).toBe(416)
    expect(relayout.attempts).toEqual([])
    expect(relayout.forcedByCrane).toBeUndefined()
    expect(relayout.preferredWidthMm).toBeUndefined()
  })

  it('does not re-lay a face whose gangs are inside the limits', () => {
    const relayout = relayoutForCrane(
      DOKA_FRAMAX_XLIFE,
      { runMm: 2700, liftHeightMm: 2700 },
      { maxPickWeightKg: 900 },
    )

    expect(relayout.attempts).toEqual([])
    expect(relayout.forcedByCrane).toBeUndefined()
    expect(formworkRelayoutCaveats(relayout)).toEqual([])
  })

  it('leaves a face alone whose gangs break a limit but split at a joint by themselves', () => {
    // 5.4 m of Framax packs as two 2.7 m panels, and a 500 kg limit breaks it at the
    // joint that is already there. Nothing has to be re-laid for that, and no attempt
    // is recorded, because `gangFace` did the whole job.
    const relayout = relayoutForCrane(
      DOKA_FRAMAX_XLIFE,
      { runMm: 5400, liftHeightMm: 2700 },
      { maxPickWeightKg: 500 },
    )

    expect(relayout.gangs.gangs).toHaveLength(2)
    expect(relayout.attempts).toEqual([])
    expect(relayout.forcedByCrane).toBeUndefined()
  })
})

describe('a face that does not lift is re-laid in narrower panels', () => {
  it('takes the widest cap that clears, not the narrowest that would', () => {
    // 416 kg against 300 kg. Capping at 2400 gives two 1350 panels at 210 kg each and
    // that is where it stops: 900 mm panels would give 126.5 kg picks and cost a third
    // panel to buy capacity the crane does not need.
    const relayout = relayoutForCrane(
      DOKA_FRAMAX_XLIFE,
      { runMm: 2700, liftHeightMm: 2700 },
      { maxPickWeightKg: 300 },
    )

    expect(relayout.preferredWidthMm).toBe(2400)
    expect(relayout.forcedByCrane).toBe(true)
    expect(relayout.gangs.gangs.map((gang) => gang.pickWeightKg)).toEqual([210, 210])
    expect(relayout.gangs.gangs.every((gang) => gang.overLimit === undefined)).toBe(true)
    expect(relayout.extraPanels).toBe(1)
    expect(relayout.stillOverLimit).toBeUndefined()
  })

  it('walks down the ladder until one clears, recording what it rejected', () => {
    // 150 kg needs 900 mm panels, and the two caps between are recorded with the reason
    // rather than dropped — a report that shows only the answer cannot show that a
    // wider layout was tried.
    const relayout = relayoutForCrane(
      DOKA_FRAMAX_XLIFE,
      { runMm: 2700, liftHeightMm: 2700 },
      { maxPickWeightKg: 150 },
    )

    expect(relayout.preferredWidthMm).toBe(900)
    expect(relayout.attempts.map((attempt) => attempt.preferredWidthMm)).toEqual([2400, 1350, 900])
    expect(relayout.attempts.slice(0, 2).map((attempt) => attempt.rejectedBecause)).toEqual([
      'still-over-limit',
      'still-over-limit',
    ])
    expect(relayout.attempts.at(-1)?.rejectedBecause).toBeUndefined()
    expect(relayout.extraPanels).toBe(2)
  })

  it('re-lays for a width limit too, since the road is a limit like the hook is', () => {
    const relayout = relayoutForCrane(
      DOKA_FRAMAX_XLIFE,
      { runMm: 2700, liftHeightMm: 2700 },
      { maxWidthMm: 1000 },
    )

    expect(relayout.preferredWidthMm).toBe(900)
    expect(relayout.gangs.gangs.every((gang) => gang.widthMm <= 1000)).toBe(true)
  })

  it('re-lays every course of a stack, not only the base one', () => {
    // 5.4 m of lift is two courses, so a 500 kg limit is over a two-high gang and the
    // cap has to reach both — a re-layout that narrowed one course would stagger the
    // joints, which is the thing the whole layout exists to avoid.
    const relayout = relayoutForCrane(
      DOKA_FRAMAX_XLIFE,
      { runMm: 5400, liftHeightMm: 5400 },
      { maxPickWeightKg: 500 },
    )

    expect(relayout.forcedByCrane).toBe(true)
    expect(relayout.face.courses).toHaveLength(2)
    expect(relayout.face.staggeredCourseIndices).toEqual([])
    expect(relayout.gangs.gangs.map((gang) => gang.pickWeightKg)).toEqual([420, 420, 420, 420])
  })

  it('works the same on a system with different widths', () => {
    const relayout = relayoutForCrane(
      PERI_TRIO,
      { runMm: 4800, liftHeightMm: 2700 },
      { maxPickWeightKg: 200 },
    )

    expect(relayout.preferredWidthMm).toBe(1200)
    expect(relayout.gangs.gangs.map((gang) => gang.pickWeightKg)).toEqual([162, 162, 162, 162])
  })
})

describe('the two narrower layouts that look like improvements', () => {
  it('refuses one that leaves concrete unformed, however light its picks', () => {
    // 2.7 m built from 1 m panels leaves 700 mm nothing in this system closes. Two
    // 150 kg picks against a 200 kg limit reads as a solved problem, and it is a
    // blowout.
    const system = systemWith([panel(2700, 400), panel(1000, 150)])
    const relayout = relayoutForCrane(
      system,
      { runMm: 2700, liftHeightMm: 2700 },
      {
        maxPickWeightKg: 200,
      },
    )

    expect(relayout.attempts).toHaveLength(1)
    expect(relayout.attempts[0]?.rejectedBecause).toBe('unformed-strip')
    expect(relayout.stillOverLimit).toBe(true)
    expect(relayout.face.unfilledMm).toBe(0)
    expect(relayout.gangs.gangs[0]?.pickWeightKg).toBe(400)
  })

  it('refuses one that swaps a failing check for no check at all', () => {
    // 450 mm capped at 300 comes back as a cut board, which has no catalog weight —
    // so the gang has no pick weight, and a gang with no weight is over no limit. The
    // narrower layout would report the failure gone rather than fixed.
    const relayout = relayoutForCrane(
      DOKA_FRAMAX_XLIFE,
      { runMm: 450, liftHeightMm: 2700 },
      { maxPickWeightKg: 40 },
    )

    expect(
      relayout.attempts.some((attempt) => attempt.rejectedBecause === 'loses-pick-weight'),
    ).toBe(true)
    expect(relayout.stillOverLimit).toBe(true)
    expect(relayout.gangs.totalWeightKg).toBe(77.7)
  })
})

describe('when no width in the system is enough', () => {
  it('comes back as the layout it started from, and says so', () => {
    // Not the narrowest layout tried: that one does not lift either, and shipping it
    // would have spent 9 panels to fail the same check the original failed with 1.
    const relayout = relayoutForCrane(
      DOKA_FRAMAX_XLIFE,
      { runMm: 2700, liftHeightMm: 2700 },
      { maxPickWeightKg: 50 },
    )

    expect(relayout.stillOverLimit).toBe(true)
    expect(relayout.forcedByCrane).toBeUndefined()
    expect(relayout.preferredWidthMm).toBeUndefined()
    expect(relayout.gangs.gangs).toHaveLength(1)
    expect(relayout.attempts.at(-1)?.preferredWidthMm).toBe(300)
    expect(relayout.attempts.every((attempt) => attempt.rejectedBecause !== undefined)).toBe(true)
  })
})

describe('formworkRelayoutCaveats', () => {
  it('says the crane made the decision, and what it cost', () => {
    const relayout = relayoutForCrane(
      DOKA_FRAMAX_XLIFE,
      { runMm: 2700, liftHeightMm: 2700 },
      { maxPickWeightKg: 150 },
    )
    const caveats = formworkRelayoutCaveats(relayout)

    expect(caveats[0]).toContain('900 mm')
    expect(caveats[0]).toContain('could not be lifted')
    expect(caveats.some((line) => line.includes('2 more panels'))).toBe(true)
  })

  it('says the face is past a layout problem where nothing clears', () => {
    const relayout = relayoutForCrane(
      DOKA_FRAMAX_XLIFE,
      { runMm: 2700, liftHeightMm: 2700 },
      { maxPickWeightKg: 50 },
    )
    const caveats = formworkRelayoutCaveats(relayout)

    expect(caveats).toHaveLength(1)
    expect(caveats[0]).toContain('down to 300 mm')
    expect(caveats[0]).toContain('not a layout problem any more')
  })

  it('names a layout rejected for having no weight rather than for being heavy', () => {
    // 5.07 m capped at 2400 comes back as a 2400 and a cut board, so that attempt had
    // no pick weight at all. The search carried on to 600 mm and cleared, and the
    // caveat has to say why the wider one was dropped: otherwise a reader looking at 9
    // panels where 2 would have fitted the wall reads it as the crane being weak.
    const relayout = relayoutForCrane(
      DOKA_FRAMAX_XLIFE,
      { runMm: 5070, liftHeightMm: 2700 },
      { maxPickWeightKg: 100 },
    )
    const caveats = formworkRelayoutCaveats(relayout)

    expect(relayout.attempts[0]?.rejectedBecause).toBe('loses-pick-weight')
    expect(relayout.preferredWidthMm).toBe(600)
    expect(caveats.some((line) => line.includes('cut on site'))).toBe(true)
  })
})
