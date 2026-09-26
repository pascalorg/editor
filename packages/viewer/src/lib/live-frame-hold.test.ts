// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { holdLiveFrame, isLiveFrameHeld } from './live-frame-hold'

describe('live frame hold', () => {
  test('nested holds keep the frame until the last one lets go', () => {
    expect(isLiveFrameHeld()).toBe(false)
    const outer = holdLiveFrame()
    const inner = holdLiveFrame()
    inner()
    expect(isLiveFrameHeld()).toBe(true)
    outer()
    expect(isLiveFrameHeld()).toBe(false)
  })

  test('a release called twice lets go once', () => {
    const first = holdLiveFrame()
    const second = holdLiveFrame()
    first()
    first()
    expect(isLiveFrameHeld()).toBe(true)
    second()
    expect(isLiveFrameHeld()).toBe(false)
  })

  test('a hold nobody releases lapses on its own', async () => {
    const release = holdLiveFrame(20)
    expect(isLiveFrameHeld()).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(isLiveFrameHeld()).toBe(false)
    release()
    expect(isLiveFrameHeld()).toBe(false)
  })
})
