import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { lingo } from '../../src/index.ts'
import { parseDate, parseDateRange } from '../../src/date/index.ts'
import { buildContract } from './source.mjs'

describe('contract-v1 corpus', () => {
  it('matches the checked-in compatibility snapshot', () => {
    const expected = JSON.parse(readFileSync(new URL('./contract-v1.json', import.meta.url), 'utf8'))
    expect(buildContract({ lingo, parseDate, parseDateRange })).toEqual(expected)
  })
})
