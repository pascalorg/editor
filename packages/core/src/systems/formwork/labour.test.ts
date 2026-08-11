import { describe, expect, it } from 'bun:test'
import { FormworkPartKindChoice } from '../../schema/nodes/formwork-project-settings'
import { bomLabour, bomLabourCaveats, type NormTable } from './labour'
import { type BomLine, KIND_ORDER } from './parts'

/**
 * The work in the job, as this project's own gang does it.
 *
 * The failure mode is the same one the money guards against and worse: an hours total
 * reads as a programme. Every figure here is a stated norm times a quantity this engine
 * derived, so the way it goes wrong is a norm table with holes in it that totals cleanly
 * — a bill whose panels are normed and whose ties are not is short by every tie in the
 * job and says nothing about it. So the tests below are mostly about what is *missing*
 * from an answer rather than what is in it.
 */

const line = (over: Partial<BomLine> = {}): BomLine => ({
  kind: 'panel',
  catalogId: 'framax-0.60x2.70',
  description: 'Framax Xlife panel 0.60 x 2.70 m',
  provenance: 'standard',
  quantity: 10,
  unit: 'no',
  totalWeightKg: 100,
  marks: ['P1'],
  ...over,
})

const norms = (over: Partial<NormTable> = {}): NormTable => ({
  byPartKind: { panel: { erectHours: 0.4, strikeHours: 0.25 } },
  gangRatePerHour: 30,
  currency: 'GBP',
  ...over,
})

describe('bomLabour', () => {
  it('multiplies the norm by the fittings, erect and strike apart', () => {
    // 10 panels at 0.4 h to fit and 0.25 h to strike: 4 h and 2.5 h, not 6.5 h of
    // "handling" — the two happen weeks apart and a reader needs them separately.
    const labour = bomLabour([line({ quantity: 10 })], norms())

    expect(labour.erectHours).toBeCloseTo(4, 6)
    expect(labour.strikeHours).toBeCloseTo(2.5, 6)
    expect(labour.totalHours).toBeCloseTo(6.5, 6)
    expect(labour.cost).toBeCloseTo(6.5 * 30, 6)
    expect(labour.complete).toBe(true)
  })

  it('takes the bill quantity as fittings, not as panels owned', () => {
    // The multiplicand is what a gang is paid for, and a gang is paid each time it fits
    // one. A project bill is built from every shutter's parts, so a panel type on three
    // pours is already three in the quantity — which is the opposite of what `sets`
    // reports, where the peak is what to order.
    const once = bomLabour([line({ quantity: 10 })], norms())
    const thrice = bomLabour([line({ quantity: 30 })], norms())

    expect(thrice.totalHours).toBeCloseTo(once.totalHours * 3, 6)
    expect(thrice.byKind[0]?.fittings).toBe(30)
  })

  it('leaves an unnormed kind out of the hours and names its fittings', () => {
    // The case the module exists to report. Panels normed, ties not: the total is a
    // floor, and without `unnormedFittings` beside it there is nothing to say so.
    const bom = [line({ quantity: 10 }), line({ kind: 'tie', quantity: 60, catalogId: 'tie-15' })]

    const labour = bomLabour(bom, norms())

    expect(labour.totalHours).toBeCloseTo(6.5, 6)
    expect(labour.unnormedFittings).toBe(60)
    expect(labour.unnormedKinds).toEqual(['tie'])
    expect(labour.complete).toBe(false)
    expect(labour.gaps).toContain('no-norm')
    expect(labour.lines[1]?.totalHours).toBeUndefined()
  })

  it('counts half an operation where only one side is normed, and says which', () => {
    // Hours to erect and none to strike is real work already done, so the line carries
    // its erect hours rather than falling in with the kinds nobody normed at all. What
    // it must not do is read complete.
    const labour = bomLabour(
      [line({ quantity: 10 })],
      norms({ byPartKind: { panel: { erectHours: 0.4 } } }),
    )

    expect(labour.erectHours).toBeCloseTo(4, 6)
    expect(labour.strikeHours).toBe(0)
    expect(labour.totalHours).toBeCloseTo(4, 6)
    expect(labour.unnormedFittings).toBe(0)
    expect(labour.gaps).toContain('erect-only')
    expect(labour.complete).toBe(false)
  })

  it('carries no hours for a line measured in its own unit', () => {
    // 12 litres of release agent. Applying it is real work and "hours per fitting" has
    // no meaning against a litre, so 12 × an hours-per-panel figure is a number with no
    // interpretation — reported rather than multiplied.
    const labour = bomLabour(
      [line({ kind: 'consumable', quantity: 12, unit: 'L', catalogId: 'release-agent' })],
      norms({ byPartKind: { consumable: { erectHours: 0.5, strikeHours: 0.5 } } }),
    )

    expect(labour.totalHours).toBe(0)
    expect(labour.gaps).toEqual(['not-counted-in-fittings'])
    // Not in `unnormedFittings` either: the norm is not what is missing, and filling in
    // the table would not change this line.
    expect(labour.unnormedFittings).toBe(0)
  })

  it('reports hours with no money where no gang rate is recorded', () => {
    const labour = bomLabour([line({ quantity: 10 })], norms({ gangRatePerHour: undefined }))

    expect(labour.totalHours).toBeCloseTo(6.5, 6)
    expect(labour.cost).toBeUndefined()
    expect(labour.byKind[0]?.cost).toBeUndefined()
    expect(labour.gaps).toContain('no-gang-rate')
  })

  it('groups by kind, most hours first', () => {
    // A bill has two hundred lines and a gang has five operations, so the per-kind
    // readout is the one that says where the time goes. Props here beat panels because
    // there are more of them, whatever order the bill is in.
    const bom = [
      line({ quantity: 10 }),
      line({ kind: 'prop', quantity: 200, catalogId: 'prop-eu', description: 'Prop' }),
    ]

    const labour = bomLabour(
      bom,
      norms({
        byPartKind: {
          panel: { erectHours: 0.4, strikeHours: 0.25 },
          prop: { erectHours: 0.1, strikeHours: 0.05 },
        },
      }),
    )

    expect(labour.byKind.map((entry) => entry.kind)).toEqual(['prop', 'panel'])
    expect(labour.byKind[0]?.totalHours).toBeCloseTo(30, 6)
    expect(labour.byKind[0]?.cost).toBeCloseTo(900, 6)
  })

  it('sums two lines of one kind into one row', () => {
    // Two panel sizes are two bill lines and one operation to a carpenter, which is the
    // whole reason a norm is keyed by kind rather than by catalog id.
    const bom = [
      line({ quantity: 10 }),
      line({ quantity: 4, catalogId: 'framax-0.90x2.70', description: 'Framax 0.90' }),
    ]

    const labour = bomLabour(bom, norms())

    expect(labour.byKind).toHaveLength(1)
    expect(labour.byKind[0]?.fittings).toBe(14)
    expect(labour.byKind[0]?.totalHours).toBeCloseTo(14 * 0.65, 6)
  })

  it('treats an empty norm as no norm', () => {
    // A row somebody opened and left blank prices the same as one nobody opened, and
    // reporting it as normed with zero hours would put the panels in a total that reads
    // complete.
    const labour = bomLabour([line({ quantity: 10 })], norms({ byPartKind: { panel: {} } }))

    expect(labour.totalHours).toBe(0)
    expect(labour.unnormedFittings).toBe(10)
    expect(labour.complete).toBe(false)
  })

  it('carries the currency through so a figure is never a bare number', () => {
    expect(bomLabour([line()], norms()).currency).toBe('GBP')
    expect(bomLabour([line()], norms({ currency: undefined })).currency).toBeUndefined()
  })
})

describe('the norm table and the part kinds', () => {
  it('can state a norm against every kind a bill can carry', () => {
    // The schema layer sits below the systems layer and cannot import `FormworkPartKind`,
    // so the enum is a copy. This is what stops a thirteenth kind arriving with nowhere
    // to record its hours — which would not fail anywhere else: the line would simply be
    // unnormed for the rest of the project's life.
    expect([...FormworkPartKindChoice.options].sort()).toEqual([...KIND_ORDER].sort())
  })
})

describe('bomLabourCaveats', () => {
  it('says these are man-hours rather than a duration, first', () => {
    // The misreading the whole block exists against: 400 hours is not ten days until
    // somebody says how many people are on it, and nothing in this model knows.
    const out = bomLabourCaveats(bomLabour([line()], norms()))

    expect(out[0]).toContain('man-hours')
    expect(out[0]).toContain('gang size')
  })

  it('says what is not in the hours at all', () => {
    const out = bomLabourCaveats(bomLabour([line()], norms())).join(' ')

    expect(out).toContain('cleaning')
    expect(out).toContain('setting out')
    expect(out).toContain('learning curve')
  })

  it('says the total is a floor where a kind carries no norm', () => {
    const bom = [line({ quantity: 10 }), line({ kind: 'tie', quantity: 60, catalogId: 'tie-15' })]

    const out = bomLabourCaveats(bomLabour(bom, norms())).join(' ')

    expect(out).toContain('60 fittings carry no norm')
    expect(out).toContain('tie')
    expect(out).toContain('floor')
  })

  it('says the hours carry no money where no rate is recorded, and what does', () => {
    const withoutRate = bomLabourCaveats(
      bomLabour([line()], norms({ gangRatePerHour: undefined })),
    ).join(' ')
    const withRate = bomLabourCaveats(bomLabour([line()], norms())).join(' ')

    expect(withoutRate).toContain('No gang rate is recorded')
    expect(withRate).toContain('not the cost of the trade')
    expect(withRate).not.toContain('No gang rate is recorded')
  })

  it('has nothing to say about an empty scope', () => {
    // A warning about gang size against no hours is noise, and noise is how a reader
    // learns to skip the block that carries the real ones.
    expect(bomLabourCaveats(bomLabour([], norms()))).toEqual([])
  })
})
