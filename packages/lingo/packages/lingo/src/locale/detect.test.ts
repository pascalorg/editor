import { describe, expect, it } from 'vitest'
import { scoreProfile } from './detect'
import { englishLanguageProfile } from './en-core'

describe('locale detection', () => {
  it('scores English profile positively for number-word input', () => {
    // "five" is in englishLanguageProfile.numberWords.ones
    const score = scoreProfile(englishLanguageProfile, 'five hundred')
    expect(score).toBeGreaterThan(0)
  })

  it('scores zero for unrecognized input', () => {
    const score = scoreProfile(englishLanguageProfile, '12345')
    expect(score).toBe(0)
  })

  it('handles phrases with regex metacharacters safely', () => {
    // Ensures the non-regex hasPhrase replacement handles special chars
    // (previously these would be escaped for regex; now handled via indexOf)
    const score = scoreProfile(englishLanguageProfile, 'test $100 value')
    // Should not throw, regardless of score
    expect(typeof score).toBe('number')
  })

  it('handles phrases with diacritics', () => {
    const score = scoreProfile(englishLanguageProfile, 'cafe resume')
    expect(typeof score).toBe('number')
  })

  it('scores a bound phrase at end-of-string as a word-boundary hit', () => {
    const score = scoreProfile(englishLanguageProfile, 'it is at least')
    expect(score).toBeGreaterThan(0)
  })

  it('scores a bound phrase preceded and followed by whitespace', () => {
    const score = scoreProfile(englishLanguageProfile, 'need at least 5')
    expect(score).toBeGreaterThan(0)
  })

  it('does NOT score a phrase glued inside a longer word (no boundary)', () => {
    // "atleast" should not hit "at least" — no space boundary between "at" and "least"
    const glued = scoreProfile(englishLanguageProfile, 'atleast')
    // The phrase "at least" requires a space inside, so indexOf won't find it
    // in "atleast". But test that single-token words don't accidentally match.
    const separated = scoreProfile(englishLanguageProfile, 'at least')
    expect(separated).toBeGreaterThan(glued)
  })

  it('does NOT treat comma as a word boundary for phrase detection', () => {
    // charCode of ',' is 44 (>32), so "at least," should still score because
    // the hasPhrase boundary check is idx + pLen >= input.length || charCode<=32.
    // After "at least" the comma has charCode 44 > 32, so it is NOT a boundary.
    const withComma = scoreProfile(englishLanguageProfile, 'at least,5')
    const withSpace = scoreProfile(englishLanguageProfile, 'at least 5')
    // "at least" is bounded by space in the second case but NOT by comma in the first.
    expect(withSpace).toBeGreaterThan(withComma)
  })
})
