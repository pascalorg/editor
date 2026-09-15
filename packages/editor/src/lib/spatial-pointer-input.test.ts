import { describe, expect, test } from 'bun:test'
import { Ray } from 'three'
import { SpatialPointerInput } from './spatial-pointer-input'

describe('spatial handle capture', () => {
  test('keeps rays and release with the source that started the drag', () => {
    const input = new SpatialPointerInput()
    const left = {},
      right = {}
    const rays: Ray[] = []
    let commits = 0
    input.capture(left, {
      onMove: (ray) => rays.push(ray),
      onRelease: () => commits++,
      onCancel: () => {},
    })
    const ray = new Ray()
    expect(input.move(right, ray)).toBe(false)
    expect(input.release(right)).toBe(false)
    expect(input.move(left, ray)).toBe(true)
    expect(rays).toEqual([ray])
    expect(input.release(left)).toBe(true)
    expect(input.release(left)).toBe(false)
    expect(commits).toBe(1)
  })
  test('disconnect cancels without committing, and stale cleanup cannot remove a new capture', () => {
    const input = new SpatialPointerInput()
    const source = {}
    let cancelled = 0
    const callbacks = {
      onMove: () => {},
      onRelease: () => {
        throw new Error('unexpected commit')
      },
      onCancel: () => cancelled++,
    }
    const staleCleanup = input.capture(source, callbacks)
    input.capture(source, { ...callbacks })
    staleCleanup()
    expect(input.cancel(source)).toBe(true)
    expect(cancelled).toBe(1)
    expect(input.cancel(source)).toBe(false)
  })
})
