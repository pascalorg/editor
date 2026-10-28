import { describe, expect, test } from 'bun:test'
import { CLOSE_UP_NEAR, ORBIT_NEAR, orbitNearPlane } from './orbit-near-plane'

describe('the orbit near plane follows the eye in', () => {
  test("standing back it is the viewer's own; close in, a tenth of the distance; never under an inch-off look", () => {
    expect(orbitNearPlane(40)).toBe(ORBIT_NEAR)
    expect(orbitNearPlane(3)).toBe(ORBIT_NEAR)
    expect(orbitNearPlane(1)).toBeCloseTo(0.1, 9)
    expect(orbitNearPlane(0.5)).toBeCloseTo(0.05, 9)
    expect(orbitNearPlane(0.01)).toBe(CLOSE_UP_NEAR)
  })
})
