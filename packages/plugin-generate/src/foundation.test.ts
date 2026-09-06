import { describe, expect, test } from 'bun:test'
import {
  foundationFor,
  HILL_STEM_MAX_IN,
  NARROW_FOOTPRINT_FT,
  RAISED_FF_ABOVE_GRADE_IN,
  SLAB_FF_ABOVE_GRADE_IN,
} from './foundation'
import { styleFor } from './styles'

const ground = (reliefIn: number) => ({
  reliefIn,
  highestM: reliefIn * 0.0254,
  lowestM: 0,
  samples: 20,
})

describe('foundationFor — PlanCrafters applyFoundation on flat ground', () => {
  test('a wide farmhouse is raised 18 in; the ranch, an ADU and a narrow footprint are slab at 8 in', () => {
    const farm = foundationFor(styleFor('farmhouse'), '1story', 48)
    expect(farm.type).toBe('raised')
    expect(farm.ffAboveGradeIn).toBe(RAISED_FF_ABOVE_GRADE_IN)
    expect(farm.terrain ?? null).toBeNull()
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

describe('foundationFor — the hillside branches', () => {
  test('under 12 in of fall the flat rules hold and the ground is reported', () => {
    const ranch = foundationFor(styleFor('ranch'), '1story', 60, ground(8))
    expect(ranch.type).toBe('slab')
    expect(ranch.source).toContain('8" of fall')
    expect(ranch.terrain?.reliefIn).toBe(8)
  })

  test('12 in or more raises the house on a stem sized to the fall, 24–36 in to the half foot', () => {
    const gentle = foundationFor(styleFor('ranch'), '1story', 60, ground(14))
    expect(gentle.type).toBe('raised')
    expect(gentle.ffAboveGradeIn).toBe(24)
    expect(gentle.source).toContain('hillside')
    expect(foundationFor(styleFor('ranch'), '1story', 60, ground(27)).ffAboveGradeIn).toBe(30)
    expect(foundationFor(styleFor('craftsman'), '1story', 30, ground(30)).ffAboveGradeIn).toBe(30)
    // a narrow ADU on a slope is raised too — the terrain branch comes first
    expect(foundationFor(styleFor('modern'), 'adu', 24, ground(20)).type).toBe('raised')
  })

  test('over 30 in is basement territory: a 36 in stem and an honest note; an ADU stays on the stem rule', () => {
    const steep = foundationFor(styleFor('farmhouse'), '1story', 48, ground(48))
    expect(steep.type).toBe('raised')
    expect(steep.ffAboveGradeIn).toBe(HILL_STEM_MAX_IN)
    expect(steep.source).toContain('basement')
    expect(steep.source).toContain('not modelled')
    const adu = foundationFor(styleFor('modern'), 'adu', 24, ground(48))
    expect(adu.ffAboveGradeIn).toBe(36)
    expect(adu.source).not.toContain('basement')
  })
})
