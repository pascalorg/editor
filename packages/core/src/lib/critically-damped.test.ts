import { describe, expect, test } from 'bun:test'
import { criticallyDamped } from './critically-damped'

describe('a critically damped move', () => {
  const run = (response: number, from: number, to: number, ms = 3000, dt = 16) => {
    const state = { x: from, v: 0 }
    const path = [state.x]
    for (let elapsed = 0; elapsed < ms; elapsed += dt) {
      criticallyDamped(state, to, response, dt / 1000)
      path.push(state.x)
    }
    return { state, path }
  }

  test('arrives without overshooting, and stays', () => {
    const { state, path } = run(0.5, 0, 1)
    for (const x of path) expect(x).toBeLessThanOrEqual(1 + 1e-9)
    for (let index = 1; index < path.length; index += 1)
      expect(path[index]!).toBeGreaterThanOrEqual(path[index - 1]! - 1e-12)
    expect(state.x).toBeCloseTo(1, 4)
    expect(Math.abs(state.v)).toBeLessThan(1e-3)
  })

  test('response is how long it takes: most of the way in about that time', () => {
    const half = run(0.5, 0, 1, 500).state.x
    expect(half).toBeGreaterThan(0.85)
    expect(half).toBeLessThan(1)
    expect(run(0.25, 0, 1, 500).state.x).toBeGreaterThan(half)
  })

  test('takes the same path however the frames are cut', () => {
    const fine = run(0.5, 0, 1, 400, 4).state.x
    const coarse = run(0.5, 0, 1, 400, 40).state.x
    expect(Math.abs(fine - coarse)).toBeLessThan(1e-3)
  })

  test('turns around from where it is, carrying its speed: no jump when the target flips', () => {
    const state = { x: 0, v: 0 }
    for (let index = 0; index < 20; index += 1) criticallyDamped(state, 1, 0.5, 0.016)
    const at = state.x
    const speed = state.v
    expect(speed).toBeGreaterThan(0)
    criticallyDamped(state, 0, 0.5, 0.001)
    expect(Math.abs(state.x - at)).toBeLessThan(0.01)
    // The speed is carried through the turn, not reset: it is still moving up a moment later.
    expect(state.v).toBeGreaterThan(0)
  })
})
