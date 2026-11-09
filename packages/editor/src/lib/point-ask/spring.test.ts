import { describe, expect, test } from 'bun:test'
import { MOMENTUM, SPRING } from './choreography'
import { Spring } from './spring'

const FRAME = 1 / 60

function run(spring: Spring, seconds: number) {
  const samples: number[] = []
  for (let t = 0; t < seconds; t += FRAME) samples.push(spring.step(FRAME))
  return samples
}

describe('Spring', () => {
  test('critically damped, it arrives without overshoot', () => {
    const spring = new Spring(0, SPRING).to(1)
    const samples = run(spring, 2)

    expect(Math.max(...samples)).toBeLessThanOrEqual(1 + 1e-3)
    expect(samples.every((value, i) => i === 0 || value >= samples[i - 1]! - 1e-9)).toBe(true)
  })

  test('with damping 0.8 it overshoots, then settles', () => {
    const spring = new Spring(0, MOMENTUM).to(1)
    const samples = run(spring, 3)

    expect(Math.max(...samples)).toBeGreaterThan(1.01)
    expect(spring.rest).toBe(true)
    expect(spring.x).toBe(1)
  })

  test('settles to rest exactly on its target', () => {
    const spring = new Spring(0.2).to(0.9)
    run(spring, 3)

    expect(spring.rest).toBe(true)
    expect(spring.x).toBe(0.9)
    expect(spring.v).toBe(0)
  })

  test('a retarget mid-flight keeps the velocity: no jump, no restart', () => {
    const spring = new Spring(0, SPRING).to(100)
    run(spring, 0.1)
    const velocity = spring.v
    const position = spring.x

    spring.to(0)

    expect(velocity).toBeGreaterThan(0)
    expect(spring.v).toBe(velocity)
    expect(spring.x).toBe(position)
    // It carries on forward for a moment before it turns back.
    const next = spring.step(FRAME)
    expect(next).toBeGreaterThan(position)
  })

  test('a long frame takes sub-steps and stays stable', () => {
    const spring = new Spring(0, SPRING).to(1)

    for (let i = 0; i < 20; i++) spring.step(0.25)

    expect(spring.x).toBe(1)
  })
})
