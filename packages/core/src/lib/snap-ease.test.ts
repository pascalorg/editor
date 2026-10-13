import { describe, expect, test } from 'bun:test'
import { createSnapEaser, prefersReducedMotion, SNAP_EASE_MS } from './snap-ease'

// The ghost window snapping to a corner is a short, eased move, never a jump or a bounce: it covers
// the distance in SNAP_EASE_MS, keeps following the cursor while it eases, and does not ease at all
// for a reader who asked for reduced motion.

describe('createSnapEaser', () => {
  test('follows the cursor exactly while nothing snaps', () => {
    const easer = createSnapEaser()

    expect(easer.display(1.0, false, 0, false)).toBe(1.0)
    expect(easer.display(1.4, false, 16, false)).toBe(1.4)
  })

  test('eases from where it was to the snapped place over SNAP_EASE_MS', () => {
    const easer = createSnapEaser()
    easer.display(3.0, false, 0, false)

    const start = easer.display(3.4, true, 100, false)
    const middle = easer.display(3.4, true, 100 + SNAP_EASE_MS / 2, false)
    const end = easer.display(3.4, true, 100 + SNAP_EASE_MS, false)

    expect(start).toBeCloseTo(3.0, 6)
    expect(middle).toBeGreaterThan(3.0)
    expect(middle).toBeLessThan(3.4)
    expect(end).toBe(3.4)
  })

  test('is eased out: most of the move comes first, with no overshoot', () => {
    const easer = createSnapEaser()
    easer.display(0, false, 0, false)
    easer.display(1, true, 0, false)

    const half = easer.display(1, true, SNAP_EASE_MS / 2, false)
    const samples = [0.1, 0.3, 0.5, 0.7, 0.9, 1].map((p) =>
      easer.display(1, true, p * SNAP_EASE_MS, false),
    )

    expect(half).toBeGreaterThan(0.5)
    for (const value of samples) expect(value).toBeLessThanOrEqual(1 + 1e-9)
  })

  test('keeps following the cursor while it eases', () => {
    const easer = createSnapEaser()
    easer.display(3.0, false, 0, false)
    easer.display(3.4, true, 0, false)

    // The snapped target moved (a different corner end): the move lands on the new target.
    expect(easer.display(3.6, true, SNAP_EASE_MS, false)).toBe(3.6)
  })

  test('eases out of a snap the same way, back to the cursor', () => {
    const easer = createSnapEaser()
    easer.display(3.0, false, 0, false)
    easer.display(3.4, true, 0, false)
    easer.display(3.4, true, SNAP_EASE_MS, false)

    const leaving = easer.display(2.8, false, 500, false)
    expect(leaving).toBeCloseTo(3.4, 6)
    expect(easer.display(2.8, false, 500 + SNAP_EASE_MS, false)).toBe(2.8)
  })

  test('does not ease at all under reduced motion', () => {
    const easer = createSnapEaser()
    easer.display(3.0, false, 0, true)

    expect(easer.display(3.4, true, 10, true)).toBe(3.4)
    expect(easer.active(10)).toBe(false)
  })

  test('says while it is easing, so the tool keeps drawing frames', () => {
    const easer = createSnapEaser()
    easer.display(3.0, false, 0, false)
    easer.display(3.4, true, 100, false)

    expect(easer.active(100 + SNAP_EASE_MS / 2)).toBe(true)
    expect(easer.active(100 + SNAP_EASE_MS)).toBe(false)
  })
})

describe('prefersReducedMotion', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const set = (value: unknown) =>
    Object.defineProperty(globalThis, 'window', { value, configurable: true, writable: true })
  const restore = () => {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else Reflect.deleteProperty(globalThis, 'window')
  }

  test('is false where there is no media query to ask (a test environment, a server)', () => {
    set({})
    expect(prefersReducedMotion()).toBe(false)
    set(undefined)
    expect(prefersReducedMotion()).toBe(false)
    restore()
  })

  test("follows the reader's setting where the browser can say", () => {
    set({ matchMedia: (query: string) => ({ matches: query.includes('reduce') }) })
    expect(prefersReducedMotion()).toBe(true)
    set({ matchMedia: () => ({ matches: false }) })
    expect(prefersReducedMotion()).toBe(false)
    restore()
  })
})
