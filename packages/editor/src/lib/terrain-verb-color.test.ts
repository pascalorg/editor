import { describe, expect, test } from 'bun:test'
import type { TerrainVerb } from '@pascal-app/core'
import { brushRingColor } from './terrain-verb-color'

/**
 * The brush ring is the only thing at the point of action that can say what the
 * next drag will do. Sculpt is a *sustained* mode, so the verb a user armed a
 * minute ago is still armed — and the ring's geometry is identical for all four
 * verbs, which leaves colour as the only channel carrying that state.
 *
 * These assert the property rather than the palette: which hex is taste, but "no
 * two states look alike" is correctness, and it is the thing that silently breaks
 * when a fifth verb is added (terrace is planned).
 */

const VERBS: TerrainVerb[] = ['raise', 'lower', 'flatten', 'smooth']

describe('brushRingColor', () => {
  test('no two verbs share a colour', () => {
    const colors = VERBS.map((verb) => brushRingColor(verb, false))
    expect(new Set(colors).size).toBe(VERBS.length)
  })

  test('raise and lower are the pair that must never be confused', () => {
    // The original bug: one amber ring for both, so the only way to know which way
    // the ground would move was to look away from the cursor at the panel.
    expect(brushRingColor('raise', false)).not.toBe(brushRingColor('lower', false))
  })

  test('flatten and smooth differ too', () => {
    // Both are "neither up nor down", but one drives ground to a target height you
    // can set wrongly and the other only softens what is there.
    expect(brushRingColor('flatten', false)).not.toBe(brushRingColor('smooth', false))
  })

  test('sampling overrides every verb with one distinct colour', () => {
    // While the eyedropper is armed the click does not apply the verb at all, so
    // the ring must not read as any of them.
    const sampled = VERBS.map((verb) => brushRingColor(verb, true))
    expect(new Set(sampled).size).toBe(1)
    for (const verb of VERBS) {
      expect(brushRingColor(verb, true)).not.toBe(brushRingColor(verb, false))
    }
  })

  test('every verb resolves to a colour, so a new verb cannot fall through', () => {
    for (const verb of VERBS) {
      expect(brushRingColor(verb, false)).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})
