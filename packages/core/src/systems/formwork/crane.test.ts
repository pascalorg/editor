import { describe, expect, test } from 'bun:test'
import { craneCapacityAtM, craneReachM, formworkCraneCaveats, worstCraneCapacityKg } from './crane'

/**
 * Reading a load chart, where every wrong answer is a plausible number.
 *
 * Nothing here is arithmetic for its own sake. A chart read one row too far out reports a
 * gang liftable that is not, a radius past the jib tip read as "a small capacity" reports
 * a lift that cannot happen at all, and an unstated crane read as a crane that lifts
 * nothing fails every gang on a job that has no chart recorded yet. Those three are the
 * whole file.
 */

/** A 40 m jib rated 8 t at the mast and 2.2 t at the tip — the shape of a real chart. */
const CURVE = [
  { radiusM: 14, capacityKg: 8000 },
  { radiusM: 20, capacityKg: 5600 },
  { radiusM: 30, capacityKg: 3400 },
  { radiusM: 40, capacityKg: 2200 },
]

const crane = (curve = CURVE, extra: Record<string, unknown> = {}) => ({
  capacityCurve: curve,
  ...extra,
})

describe('craneCapacityAtM — the chart at a radius', () => {
  test('an unstated crane is undefined, not a crane that lifts nothing', () => {
    // The distinction the whole group exists for: a takeoff with no chart has not
    // checked its gangs, and must not report them as failing a check.
    expect(craneCapacityAtM(undefined, 20)).toBeUndefined()
    expect(craneCapacityAtM({}, 20)).toBeUndefined()
    expect(craneCapacityAtM(crane([]), 20)).toBeUndefined()
  })

  test('a radius that is a row reads that row exactly, with no interpolation flag', () => {
    expect(craneCapacityAtM(crane(), 20)).toEqual({ capacityKg: 5600 })
    expect(craneCapacityAtM(crane(), 40)).toEqual({ capacityKg: 2200 })
  })

  test('between two rows it reads the straight line, and says that it did', () => {
    // Halfway between 20 m and 30 m: 5600 and 3400 average to 4500.
    expect(craneCapacityAtM(crane(), 25)).toEqual({ capacityKg: 4500, interpolated: true })
  })

  test('inside the first row the chart is flat, because the rope rating governs there', () => {
    // Not extrapolated upward along the line through the first two rows, which at 8 m
    // would invent 12 t on a crane rated 8.
    expect(craneCapacityAtM(crane(), 8)).toEqual({ capacityKg: 8000 })
    expect(craneCapacityAtM(crane(), 14)).toEqual({ capacityKg: 8000 })
  })

  test('past the last row is out of reach rather than a small capacity', () => {
    // A gang at 46 m on a 40 m jib is not a heavy lift, it is a lift that cannot be
    // made — and an extrapolated 1500 kg there would read as one that can.
    expect(craneCapacityAtM(crane(), 46)).toEqual({ outOfReach: true })
    expect(craneCapacityAtM(crane(), 46)?.capacityKg).toBeUndefined()
  })

  test('a chart entered out of order still reads correctly', () => {
    const shuffled = [CURVE[3], CURVE[1], CURVE[0], CURVE[2]] as typeof CURVE

    expect(craneCapacityAtM(crane(shuffled), 25)).toEqual({
      capacityKg: 4500,
      interpolated: true,
    })
    expect(craneCapacityAtM(crane(shuffled), 46)).toEqual({ outOfReach: true })
  })

  test('a one-point chart is that one capacity inside it and out of reach beyond', () => {
    const single = [{ radiusM: 30, capacityKg: 3400 }]

    expect(craneCapacityAtM(crane(single), 12)).toEqual({ capacityKg: 3400 })
    expect(craneCapacityAtM(crane(single), 30)).toEqual({ capacityKg: 3400 })
    expect(craneCapacityAtM(crane(single), 31)).toEqual({ outOfReach: true })
  })
})

describe('worstCraneCapacityKg — what a gang is checked against with no radius', () => {
  test('the minimum on the chart, which on a real one is the jib tip', () => {
    expect(worstCraneCapacityKg(crane())).toBe(2200)
  })

  test('the minimum rather than the last point, so a flat outer section still governs', () => {
    // A chart whose outer rows are equal, or entered out of order, would give the
    // wrong figure if this trusted position instead of value.
    const flatOuter = [
      { radiusM: 40, capacityKg: 2200 },
      { radiusM: 14, capacityKg: 8000 },
      { radiusM: 35, capacityKg: 2200 },
    ]

    expect(worstCraneCapacityKg(crane(flatOuter))).toBe(2200)
  })

  test('an unstated crane has no worst capacity, so no check runs', () => {
    expect(worstCraneCapacityKg(undefined)).toBeUndefined()
    expect(worstCraneCapacityKg(crane([]))).toBeUndefined()
  })
})

describe('craneReachM', () => {
  test('the chart’s own ends, whatever order the rows arrived in', () => {
    expect(craneReachM(crane())).toEqual({ fromM: 14, toM: 40 })
    expect(craneReachM(crane([CURVE[3], CURVE[0]] as typeof CURVE))).toEqual({
      fromM: 14,
      toM: 40,
    })
  })

  test('no chart, no reach', () => {
    expect(craneReachM(undefined)).toBeUndefined()
  })
})

describe('formworkCraneCaveats — what the check does not cover', () => {
  test('with no crane, the caveat is that no gang was checked at all', () => {
    const caveats = formworkCraneCaveats(undefined)

    expect(caveats).toHaveLength(1)
    expect(caveats[0]).toContain('no gang in this takeoff has been checked')
  })

  test('with a chart, it names the figure used and that a nearer gang has more', () => {
    // The reading is deliberately the pessimistic one, so the caveat has to say so:
    // otherwise a gang reported over capacity looks like a gang that cannot be lifted.
    const caveats = formworkCraneCaveats(crane(CURVE, { hookHeightM: 40 }))

    expect(caveats.some((line) => line.includes('2200 kg'))).toBe(true)
    expect(caveats.some((line) => line.includes('may lift where it is actually being set'))).toBe(
      true,
    )
  })

  test('a sparse chart is called sparse, because interpolation reads optimistically', () => {
    const sparse = formworkCraneCaveats(
      crane([CURVE[0], CURVE[3]] as typeof CURVE, { hookHeightM: 40 }),
    )
    const full = formworkCraneCaveats(crane(CURVE, { hookHeightM: 40 }))

    expect(sparse.some((line) => line.includes('straight line'))).toBe(true)
    expect(full.some((line) => line.includes('straight line'))).toBe(false)
  })

  test('no height under the hook means the headroom is reported and not checked', () => {
    expect(
      formworkCraneCaveats(crane()).some((line) => line.includes('No height under the hook')),
    ).toBe(true)
  })
})
