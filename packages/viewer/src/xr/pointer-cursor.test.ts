import { describe, expect, test } from 'bun:test'
import {
  DISTANCE_AWARE_RAY_POINTER_OPTIONS,
  POINTER_CURSOR_INNER_RADIUS,
  POINTER_CURSOR_MAX_SIZE,
  POINTER_CURSOR_MIN_SIZE,
  POINTER_CURSOR_OUTER_RADIUS,
  resolvePointerCursorSize,
} from './pointer-cursor'
import { PointerRingMaterial } from './pointer-ring-material'

describe('XR pointer cursor styling', () => {
  test('uses a real ring geometry for the intersection cursor', () => {
    expect(POINTER_CURSOR_INNER_RADIUS).toBe(0.32)
    expect(POINTER_CURSOR_OUTER_RADIUS).toBe(0.5)
    expect(DISTANCE_AWARE_RAY_POINTER_OPTIONS.cursorModel.cursorOffset).toBeGreaterThan(0)
    expect(PointerRingMaterial).toBeDefined()
  })
})

describe('resolvePointerCursorSize', () => {
  test('grows the cursor as the ray intersection gets farther away', () => {
    const near = resolvePointerCursorSize(0.2)
    const medium = resolvePointerCursorSize(1)
    const far = resolvePointerCursorSize(4)

    expect(near).toBeLessThan(medium)
    expect(medium).toBeLessThan(far)
  })

  test('clamps the cursor to visible minimum and maximum sizes', () => {
    expect(resolvePointerCursorSize(0)).toBe(POINTER_CURSOR_MIN_SIZE)
    expect(resolvePointerCursorSize(Number.NaN)).toBe(POINTER_CURSOR_MIN_SIZE)
    expect(resolvePointerCursorSize(100)).toBe(POINTER_CURSOR_MAX_SIZE)
  })
})
