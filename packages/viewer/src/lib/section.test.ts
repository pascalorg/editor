import { describe, expect, test } from 'bun:test'
import { Plane, Vector3 } from 'three'
import {
  filterSectionHits,
  SECTION_DEFAULTS,
  sectionShadowSignature,
  updateSectionPlane,
} from './section'

describe('section half-space', () => {
  for (const sectionAxis of ['x', 'y', 'z'] as const) {
    for (const sectionFlipped of [false, true]) {
      test(`${sectionAxis}, flipped ${sectionFlipped}: keeps the specified side in world metres`, () => {
        const state = { ...SECTION_DEFAULTS, sectionAxis, sectionPosition: 7, sectionFlipped }
        const plane = updateSectionPlane(new Plane(), state)
        const below = new Vector3()
        const above = new Vector3()
        below[sectionAxis] = 6
        above[sectionAxis] = 8
        expect(plane.distanceToPoint(below) >= 0).toBe(!sectionFlipped)
        expect(plane.distanceToPoint(above) >= 0).toBe(sectionFlipped)
        below[sectionAxis] = 7
        expect(plane.distanceToPoint(below)).toBe(0)
      })
    }
  }
})

test('picking passes through removed hits without changing order or identity', () => {
  const hits = [
    { nodeId: 'near-removed', point: new Vector3(0, 2, 0) },
    { nodeId: 'first-kept', point: new Vector3(0, -1, 0) },
    { nodeId: 'next-kept', point: new Vector3(0, -2, 0) },
  ]
  const state = { ...SECTION_DEFAULTS, sectionEnabled: true }
  expect(filterSectionHits(hits, state)).toEqual(hits.slice(1))
  expect(filterSectionHits(hits, state)[0]).toBe(hits[1])
  expect(filterSectionHits(hits, SECTION_DEFAULTS)).toBe(hits)
  expect(filterSectionHits(hits, { ...state, walkthroughMode: true })).toBe(hits)
})

test.each(['full', 'cut'] as const)(
  '%s section shadow cache tracks only clipped casters',
  (sectionShadows) => {
    const state = { ...SECTION_DEFAULTS, sectionEnabled: true, sectionShadows }
    const original = sectionShadowSignature(state)
    for (const change of [
      { sectionEnabled: false },
      { sectionAxis: 'x' as const },
      { sectionAxis: 'z' as const },
      { sectionPosition: 0.001 },
      { sectionFlipped: true },
      { walkthroughMode: true },
    ]) {
      expect(sectionShadowSignature({ ...state, ...change }) === original).toBe(
        sectionShadows === 'full',
      )
    }
    expect(sectionShadowSignature({ ...state })).toBe(original)
    expect(sectionShadowSignature({ ...state, sectionShadows: 'full' })).toBe('')
  },
)
