import { describe, expect, test } from 'bun:test'
import {
  foundationFor,
  NARROW_FOOTPRINT_FT,
  RAISED_FF_ABOVE_GRADE_IN,
  SLAB_FF_ABOVE_GRADE_IN,
} from './foundation'
import { styleFor } from './styles'

describe('foundationFor — PlanCrafters applyFoundation on flat ground', () => {
  test('a wide farmhouse is raised 18 in; the ranch, an ADU and a narrow footprint are slab at 8 in', () => {
    const farm = foundationFor(styleFor('farmhouse'), '1story', 48)
    expect(farm.type).toBe('raised')
    expect(farm.ffAboveGradeIn).toBe(RAISED_FF_ABOVE_GRADE_IN)
    const ranch = foundationFor(styleFor('ranch'), '1story', 60)
    expect(ranch.type).toBe('slab')
    expect(ranch.ffAboveGradeIn).toBe(SLAB_FF_ABOVE_GRADE_IN)
    expect(ranch.source).toContain('long-low')
    expect(foundationFor(styleFor('farmhouse'), 'adu', 24).type).toBe('slab')
    const narrow = foundationFor(styleFor('craftsman'), '1story', NARROW_FOOTPRINT_FT)
    expect(narrow.type).toBe('slab')
    expect(narrow.source).toContain('narrow footprint')
    expect(foundationFor(styleFor('craftsman'), '1story', NARROW_FOOTPRINT_FT + 0.5).type).toBe(
      'raised',
    )
  })
})
