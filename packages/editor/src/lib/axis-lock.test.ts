import { afterEach, describe, expect, test } from 'bun:test'
import useAxisLock from '../store/use-axis-lock'
import useMeasurementInput, { resolveDraftConstraint } from '../store/use-measurement-input'
import { AXIS_LOCK_KEYS, applyAxisLock } from './axis-lock'

afterEach(() => {
  useAxisLock.setState({ axis: null })
  useMeasurementInput.setState({ buffer: '', field: 'length' })
})

describe('applyAxisLock', () => {
  test('locking X keeps the draft on the anchor Z', () => {
    expect(applyAxisLock([1, 2], [7, 9], 'x')).toEqual([7, 2])
  })

  test('locking Z keeps the draft on the anchor X', () => {
    expect(applyAxisLock([1, 2], [7, 9], 'z')).toEqual([1, 9])
  })
})

describe('arrow key bindings', () => {
  test('maps the horizontal arrows to the plan axes', () => {
    expect(AXIS_LOCK_KEYS.ArrowRight).toBe('x')
    expect(AXIS_LOCK_KEYS.ArrowLeft).toBe('z')
  })

  test('leaves the vertical arrows unbound — plan drafting cannot honour them', () => {
    expect(AXIS_LOCK_KEYS.ArrowUp).toBeUndefined()
    expect(AXIS_LOCK_KEYS.ArrowDown).toBeUndefined()
  })
})

describe('the lock toggles', () => {
  test('pressing the same axis again releases it', () => {
    useAxisLock.getState().toggle('x')
    expect(useAxisLock.getState().axis).toBe('x')
    useAxisLock.getState().toggle('x')
    expect(useAxisLock.getState().axis).toBeNull()
  })

  test('pressing the other axis switches rather than stacking', () => {
    useAxisLock.getState().toggle('x')
    useAxisLock.getState().toggle('z')
    expect(useAxisLock.getState().axis).toBe('z')
  })
})

describe('resolveDraftConstraint composes lock and typed length', () => {
  test('the lock alone constrains direction, leaving distance to the cursor', () => {
    useAxisLock.getState().toggle('x')
    const point = resolveDraftConstraint([0, 0], [3, 4], [3, 4])
    expect(point).toEqual([3, 0])
  })

  test('the lock overrides the angle-snapped direction the caller proposed', () => {
    useAxisLock.getState().toggle('z')
    // Caller proposes an angle-snapped target; the raw cursor is what the lock
    // projects, so the explicit key wins over the mode.
    const point = resolveDraftConstraint([0, 0], [5, 5], [3, 4])
    expect(point).toEqual([0, 4])
  })

  test('lock sets the direction and the typed value sets the distance', () => {
    useAxisLock.getState().toggle('x')
    useMeasurementInput.setState({ buffer: '10', field: 'length' })
    const point = resolveDraftConstraint([0, 0], [3, 4], [3, 4])
    expect(point).not.toBeNull()
    const [x, z] = point as readonly [number, number]
    expect(x).toBeCloseTo(10, 6)
    expect(z).toBeCloseTo(0, 6)
  })

  test('a typed value with no lock still follows the cursor direction', () => {
    useMeasurementInput.setState({ buffer: '10', field: 'length' })
    const point = resolveDraftConstraint([0, 0], [3, 4], [3, 4])
    const [x, z] = point as readonly [number, number]
    expect(x).toBeCloseTo(6, 6)
    expect(z).toBeCloseTo(8, 6)
  })

  test('neither constraint leaves the caller to its own snapping', () => {
    expect(resolveDraftConstraint([0, 0], [3, 4], [3, 4])).toBeNull()
  })

  test('a typed value on a degenerate direction falls back to the lock', () => {
    useAxisLock.getState().toggle('x')
    useMeasurementInput.setState({ buffer: '10', field: 'length' })
    // Cursor still sitting on the anchor: no direction to scale, but the lock
    // is still a meaningful answer.
    const point = resolveDraftConstraint([2, 2], [2, 2], [2, 2])
    expect(point).toEqual([2, 2])
  })
})
