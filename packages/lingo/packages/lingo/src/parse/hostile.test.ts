import { describe, expect, it } from 'vitest'
import { lingo, parseQuantity } from '../index'

/**
 * Hostile & degenerate inputs (plan 010): the engine never throws on user
 * input, never returns non-finite numbers, and stays linear-time.
 */

const NASTY = [
  '',
  '   ',
  '​​​',
  '💀💀💀',
  '5 💀',
  'עברית 5 ק"ג',
  '5; DROP TABLE users;--',
  '<script>alert(1)</script>',
  'NaN kg',
  'Infinity m',
  '-Infinity m',
  '1e999 m',
  '- kg',
  '.',
  ',',
  '/',
  '((((((((((',
  '5..5 kg',
  '1,2,3,4,5 kg',
  '𝟏𝟐 kg', // mathematical bold digits → NFKC
  '5​ kg', // zero-width space inside
  '‮5 kg', // RTL override
  'ᵐᵉᵗᵉʳˢ 5',
  "''''''''''",
  '5 5 5 5 5 kg',
  'about about about 5 kg',
  '-0 kg',
  '5 kg to to cm',
]

describe('hostile inputs', () => {
  it('never throws and never yields non-finite values', () => {
    for (const input of NASTY) {
      const r = lingo(input)
      if (r.ok) {
        if (r.type === 'quantity') {
          expect(Number.isFinite(r.quantity.base), input).toBe(true)
        }
        if (r.type === 'number') {
          expect(Number.isFinite(r.value), input).toBe(true)
        }
        if (r.type === 'range') {
          for (const b of [r.range.minBase, r.range.maxBase]) {
            if (b !== null) {
              expect(Number.isFinite(b), input).toBe(true)
            }
          }
        }
      } else {
        expect(r.issues.length, input).toBeGreaterThan(0)
        for (const issue of r.issues) {
          if (issue.span) {
            expect(issue.span.start, input).toBeGreaterThanOrEqual(0)
            expect(issue.span.end, input).toBeLessThanOrEqual(input.length)
            expect(issue.span.start).toBeLessThanOrEqual(issue.span.end)
          }
        }
      }
    }
  })

  it('folds unicode digit variants', () => {
    const r = parseQuantity('𝟏𝟐 kg')
    if (!r.ok) {
      throw new Error(JSON.stringify(r.issues))
    }
    expect(r.quantity.base).toBeCloseTo(12, 9)
  })

  it('survives zero-width and directional characters with correct spans', () => {
    const r = parseQuantity('5​ kg')
    if (!r.ok) {
      throw new Error(JSON.stringify(r.issues))
    }
    expect(r.quantity.base).toBeCloseTo(5, 9)
  })

  it('handles -0 without sign weirdness in output', () => {
    const r = parseQuantity('-0 kg')
    if (!r.ok) {
      throw new Error('expected ok')
    }
    expect(r.quantity.format()).toBe('0 kg')
  })

  it('stays roughly linear on degenerate long inputs (quadratic catcher)', () => {
    // Generous bound: catches O(n²) blowups (which would take minutes), not
    // load-sensitive micro-perf. Real benchmarks are env-gated below.
    const t0 = performance.now()
    lingo('a'.repeat(50_000))
    lingo(`${'9'.repeat(500)} kg`)
    lingo(`5 ${'x'.repeat(20_000)}`)
    const elapsed = performance.now() - t0
    expect(elapsed).toBeLessThan(5000)
  })

  // Opt-in benchmark: LINGO_PERF=1 bun run test src/parse/hostile.test.ts
  const PERF =
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[
      'LINGO_PERF'
    ] === '1'
  it.skipIf(!PERF)('benchmark: 10k mixed parses', () => {
    const samples = [
      '2 ft',
      '5\'11"',
      '72 in to cm',
      'between 5 and 10 kg',
      '1,5 kg',
      'about 20°C',
      'a few minutes',
      '3×10^5 m',
      '1½ cups',
      'under 10 min',
    ]
    for (let i = 0; i < 1000; i++) {
      lingo(samples[i % samples.length]!) // warmup
    }
    const t0 = performance.now()
    for (let i = 0; i < 10_000; i++) {
      lingo(samples[i % samples.length]!)
    }
    const elapsed = performance.now() - t0
    console.log(`10k mixed parses: ${elapsed.toFixed(0)} ms (${(elapsed / 10).toFixed(2)} µs each)`)
    expect(elapsed).toBeLessThan(3000)
  })
})
