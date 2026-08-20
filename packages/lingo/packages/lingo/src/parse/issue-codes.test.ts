import { describe, expect, it } from 'vitest'
import { lingo } from '../index'

// Emit-path coverage for issue codes that the message pack ships copy for but
// no other suite asserts is ever produced. The corpus contract locks the full
// results; these name the input→code contract explicitly.

describe('issue-code emit paths', () => {
  it('NUMBER_FORMAT on an unparseable numeral', () => {
    const r = lingo('1.2.3.4 kg')
    expect(r.ok).toBe(false)
    expect(r.issues.map((i) => i.code)).toContain('NUMBER_FORMAT')
  })

  it('AMBIGUOUS_UNIT on a lowercase byte-ish unit (assumes bytes, suggests bits)', () => {
    const r = lingo('5 kb')
    expect(r.ok).toBe(true) // a surfaced warning, not a rejection
    const issue = r.issues.find((i) => i.code === 'AMBIGUOUS_UNIT')
    expect(issue?.data).toMatchObject({ assumed: 'kilobytes' })
    expect(issue?.suggestions?.some((s) => s.includes('kbit'))).toBe(true)
  })

  it('RANGE_KIND_MISMATCH when the two ends are different kinds', () => {
    const r = lingo('5 kg to 10 cm')
    expect(r.ok).toBe(false)
    expect(r.issues.map((i) => i.code)).toContain('RANGE_KIND_MISMATCH')
  })
})
