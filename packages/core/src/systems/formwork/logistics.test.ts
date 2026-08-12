import { describe, expect, it } from 'bun:test'
import type { FormworkLifts } from './lifts'
import { formworkLogistics, formworkLogisticsCaveats } from './logistics'

/**
 * Getting the formwork to the job and off the lorry.
 *
 * Two sweeps over two quantities, and the tests below are mostly about keeping them
 * apart: a job of 60 t in 30 picks and one of 60 t in 300 deliver the same and lift ten
 * times as much, so a single "logistics" figure would answer neither. The other half is
 * the rounding — a load is a lorry, and 8.2 t against an 8 t payload is two of them.
 */

const lifts = (pickCount: number): FormworkLifts => ({
  picks: [],
  pickCount,
  unweighedPicks: 0,
  overChartPicks: 0,
  positionPicks: 0,
  overHookHeightPicks: 0,
})

const weight = (totalKg: number, complete = true) => ({ totalKg, complete })

describe('formworkLogistics', () => {
  it('counts a part-load as a whole lorry, out and back', () => {
    // 8,200 kg on an 8,000 kg payload is two lorries, and the second is invoiced at what
    // the first was. Rounding down or pro-rating would come out under every real invoice.
    const out = formworkLogistics(
      weight(8200),
      undefined,
      { lorryPayloadKg: 8000 },
      { transportPerLoad: 400 },
    )

    expect(out.outboundLoads).toBe(2)
    expect(out.returnLoads).toBe(2)
    expect(out.totalLoads).toBe(4)
    expect(out.transportCost).toBe(1600)
    expect(out.weighedKg).toBe(8200)
  })

  it('sends no lorry for a bill of nothing', () => {
    const out = formworkLogistics(weight(0), undefined, { lorryPayloadKg: 8000 }, undefined)

    expect(out.outboundLoads).toBe(0)
    expect(out.totalLoads).toBe(0)
  })

  it('rounds the returning lorries up too, because a third of a lorry does not come back', () => {
    // Six loads out at a third returning is two whole lorries, not two point nought.
    const out = formworkLogistics(
      weight(48_000),
      undefined,
      { lorryPayloadKg: 8000, returnLoadFraction: 1 / 3 },
      undefined,
    )

    expect(out.outboundLoads).toBe(6)
    expect(out.returnLoads).toBe(2)
    expect(out.totalLoads).toBe(8)
  })

  it('takes the hook time off the picks and not off the weight', () => {
    // The whole reason a pick count had to exist first. Same tonnage, ten times the picks,
    // same delivery and ten times the craneage.
    const few = formworkLogistics(
      weight(60_000),
      lifts(30),
      { lorryPayloadKg: 20_000, minutesPerPick: 20 },
      { transportPerLoad: 400, cranePerHour: 120 },
    )
    const many = formworkLogistics(
      weight(60_000),
      lifts(300),
      { lorryPayloadKg: 20_000, minutesPerPick: 20 },
      { transportPerLoad: 400, cranePerHour: 120 },
    )

    expect(many.transportCost).toBe(few.transportCost)
    expect(few.craneHours).toBeCloseTo(10, 6)
    expect(many.craneHours).toBeCloseTo(100, 6)
    expect(many.craneCost).toBeCloseTo((few.craneCost ?? 0) * 10, 6)
  })

  it('prices what it can and reports the rate that is missing', () => {
    const out = formworkLogistics(
      weight(16_000),
      lifts(10),
      { lorryPayloadKg: 8000, minutesPerPick: 30 },
      { transportPerLoad: 400 },
    )

    expect(out.transportCost).toBe(1600)
    expect(out.craneHours).toBeCloseTo(5, 6)
    expect(out.craneCost).toBeUndefined()
    // The total is what was priced rather than the sum of both halves — a craneage of zero
    // beside a real transport figure is a job with a free crane.
    expect(out.totalCost).toBe(1600)
    expect(out.gaps).toEqual(['no-crane-rate'])
    expect(out.complete).toBe(false)
  })

  it('carries no money at all where neither rate is recorded', () => {
    const out = formworkLogistics(
      weight(16_000),
      lifts(10),
      { lorryPayloadKg: 8000, minutesPerPick: 30 },
      undefined,
    )

    expect(out.totalLoads).toBe(4)
    expect(out.craneHours).toBeCloseTo(5, 6)
    expect(out.totalCost).toBeUndefined()
    expect(out.gaps).toEqual(['no-transport-rate', 'no-crane-rate'])
  })

  it('keeps the two halves independent — a payload with no cycle time is loads and no hours', () => {
    const loadsOnly = formworkLogistics(
      weight(16_000),
      lifts(10),
      { lorryPayloadKg: 8000 },
      { transportPerLoad: 400, cranePerHour: 120 },
    )
    const hoursOnly = formworkLogistics(
      weight(16_000),
      lifts(10),
      { minutesPerPick: 30 },
      { transportPerLoad: 400, cranePerHour: 120 },
    )

    expect(loadsOnly.transportCost).toBe(1600)
    expect(loadsOnly.craneHours).toBeUndefined()
    expect(loadsOnly.gaps).toEqual(['no-cycle-time'])

    expect(hoursOnly.craneCost).toBeCloseTo(600, 6)
    expect(hoursOnly.totalLoads).toBeUndefined()
    expect(hoursOnly.payloadKg).toBeUndefined()
    expect(hoursOnly.gaps).toEqual(['no-payload'])
  })

  it('says nothing is ganged rather than timing a crane with no picks', () => {
    // An unganged job is craned in pieces this cannot count, and zero hook hours reads as
    // a crane with nothing to do.
    const out = formworkLogistics(
      weight(16_000),
      undefined,
      { lorryPayloadKg: 8000, minutesPerPick: 30 },
      { transportPerLoad: 400, cranePerHour: 120 },
    )

    expect(out.craneHours).toBeUndefined()
    expect(out.pickCount).toBeUndefined()
    expect(out.gaps).toEqual(['nothing-ganged'])
  })

  it('makes an incomplete bill weight a floor on the loads and leaves the hours alone', () => {
    // The asymmetry worth a test: a cycle is timed per pick rather than per kilo, so an
    // unweighed part shortens the tonnage the lorries are counted from and does not touch
    // the crane at all.
    const out = formworkLogistics(
      weight(16_000, false),
      lifts(10),
      { lorryPayloadKg: 8000, minutesPerPick: 30 },
      { transportPerLoad: 400, cranePerHour: 120 },
    )

    expect(out.gaps).toEqual(['weight-incomplete'])
    expect(out.craneHours).toBeCloseTo(5, 6)
    expect(out.complete).toBe(false)
  })
})

describe('formworkLogisticsCaveats', () => {
  it('says the loads are the fewest trips rather than a delivery schedule', () => {
    const out = formworkLogisticsCaveats(
      formworkLogistics(
        weight(16_000),
        lifts(10),
        { lorryPayloadKg: 8000, minutesPerPick: 30 },
        { transportPerLoad: 400, cranePerHour: 120 },
      ),
    )

    expect(out[0]).toContain('the fewest trips')
    expect(out.some((line) => line.includes('goes back to the yard'))).toBe(true)
  })

  it('warns that hook time on a tower crane charges the same crane twice', () => {
    const out = formworkLogisticsCaveats(
      formworkLogistics(
        weight(16_000),
        lifts(10),
        { lorryPayloadKg: 8000, minutesPerPick: 30 },
        { transportPerLoad: 400, cranePerHour: 120 },
      ),
    )

    expect(out.some((line) => line.includes('charged by the week'))).toBe(true)
    expect(out.some((line) => line.includes('rebar'))).toBe(true)
  })

  it('says nothing about a crane where there are no hours to charge', () => {
    const out = formworkLogisticsCaveats(
      formworkLogistics(weight(16_000), undefined, { lorryPayloadKg: 8000 }, undefined),
    )

    expect(out.some((line) => line.includes('charged by the week'))).toBe(false)
    expect(out.some((line) => line.includes('No charge per load'))).toBe(true)
  })
})
