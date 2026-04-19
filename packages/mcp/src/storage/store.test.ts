import { describe, expect, test } from 'bun:test'
import { generateSlug, isValidSlug, sanitizeSlug } from './slug'

describe('sanitizeSlug', () => {
  test('lowercases input', () => {
    expect(sanitizeSlug('MyScene')).toBe('myscene')
  })

  test('converts spaces to hyphens', () => {
    expect(sanitizeSlug('my awesome scene')).toBe('my-awesome-scene')
  })

  test('strips non alphanumeric characters', () => {
    expect(sanitizeSlug('hello@world!_$%scene')).toBe('helloworldscene')
  })

  test('collapses runs of hyphens', () => {
    expect(sanitizeSlug('a---b--c')).toBe('a-b-c')
  })

  test('collapses runs from mixed input', () => {
    expect(sanitizeSlug('a   b   c')).toBe('a-b-c')
  })

  test('trims hyphens from the ends', () => {
    expect(sanitizeSlug('---foo---')).toBe('foo')
  })

  test('enforces 64-char maximum', () => {
    const long = 'a'.repeat(200)
    const result = sanitizeSlug(long)
    expect(result.length).toBeLessThanOrEqual(64)
    expect(result).toBe('a'.repeat(64))
  })

  test('trims trailing hyphen after truncation', () => {
    const raw = `${'a'.repeat(63)}-bbbbb`
    const result = sanitizeSlug(raw)
    expect(result.endsWith('-')).toBe(false)
    expect(result.length).toBeLessThanOrEqual(64)
  })

  test('throws when result is empty', () => {
    expect(() => sanitizeSlug('')).toThrow()
    expect(() => sanitizeSlug('!!!')).toThrow()
    expect(() => sanitizeSlug('   ')).toThrow()
  })

  test('preserves already-valid slugs', () => {
    expect(sanitizeSlug('already-valid-123')).toBe('already-valid-123')
  })
})

describe('isValidSlug', () => {
  test('accepts typical slugs', () => {
    expect(isValidSlug('my-scene')).toBe(true)
    expect(isValidSlug('scene123')).toBe(true)
    expect(isValidSlug('a')).toBe(true)
  })

  test('rejects empty string', () => {
    expect(isValidSlug('')).toBe(false)
  })

  test('rejects uppercase', () => {
    expect(isValidSlug('MyScene')).toBe(false)
  })

  test('rejects underscores and other punctuation', () => {
    expect(isValidSlug('my_scene')).toBe(false)
    expect(isValidSlug('my.scene')).toBe(false)
    expect(isValidSlug('my/scene')).toBe(false)
  })

  test('rejects leading or trailing hyphens', () => {
    expect(isValidSlug('-foo')).toBe(false)
    expect(isValidSlug('foo-')).toBe(false)
  })

  test('rejects consecutive hyphens', () => {
    expect(isValidSlug('foo--bar')).toBe(false)
  })

  test('rejects strings > 64 chars', () => {
    expect(isValidSlug('a'.repeat(65))).toBe(false)
  })

  test('accepts exactly 64 chars', () => {
    expect(isValidSlug('a'.repeat(64))).toBe(true)
  })
})

describe('generateSlug', () => {
  test('returns a 12-char string', () => {
    const slug = generateSlug()
    expect(slug).toHaveLength(12)
  })

  test('is lowercase alphanumeric', () => {
    for (let i = 0; i < 50; i++) {
      const slug = generateSlug()
      expect(slug).toMatch(/^[a-z0-9]{12}$/)
    }
  })

  test('passes isValidSlug', () => {
    for (let i = 0; i < 20; i++) {
      expect(isValidSlug(generateSlug())).toBe(true)
    }
  })

  test('produces unique values across many calls', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      seen.add(generateSlug())
    }
    // Allow for a tiny chance of collision but near-certain uniqueness.
    expect(seen.size).toBeGreaterThan(195)
  })
})

// Note: createSceneStore() factory branching is covered transitively by
// the filesystem and supabase store tests. We avoid mock.module() here
// because bun's module mocks persist process-wide and pollute sibling
// test files (notably supabase-scene-store.test.ts).
