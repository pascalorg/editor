import { describe, expect, test } from 'bun:test'
import { createQuickMeasurementPointerScheduler } from './quick-measurement'

function pointer(clientX: number, clientY: number): PointerEvent {
  return { clientX, clientY } as PointerEvent
}

function createFrameDriver() {
  let nextId = 1
  const callbacks = new Map<number, FrameRequestCallback>()
  return {
    driver: {
      request: (callback: FrameRequestCallback) => {
        const id = nextId++
        callbacks.set(id, callback)
        return id
      },
      cancel: (frameId: number) => callbacks.delete(frameId),
    },
    pending: () => callbacks.size,
    runNext: (timestamp: number) => {
      const next = callbacks.entries().next().value as [number, FrameRequestCallback] | undefined
      if (!next) throw new Error('No animation frame scheduled')
      callbacks.delete(next[0])
      next[1](timestamp)
    },
  }
}

describe('createQuickMeasurementPointerScheduler', () => {
  test('keeps only the latest pointer event and caps expensive work', () => {
    const frames = createFrameDriver()
    const processed: PointerEvent[] = []
    const scheduler = createQuickMeasurementPointerScheduler(
      (event) => processed.push(event),
      frames.driver,
    )

    scheduler.enqueue(pointer(1, 1))
    scheduler.enqueue(pointer(8, 4))
    expect(frames.pending()).toBe(1)
    frames.runNext(0)
    expect(processed.map((event) => [event.clientX, event.clientY])).toEqual([[8, 4]])

    scheduler.enqueue(pointer(12, 4))
    frames.runNext(16)
    expect(processed).toHaveLength(1)
    expect(frames.pending()).toBe(1)

    scheduler.enqueue(pointer(20, 7))
    frames.runNext(32)
    expect(processed.map((event) => [event.clientX, event.clientY])).toEqual([
      [8, 4],
      [20, 7],
    ])
  })

  test('ignores sub-pixel jitter and cancels queued work', () => {
    const frames = createFrameDriver()
    const processed: PointerEvent[] = []
    const scheduler = createQuickMeasurementPointerScheduler(
      (event) => processed.push(event),
      frames.driver,
    )

    scheduler.enqueue(pointer(10, 10))
    frames.runNext(0)
    scheduler.enqueue(pointer(10.5, 10.5))
    frames.runNext(32)
    expect(processed).toHaveLength(1)

    scheduler.enqueue(pointer(20, 20))
    scheduler.clear()
    expect(frames.pending()).toBe(0)
    expect(processed).toHaveLength(1)
  })
})
