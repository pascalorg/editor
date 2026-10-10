import { describe, expect, test } from 'bun:test'
import { springKeyframes } from './spring-keyframes'

// The bubble grows from the click as a spring: scale 0.92 to 1 with the opacity and the blur
// arriving together. Written first: a first frame that is not the start, a last frame that is not
// the rest, opacity leaving 0 to 1, and a critically damped spring overshooting.
describe('springKeyframes', () => {
  const frames = springKeyframes(
    { scale: 0.92, opacity: 0, blur: 4 },
    { scale: 1, opacity: 1, blur: 0 },
    360,
  )

  test('starts at the start and rests at the end', () => {
    expect(frames[0]).toMatchObject({
      offset: 0,
      opacity: 0,
      transform: 'translate3d(0px, 0px, 0) scale(0.92)',
      filter: 'blur(4px)',
    })
    const last = frames.at(-1)!
    expect(last.opacity).toBeCloseTo(1, 2)
    expect(String(last.transform)).toContain('scale(1')
    expect(String(last.filter)).toBe('blur(0px)')
  })

  test('critically damped, it never overshoots the end', () => {
    for (const frame of frames) expect(Number(frame.opacity)).toBeLessThanOrEqual(1)
    const scales = frames.map((f) => Number(/scale\(([\d.]+)\)/.exec(String(f.transform))?.[1]))
    expect(Math.max(...scales)).toBeLessThanOrEqual(1.0001)
  })

  test('with momentum (damping 0.8) the scale overshoots, and opacity still stays in 0-1', () => {
    const springy = springKeyframes({ scale: 0.9 }, { scale: 1 }, 400, { damping: 0.8 })
    const scales = springy.map((f) => Number(/scale\(([\d.]+)\)/.exec(String(f.transform))?.[1]))
    expect(Math.max(...scales)).toBeGreaterThan(1)
    for (const f of springy) expect(Number(f.opacity)).toBeGreaterThanOrEqual(0)
  })

  test('moves along x and y too', () => {
    const slid = springKeyframes({ y: 8 }, { y: 0 }, 320)
    expect(String(slid[0]?.transform)).toContain('translate3d(0px, 8px, 0)')
    expect(String(slid.at(-1)?.transform)).toContain('translate3d(0px, 0')
  })
})
