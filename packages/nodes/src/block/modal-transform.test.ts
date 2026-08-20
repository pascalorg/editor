import { describe, expect, test } from 'bun:test'
import {
  blockAxisDelta,
  blockAxisVisualState,
  blockModalTransformStatus,
  blockRotationPointerAngle,
  blockTransformAxisFromKey,
} from './modal-transform'

describe('block modal transform', () => {
  test('recognizes case-insensitive transform-axis shortcuts', () => {
    expect(blockTransformAxisFromKey('X')).toBe('x')
    expect(blockTransformAxisFromKey('y')).toBe('y')
    expect(blockTransformAxisFromKey('G')).toBeNull()
  })

  test('constrains movement to one local axis', () => {
    expect(blockAxisDelta('x', 1.25)).toEqual([1.25, 0, 0])
    expect(blockAxisDelta('y', -0.5)).toEqual([0, -0.5, 0])
    expect(blockAxisDelta('z', 2)).toEqual([0, 0, 2])
  })

  test('keeps only the locked operation axis colorful', () => {
    const active = { operation: 'translate', constraint: 'y' } as const
    expect(blockAxisVisualState(active, 'translate', 'y')).toBe('active')
    expect(blockAxisVisualState(active, 'translate', 'x')).toBe('faded')
    expect(blockAxisVisualState(active, 'rotate', 'y')).toBe('faded')
  })

  test('describes the current operation and constraint', () => {
    expect(blockModalTransformStatus({ operation: 'rotate', constraint: 'z' })).toBe(
      'Rotate · Z axis · X/Y/Z constrains · click applies · Esc cancels',
    )
  })

  test('rotates from horizontal movement when the gesture starts on the pivot', () => {
    expect(
      blockRotationPointerAngle({ x: 100, y: 100 }, { x: 100, y: 100 }, { x: 120, y: 100 }),
    ).not.toBe(0)
  })
})
