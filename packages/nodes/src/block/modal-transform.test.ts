import { describe, expect, test } from 'bun:test'
import {
  blockAxisDelta,
  blockAxisVisualState,
  blockConstrainTranslationDelta,
  blockModalTransformStatus,
  blockNumericDeltaForConstraint,
  blockPlaneVisualState,
  blockPointerDistanceForAxis,
  blockRotationPointerAngle,
  blockScaleFactorsForConstraint,
  blockTransformAxisFromKey,
  blockTransformConstraintFromKey,
  blockTransformDisplayValue,
  blockTransformNumericInputFromKey,
  blockTransformNumericValue,
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

  test('keeps pointer-derived movement aligned with every visible gizmo axis', () => {
    expect(blockPointerDistanceForAxis('x', 1.25)).toBe(1.25)
    expect(blockPointerDistanceForAxis('y', -0.5)).toBe(-0.5)
    expect(blockPointerDistanceForAxis('z', 0.75)).toBe(0.75)
  })

  test('keeps only the locked operation axis colorful', () => {
    const active = { operation: 'translate', constraint: 'y' } as const
    expect(blockAxisVisualState(active, 'translate', 'y')).toBe('active')
    expect(blockAxisVisualState(active, 'translate', 'x')).toBe('faded')
    expect(blockAxisVisualState(active, 'rotate', 'y')).toBe('faded')
  })

  test('maps shifted axis shortcuts to the plane that excludes that axis', () => {
    expect(blockTransformConstraintFromKey('X', true)).toBe('yz')
    expect(blockTransformConstraintFromKey('y', true)).toBe('xz')
    expect(blockTransformConstraintFromKey('Z', true)).toBe('xy')
    expect(blockTransformConstraintFromKey('x', false)).toBe('x')
  })

  test('keeps accumulated movement when it is projected onto a plane lock', () => {
    expect(blockConstrainTranslationDelta([0.6, 0.4, 0.2], 'xy')).toEqual([0.6, 0.4, 0])
    expect(blockConstrainTranslationDelta([0.6, 0.4, 0.2], 'yz')).toEqual([0, 0.4, 0.2])
  })

  test('keeps the constrained plane axes and plane handle colorful', () => {
    const active = { operation: 'translate', constraint: 'xz' } as const
    expect(blockAxisVisualState(active, 'translate', 'x')).toBe('active')
    expect(blockAxisVisualState(active, 'translate', 'z')).toBe('active')
    expect(blockAxisVisualState(active, 'translate', 'y')).toBe('faded')
    expect(blockPlaneVisualState(active, 'xz')).toBe('active')
    expect(blockPlaneVisualState(active, 'xy')).toBe('faded')
  })

  test('keeps typed movement inside the active plane', () => {
    expect(blockNumericDeltaForConstraint('xz', [3, 10, 4], 5)).toEqual([3, 0, 4])
    expect(blockNumericDeltaForConstraint('y', [3, 10, 4], -2)).toEqual([0, -2, 0])
    expect(blockNumericDeltaForConstraint('free', [0, 0, 0], 1.5)).toEqual([1.5, 0, 0])
  })

  test('scales only the axes included by the active constraint', () => {
    expect(blockScaleFactorsForConstraint('yz', 2)).toEqual([1, 2, 2])
    expect(blockScaleFactorsForConstraint('x', 0.5)).toEqual([0.5, 1, 1])
    expect(blockScaleFactorsForConstraint('uniform', 1.25)).toEqual([1.25, 1.25, 1.25])
  })

  test('describes the current operation and constraint', () => {
    expect(blockModalTransformStatus({ operation: 'rotate', constraint: 'z' })).toBe(
      'Rotate · Z axis · Free · X/Y/Z constrains · click applies · Esc cancels',
    )
  })

  test('formats live values in the operation user-facing unit', () => {
    expect(blockTransformDisplayValue('translate', 1.23456)).toBe('1.235')
    expect(blockTransformDisplayValue('rotate', Math.PI / 2)).toBe('90')
    expect(blockTransformDisplayValue('scale', 1.25)).toBe('1.25')
  })

  test('rotates from horizontal movement when the gesture starts on the pivot', () => {
    expect(
      blockRotationPointerAngle({ x: 100, y: 100 }, { x: 100, y: 100 }, { x: 120, y: 100 }),
    ).not.toBe(0)
  })

  test('builds signed decimal input and supports correction', () => {
    let input = ''
    for (const key of ['2', '.', '5']) {
      input = blockTransformNumericInputFromKey(input, key)!
    }
    expect(input).toBe('2.5')
    expect(blockTransformNumericInputFromKey(input, '-')).toBe('-2.5')
    expect(blockTransformNumericInputFromKey('-2.5', 'Backspace')).toBe('-2.')
    expect(blockTransformNumericInputFromKey('2.5', '.')).toBe('2.5')
    expect(blockTransformNumericInputFromKey('2.5', 'x')).toBeNull()
  })

  test('interprets typed distance, angle, and scale values in their user-facing units', () => {
    expect(blockTransformNumericValue('2.5', 'translate')).toBe(2.5)
    expect(blockTransformNumericValue('-45', 'rotate')).toBeCloseTo(-Math.PI / 4)
    expect(blockTransformNumericValue('1.25', 'scale')).toBe(1.25)
    expect(blockTransformNumericValue('-', 'translate')).toBeNull()
  })

  test('includes the typed value in modal feedback', () => {
    expect(
      blockModalTransformStatus({ operation: 'translate', constraint: 'z' }, '-1.25', 'exact'),
    ).toBe('Move · Z axis · -1.25 m · Exact · X/Y/Z constrains · click applies · Esc cancels')
    expect(blockModalTransformStatus({ operation: 'rotate', constraint: 'y' }, '45', 'angle')).toBe(
      'Rotate · Y axis · 45° · Angle snap · X/Y/Z constrains · click applies · Esc cancels',
    )
    expect(blockModalTransformStatus({ operation: 'translate', constraint: 'xz' })).toBe(
      'Move · XZ plane · Free · X/Y/Z constrains · click applies · Esc cancels',
    )
  })
})
