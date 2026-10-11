import { describe, expect, test } from 'bun:test'
import { MOMENTUM, SPRING } from './choreography'
import { Spring, SpringPair, springValueAt } from './spring'

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

  test('snap puts it at a value at rest', () => {
    const spring = new Spring(0).to(5)
    run(spring, 0.05)
    spring.snap(3)

    expect(spring.x).toBe(3)
    expect(spring.t).toBe(3)
    expect(spring.v).toBe(0)
    expect(spring.rest).toBe(true)
  })

  test('a step at rest costs nothing and moves nothing', () => {
    const spring = new Spring(4)

    expect(spring.step(FRAME)).toBe(4)
    expect(spring.rest).toBe(true)
  })

  test('a long frame takes sub-steps and stays stable', () => {
    const spring = new Spring(0, SPRING).to(1)

    for (let i = 0; i < 20; i++) spring.step(0.25)

    expect(spring.x).toBe(1)
  })

  test('to() with new parameters changes the feel but keeps the motion', () => {
    const spring = new Spring(0, SPRING).to(1)
    run(spring, 0.05)
    const velocity = spring.v
    spring.to(2, { damping: 0.8, response: 0.35 })

    expect(spring.v).toBe(velocity)
    run(spring, 3)
    expect(spring.x).toBe(2)
  })
})

describe('SpringPair', () => {
  test('moves x and y independently and rests when both do', () => {
    const pair = new SpringPair(0, 0, SPRING).to(10, 0)
    pair.step(FRAME)

    expect(pair.x.x).toBeGreaterThan(0)
    expect(pair.y.x).toBe(0)
    expect(pair.rest).toBe(false)
    for (let t = 0; t < 3; t += FRAME) pair.step(FRAME)
    expect(pair.rest).toBe(true)
    expect(pair.value).toEqual({ x: 10, y: 0 })
  })

  test('snap puts both at a point', () => {
    const pair = new SpringPair(1, 2).to(9, 9)
    pair.snap(5, 6)

    expect(pair.value).toEqual({ x: 5, y: 6 })
    expect(pair.rest).toBe(true)
  })
})

describe('springValueAt', () => {
  test('is 0 at the start and 1 once it has settled', () => {
    expect(springValueAt(0, 1, 0.35)).toBe(0)
    expect(springValueAt(-1, 1, 0.35)).toBe(0)
    expect(springValueAt(3, 1, 0.35)).toBeCloseTo(1, 5)
  })

  test('critically damped never passes 1; damping 0.8 does', () => {
    const times = Array.from({ length: 120 }, (_, i) => i / 60)

    expect(Math.max(...times.map((t) => springValueAt(t, 1, 0.35)))).toBeLessThanOrEqual(1)
    expect(Math.max(...times.map((t) => springValueAt(t, 0.8, 0.35)))).toBeGreaterThan(1.01)
  })

  test('agrees with the stepped spring', () => {
    const spring = new Spring(0, SPRING).to(1)
    let elapsed = 0
    for (let i = 0; i < 12; i++) {
      spring.step(FRAME)
      elapsed += FRAME
    }

    expect(spring.x).toBeCloseTo(springValueAt(elapsed, 1, 0.35), 1)
  })
})
