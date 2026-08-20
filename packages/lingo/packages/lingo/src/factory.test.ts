import { afterEach, describe, expect, it } from 'vitest'
import { setDefaultMessages } from './core/index'
import { type CreateLingoOptions, createLingo, englishMessages, type KindDef, lingo } from './index'

const widgets: KindDef = {
  kind: 'widget',
  baseUnit: 'widget',
  units: [
    {
      id: 'widget',
      symbol: 'wdg',
      name: 'widget',
      factor: 1,
      system: 'shared',
      aliases: ['widgets'],
    },
    {
      id: 'dozen-widget',
      symbol: 'doz wdg',
      name: 'dozen widget',
      plural: 'dozen widgets',
      factor: 12,
      system: 'shared',
      aliases: ['dozen widgets'],
    },
  ],
}

describe('createLingo', () => {
  // Tests here mutate the global message pack to prove instances snapshot it;
  // restore the English default after each so a mid-test failure can't strand a
  // later test with an empty pack.
  afterEach(() => setDefaultMessages(englishMessages))

  it('returns an isolated parser/conversion instance', () => {
    const instance = createLingo({
      kinds: [widgets],
      messages: { NO_VALUE: 'Use a widget quantity.' },
    })

    const parsed = instance.parse('2 widgets')
    expect(instance.isQuantity(parsed)).toBe(true)
    if (instance.isQuantity(parsed)) {
      expect(parsed.quantity.kind).toBe('widget')
      expect(parsed.quantity.base).toBe(2)
    }

    expect(lingo('2 widgets').ok).toBe(false)
    expect(instance.quantity(1, 'doz wdg').base).toBe(12)
    expect(instance.convert(24, 'widget', 'dozen-widget')).toBe(2)
    expect(instance.convertDelta(2, 'dozen-widget', 'widget')).toBe(24)

    const failed = instance.parse('banana')
    expect(failed.ok).toBe(false)
    const issue = instance.firstError(failed)
    expect(issue?.message).toBe('Use a widget quantity.')
    expect(issue ? instance.formatIssue(issue) : '').toBe('Use a widget quantity.')
  })

  it('snapshots messages instead of following global or caller mutation', () => {
    const messages = { NO_VALUE: 'Before.' }
    const one = createLingo({ messages })
    const two = createLingo({ messages })
    messages.NO_VALUE = 'After.'

    expect(one.parse('banana').issues[0]?.message).toBe('Before.')
    expect(two.parse('banana').issues[0]?.message).toBe('Before.')

    const isolated = createLingo()
    setDefaultMessages({ NO_VALUE: 'Leaked.' })
    expect(isolated.parse('banana').issues[0]?.message).toContain('No number found')
    expect(lingo('banana').issues[0]?.message).toContain('No number found')
    expect(englishMessages.NO_VALUE).toContain('No number found')
  })

  it('snapshots kind and fuzzy definitions supplied to instances', () => {
    const blob: KindDef = {
      kind: 'blob',
      baseUnit: 'blob',
      units: [{ id: 'blob', symbol: 'blob', name: 'blob', factor: 1, system: 'shared' }],
    }
    const first = createLingo({ kinds: [blob] })
    const second = createLingo({ kinds: [blob] })
    blob.units[0]!.factor = 10

    const a = first.parse('2 blob')
    const b = second.parse('2 blob')
    expect(a.ok && a.type === 'quantity' ? a.quantity.base : Number.NaN).toBe(2)
    expect(b.ok && b.type === 'quantity' ? b.quantity.base : Number.NaN).toBe(2)

    const fuzzy: NonNullable<CreateLingoOptions['fuzzy']> = [
      {
        kind: 'mass',
        vocab: { profile: 'parcels', unit: 'kg', terms: { heavy: [20, 70] } },
      },
    ]
    const parcels = createLingo({ fuzzy })
    fuzzy[0]!.vocab.terms.heavy = [200, 700]
    const heavy = parcels.parse('heavy', { kind: 'mass', profile: 'parcels' })
    expect(heavy.ok && heavy.type === 'range' ? heavy.range.minBase : Number.NaN).toBe(20)
    expect(heavy.ok && heavy.type === 'range' ? heavy.range.maxBase : Number.NaN).toBe(70)
  })
})
