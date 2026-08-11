import { describe, expect, test } from 'bun:test'
import { CUSTOM_MESH_WHEEL_OPTIONS, consumeCustomMeshGestureWheel } from './gesture-wheel'

describe('custom mesh gesture wheel', () => {
  test('captures and consumes wheel input before camera controls receive it', () => {
    const calls: string[] = []
    const direction = consumeCustomMeshGestureWheel({
      deltaY: -1,
      preventDefault: () => calls.push('preventDefault'),
      stopImmediatePropagation: () => calls.push('stopImmediatePropagation'),
      stopPropagation: () => calls.push('stopPropagation'),
    })

    expect(CUSTOM_MESH_WHEEL_OPTIONS).toEqual({ capture: true, passive: false })
    expect(calls).toEqual(['preventDefault', 'stopPropagation', 'stopImmediatePropagation'])
    expect(direction).toBe(1)
  })

  test('returns the decrement direction for wheel-down input', () => {
    const direction = consumeCustomMeshGestureWheel({
      deltaY: 1,
      preventDefault: () => {},
      stopImmediatePropagation: () => {},
      stopPropagation: () => {},
    })

    expect(direction).toBe(-1)
  })
})
