import { describe, expect, test } from 'bun:test'
import { Ray, Vector3 } from 'three'
import { getSpatialPointerId, SpatialPointerInput } from './spatial-pointer-input'

describe('SpatialPointerInput', () => {
  test('recognizes current and legacy XR native event shapes', () => {
    const source = {}
    expect(getSpatialPointerId({ inputSource: source })).toBe(source)
    expect(getSpatialPointerId({ pointerState: { inputSource: source } })).toBe(source)
    expect(getSpatialPointerId({ pointerType: 'mouse' })).toBeNull()
  })

  test('keeps move and release bound to the pointer that captured a handle', () => {
    const input = new SpatialPointerInput()
    const moves: Ray[] = []
    let releases = 0

    input.capture(42, {
      onMove: (ray) => moves.push(ray.clone()),
      onRelease: () => releases++,
      onCancel: () => undefined,
    })

    const ray = new Ray(new Vector3(1, 2, 3), new Vector3(0, 1, 0))
    expect(input.move(7, ray)).toBe(false)
    expect(input.move(42, ray)).toBe(true)
    expect(input.release(7)).toBe(false)
    expect(input.release(42)).toBe(true)
    expect(moves).toHaveLength(1)
    expect(moves[0]?.origin.toArray()).toEqual([1, 2, 3])
    expect(releases).toBe(1)
    expect(input.move(42, ray)).toBe(false)
  })

  test('cancels a captured handle without releasing it', () => {
    const input = new SpatialPointerInput()
    let cancels = 0
    let releases = 0

    input.capture(9, {
      onMove: () => undefined,
      onRelease: () => releases++,
      onCancel: () => cancels++,
    })

    expect(input.cancel(9)).toBe(true)
    expect(cancels).toBe(1)
    expect(releases).toBe(0)
  })
})
