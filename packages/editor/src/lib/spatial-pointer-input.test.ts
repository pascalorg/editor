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

  test('keeps movement and release bound to the captured source', () => {
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
    expect(input.release(42)).toBe(true)
    expect(moves[0]?.origin.toArray()).toEqual([1, 2, 3])
    expect(releases).toBe(1)
  })
})
