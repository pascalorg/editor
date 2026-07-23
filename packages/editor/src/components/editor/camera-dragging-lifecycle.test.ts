import { describe, expect, test } from 'bun:test'
import { createCameraDraggingLifecycle } from './camera-dragging-lifecycle'

describe('camera dragging lifecycle', () => {
  test('releases wheel interactions even when camera controls never report rest', () => {
    const dragging: boolean[] = []
    let scheduled: (() => void) | null = null
    const lifecycle = createCameraDraggingLifecycle({
      setDragging: (value) => dragging.push(value),
      schedule: (callback) => {
        scheduled = callback
        return 1 as unknown as ReturnType<typeof globalThis.setTimeout>
      },
      cancel: () => {
        scheduled = null
      },
    })

    lifecycle.begin()
    lifecycle.scheduleEnd()
    expect(dragging).toEqual([true])

    const release = scheduled as (() => void) | null
    release?.()
    expect(dragging).toEqual([true, false])
  })

  test('cancels a pending wheel release when another interaction begins', () => {
    const dragging: boolean[] = []
    let scheduled: (() => void) | null = null
    const lifecycle = createCameraDraggingLifecycle({
      setDragging: (value) => dragging.push(value),
      schedule: (callback) => {
        scheduled = callback
        return 1 as unknown as ReturnType<typeof globalThis.setTimeout>
      },
      cancel: () => {
        scheduled = null
      },
    })

    lifecycle.begin()
    lifecycle.scheduleEnd()
    lifecycle.begin()

    expect(scheduled).toBeNull()
    expect(dragging).toEqual([true, true])
  })
})
