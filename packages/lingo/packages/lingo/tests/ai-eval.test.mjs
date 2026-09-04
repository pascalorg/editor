// The corpus's expected date instants were recorded in Europe/Paris: date
// fixtures resolve to LOCAL midnight/civil time, so their ISO expectations are
// only reproducible in the recording zone. Pin TZ BEFORE the date engine loads
// (same pattern and caveat as src/date/dst.test.ts — vitest per-file isolation
// keeps this process-global assignment contained).
process.env.TZ = 'Europe/Paris'

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CATEGORY_ORDER, evaluateCorpus, validateCorpus } from '../scripts/ai-eval.mjs'
import { dateField, quantityField, rangeField } from '../src/ai/index.ts'

const corpus = JSON.parse(
  readFileSync(new URL('./fixtures/ai-eval-corpus.json', import.meta.url), 'utf8'),
)

describe('AI eval corpus', () => {
  it('is large enough, covers the frozen taxonomy, and keeps provenance visible', () => {
    expect(validateCorpus(corpus)).toEqual([])
    expect(corpus.length).toBeGreaterThanOrEqual(150)

    const categories = new Set(corpus.map((entry) => entry.category))
    expect([...categories].sort()).toEqual([...CATEGORY_ORDER].sort())

    const provenance = new Set(corpus.map((entry) => entry.provenance))
    expect(provenance.has('documented')).toBe(true)
    expect(provenance.has('synthesized')).toBe(true)
  })

  it('keeps lingo acceptance at or above naive coercion for every category', () => {
    const report = evaluateCorpus(corpus, { dateField, quantityField, rangeField })

    expect(report.overall.lingo.acceptanceRate).toBeGreaterThanOrEqual(
      report.overall.naive.acceptanceRate,
    )
    for (const row of report.categories) {
      expect(row.lingo.acceptanceRate).toBeGreaterThanOrEqual(row.naive.acceptanceRate)
    }
  })

  it('keeps lingo silent-wrong rate at or below naive coercion overall', () => {
    const report = evaluateCorpus(corpus, { dateField, quantityField, rangeField })

    expect(report.overall.lingo.silentWrongRate).toBeLessThanOrEqual(
      report.overall.naive.silentWrongRate,
    )
  })
})
