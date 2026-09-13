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

  test('24 in or more raises the house on a stem sized to the fall, 24–36 in to the half foot; under it a slab on a built-up pad (Steve, 2026-09-07)', () => {
    const pad = foundationFor(styleFor('ranch'), '1story', 60, ground(14))
    expect(pad.type).toBe('slab')
    expect(pad.ffAboveGradeIn).toBe(8)
    const gentle = foundationFor(styleFor('ranch'), '1story', 60, ground(24))
    expect(gentle.type).toBe('raised')
    expect(gentle.ffAboveGradeIn).toBe(24)
    expect(gentle.source).toContain('hillside')
    expect(foundationFor(styleFor('ranch'), '1story', 60, ground(27)).ffAboveGradeIn).toBe(30)
    expect(foundationFor(styleFor('craftsman'), '1story', 30, ground(30)).ffAboveGradeIn).toBe(30)
    // a narrow ADU on a real slope is raised too — the terrain branch comes first
    expect(foundationFor(styleFor('modern'), 'adu', 24, ground(26)).type).toBe('raised')
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

describe('foundationFor — the user\'s word over the rule (Steve, 2026-09-07: "a setting to generate the house higher")', () => {
  const flat = { reliefIn: 3, highestM: 0.02, lowestM: -0.05, samples: 20 }
  test('a height alone lifts the rule\'s type; a type alone takes its minimum or the rule\'s height; both clamp to the type\'s floor', () => {
    const rule = foundationFor(styleFor('ranch'), '1story', 44, flat)
    expect(rule.type).toBe('slab')
    const higher = foundationFor(styleFor('ranch'), '1story', 44, flat, { ffAboveGradeIn: 24 })
    expect(higher.type).toBe('slab')
    expect(higher.ffAboveGradeIn).toBe(24)
    expect(higher.source).toContain('24 in above grade asked')
    const raised = foundationFor(styleFor('ranch'), '1story', 44, flat, { type: 'raised' })
    expect(raised.type).toBe('raised')
    expect(raised.ffAboveGradeIn).toBe(18)
    const low = foundationFor(styleFor('ranch'), '1story', 44, flat, { type: 'raised', ffAboveGradeIn: 6 })
    expect(low.ffAboveGradeIn).toBe(18)
    expect(low.source).toContain('held to the raised minimum')
    const slabTall = foundationFor(styleFor('farmhouse'), '1story', 44, flat, { type: 'slab', ffAboveGradeIn: 36 })
    expect(slabTall.type).toBe('slab')
    expect(slabTall.ffAboveGradeIn).toBe(36)
    expect(slabTall.source).toContain('built-up pad')
    // nothing asked: the rule verbatim
    expect(foundationFor(styleFor('ranch'), '1story', 44, flat, {})).toEqual(rule)
  })
})
