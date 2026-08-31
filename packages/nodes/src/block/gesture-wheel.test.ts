import { describe, expect, test } from 'bun:test'
import { BLOCK_WHEEL_OPTIONS, consumeBlockGestureWheel } from './gesture-wheel'

describe('block gesture wheel', () => {
  test('captures and consumes wheel input before camera controls receive it', () => {
    const calls: string[] = []
    const direction = consumeBlockGestureWheel({
      deltaY: -1,
      preventDefault: () => calls.push('preventDefault'),
      stopImmediatePropagation: () => calls.push('stopImmediatePropagation'),
      stopPropagation: () => calls.push('stopPropagation'),
    })

    expect(BLOCK_WHEEL_OPTIONS).toEqual({ capture: true, passive: false })
    expect(calls).toEqual(['preventDefault', 'stopPropagation', 'stopImmediatePropagation'])
    expect(direction).toBe(1)
  })

  test('returns the decrement direction for wheel-down input', () => {
    const direction = consumeBlockGestureWheel({
      deltaY: 1,
      preventDefault: () => {},
      stopImmediatePropagation: () => {},
      stopPropagation: () => {},
    })

    expect(direction).toBe(-1)
  })
})
