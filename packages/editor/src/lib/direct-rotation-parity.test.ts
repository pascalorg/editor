import { describe, expect, test } from 'bun:test'
import { ROTATE_HANDLE_DRAG_LABEL } from './contextual-help'
import {
  isRotationStepBypassed,
  resolveDirectRotationDragDelta,
  snapDirectRotationDelta,
} from './direct-manipulation'
import { snapContextOf } from './snapping-mode'

// Direct rotation used to obey two different rules: 3D bypassed on Shift, 2D
// asked `isAngleSnapActive()`. These pin the one rule both views now share, and
// the reasoning behind it, because "same gesture, two behaviours" is exactly
// the drift the 2D/3D parity rule exists to catch.

const RADIANS_PER_PIXEL = 0.01
const STEP = Math.PI / 12 // 15°

describe('isRotationStepBypassed', () => {
  test('Alt frees the rotation from its step', () => {
    expect(isRotationStepBypassed({ altKey: true })).toBe(true)
  })

  test('no modifier keeps the step — snapping is the default, not the opt-in', () => {
    expect(isRotationStepBypassed({ altKey: false })).toBe(false)
  })

  test('Shift is not a bypass — it belongs to the snapping-mode cycle', () => {
    expect(isRotationStepBypassed({ altKey: false, shiftKey: true } as never)).toBe(false)
  })
})

describe('rotation snapping', () => {
  test('an unmodified drag lands on a 15° multiple', () => {
    const delta = resolveDirectRotationDragDelta(0, -100, RADIANS_PER_PIXEL, false)
    expect(delta / STEP).toBeCloseTo(Math.round(delta / STEP), 9)
  })

  test('a freed drag keeps the raw angle', () => {
    // 1 radian of drag is not a multiple of 15°, so a free result must differ.
    const free = resolveDirectRotationDragDelta(0, -100, RADIANS_PER_PIXEL, true)
    expect(free).toBeCloseTo(1, 9)
    expect(free % STEP).not.toBeCloseTo(0, 6)
  })

  test('rounding goes to the nearest step, not toward zero', () => {
    expect(snapDirectRotationDelta(STEP * 0.6, false)).toBeCloseTo(STEP, 9)
    expect(snapDirectRotationDelta(STEP * 0.4, false)).toBeCloseTo(0, 9)
  })

  test('both views compute the same delta from the same drag', () => {
    // The 2D and 3D call sites differ only in which event they hold; feeding
    // the shared helper the same bypass has to give the same answer.
    const args = [0, -137, RADIANS_PER_PIXEL] as const
    const event = { altKey: false }
    expect(resolveDirectRotationDragDelta(...args, isRotationStepBypassed(event))).toBe(
      resolveDirectRotationDragDelta(...args, isRotationStepBypassed({ ...event })),
    )
  })
})

describe('why rotation is not mode-driven', () => {
  const args = {
    mode: 'select',
    tool: null,
    profileOf: () => undefined,
    profileOfNode: () => undefined,
  }

  test('a rotate-handle drag resolves no snap context', () => {
    expect(
      snapContextOf({
        ...args,
        scope: { kind: 'handle-drag', nodeId: 'wall_1', handle: ROTATE_HANDLE_DRAG_LABEL },
      }),
    ).toBeNull()
  })

  test('direct rotation opens no scope at all, so it resolves none either', () => {
    // Neither view begins a scope for Cmd+right-drag — it only pauses history.
    // That is why the old 2D code read `'off'` and therefore never snapped.
    expect(snapContextOf({ ...args, scope: { kind: 'idle' } })).toBeNull()
  })
})
