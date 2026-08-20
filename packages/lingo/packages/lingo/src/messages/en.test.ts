import { afterEach, describe, expect, it } from 'vitest'
import { makeIssue, setDefaultMessages } from '../core/errors'
import { createRegistry } from '../core/registry'
import type { IssueCode } from '../core/types'
import { parseExpression } from '../parse/grammar'
import { allKinds } from '../units/index'
import { en } from './en'

const ISSUE_CODES = [
  'EMPTY',
  'NO_VALUE',
  'UNKNOWN_UNIT',
  'KIND_MISMATCH',
  'RANGE_KIND_MISMATCH',
  'CONVERSION_KIND_MISMATCH',
  'RATE_REQUIRED',
  'TRAILING_INPUT',
  'SINGLE_VALUE_EXPECTED',
  'APPROX_NOT_ALLOWED',
  'UNIT_REQUIRED',
  'CONVERSION_NOT_ALLOWED',
  'NUMBER_FORMAT',
  'NONFINITE',
  'LOCALE_NOT_LOADED',
  'RANGE_MIN',
  'RANGE_MAX',
  'RANGE_OPEN_BOUND_NOT_ALLOWED',
  'REQUIRED',
  'UNSUPPORTED_DATE',
  'NOW_REQUIRED',
  'TYPO_CORRECTED',
  'AMBIGUOUS_NUMBER',
  'AMBIGUOUS_UNIT',
  'AMBIGUOUS_DATE',
  'RANGE_REVERSED',
  'COMPOUND_OVERFLOW',
  'CIVIL_AVERAGE',
  'UNIT_ASSUMED',
  'WEEKDAY_ASSUMED_NEXT',
  'SLANG_UNIT',
  'TZ_IGNORED',
  'AMBIGUOUS_TIMEZONE',
] as const satisfies readonly IssueCode[]

describe('english message pack', () => {
  // Several tests swap the global pack (to {} to prove copy-free core, or to en
  // to prove registered copy). Restore en after each so a failure can't leave a
  // later test parsing against an empty pack.
  afterEach(() => setDefaultMessages(en))

  it('has copy for every issue code', () => {
    for (const code of ISSUE_CODES) {
      expect(en[code], code).toBeTypeOf('string')
      expect(en[code].length, code).toBeGreaterThan(0)
    }
  })

  it('keeps core-only parsing copy-free until a pack is registered', () => {
    const reg = createRegistry(allKinds)
    setDefaultMessages({})
    const coreOnly = parseExpression('banana', { registry: reg })
    expect(coreOnly.ok).toBe(false)
    if (!coreOnly.ok) {
      expect(coreOnly.issues[0]?.message).toBe('NO_VALUE')
    }

    setDefaultMessages(en)
    const withPack = parseExpression('banana', { registry: reg })
    expect(withPack.ok).toBe(false)
    if (!withPack.ok) {
      expect(withPack.issues[0]?.message).toContain('No number found')
    }
  })

  it('uses registered copy after severity escalation', () => {
    const r = parseExpression('72', {
      registry: createRegistry(allKinds),
      kind: 'length',
      unit: 'cm',
      strictness: 'confirm',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const issue = r.issues.find((i) => i.code === 'UNIT_ASSUMED')
      expect(issue?.severity).toBe('error')
      expect(issue?.message).toContain('Assuming centimeters')
    }
  })

  it('points locale and relative-date setup errors at the fix', () => {
    expect(makeIssue('LOCALE_NOT_LOADED', { locale: 'es' }, undefined, en).message).toBe(
      'Import @pascal-app/lingo/locales/<locale>; use createLingo({ locales }).',
    )
    expect(makeIssue('NOW_REQUIRED', {}, undefined, en).message).toBe(
      'Pass now for relative dates or use an absolute date.',
    )
  })
})
