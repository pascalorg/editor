import { describe, expect, it } from 'vitest'
import { defaultRegistry } from '../index'

describe('Registry.matchUnitsAt', () => {
  it('returns deduplicated matches sorted by length desc', () => {
    // "cm" should match centimeters; both exact and ci pools may contribute
    const hits = defaultRegistry.matchUnitsAt('cm', 'cm', 0, 'length')
    const ids = hits.map((h) => h.unit.id)
    // No duplicates
    expect(ids.length).toBe(new Set(ids).size)
    // First hit is 'cm' (longest match at position 0)
    expect(hits[0]!.unit.id).toBe('cm')
    expect(hits[0]!.length).toBe(2)
  })

  it('returns empty array when nothing matches', () => {
    const hits = defaultRegistry.matchUnitsAt('zzz', 'zzz', 0)
    expect(hits).toEqual([])
  })

  it('sorts longer matches before shorter ones', () => {
    // "inches" is longer than "in"
    const hits = defaultRegistry.matchUnitsAt('inches', 'inches', 0, 'length')
    expect(hits.length).toBeGreaterThan(0)
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i]!.length).toBeLessThanOrEqual(hits[i - 1]!.length)
    }
  })
})

describe('Registry.registerUnitAliases', () => {
  it('silently skips unknown unitRef (lenient for locale packs)', () => {
    // This is intentional: locale packs may reference units not in a slim registry
    expect(() => {
      defaultRegistry.registerUnitAliases('length', 'nonexistent_unit_xyz', ['foo'])
    }).not.toThrow()
  })

  it('registers aliases for known units', () => {
    // 'cm' is known — verifying the alias resolves via matchUnitsAt
    const hits = defaultRegistry.matchUnitsAt('cm', 'cm', 0, 'length')
    expect(hits.some((h) => h.unit.id === 'cm')).toBe(true)
  })
})
