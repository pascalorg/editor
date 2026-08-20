import { describe, expect, it } from 'vitest'
import { lingo } from '../index'

function value(input: string) {
  const r = lingo(input, { kind: 'percent' })
  if (!r.ok || r.type !== 'quantity') {
    throw new Error(`expected quantity for ${input}`)
  }
  return r.quantity
}

describe('percent vocabulary', () => {
  it('parses %, pct, percent and per cent to the same unit', () => {
    for (const input of ['15%', '15 pct', '15pct', '15 percent', '15 per cent']) {
      const q = value(input)
      expect(q.unit).toBe('%')
      expect(q.value).toBe(15)
    }
  })

  it('parses percentage points as percent', () => {
    const q = value('2 percentage points')
    expect(q.unit).toBe('%')
    expect(q.value).toBe(2)
  })

  it('parses basis points at 0.01%', () => {
    const q = value('25 bps')
    expect(q.unit).toBe('bps')
    expect(q.to('%').value).toBeCloseTo(0.25, 12)
    expect(value('25 basis points').to('%').value).toBeCloseTo(0.25, 12)
  })

  it('resolves bare bps to percent (no other kind claims it)', () => {
    const r = lingo('100 bps')
    expect(r.ok && r.type === 'quantity' && r.quantity.kind === 'percent').toBe(true)
  })
})
