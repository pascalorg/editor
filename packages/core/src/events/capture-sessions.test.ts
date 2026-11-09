import { describe, expect, test } from 'bun:test'
import { emitter } from './bus'
import { isCaptureSessionOn, subscribeCaptureSessions } from './capture-sessions'

const session = (owner: string, active: boolean) =>
  emitter.emit('camera-controls:capture-session', { owner, active })

describe('the capture sessions', () => {
  // A sheet's pictures and an agent's view overlap: one session from the first start to the last
  // end, heard by a listener only when that changes.
  test('are on from the first start to the last end, whatever the order', () => {
    const heard: boolean[] = []
    const stop = subscribeCaptureSessions(() => heard.push(isCaptureSessionOn()))
    const seen: boolean[] = []
    for (const [owner, active] of [
      ['sheets-a', true],
      ['view-b', true],
      ['sheets-a', false],
      ['nobody', false],
      ['', true],
      ['view-b', false],
    ] as const) {
      session(owner, active)
      seen.push(isCaptureSessionOn())
    }
    stop()
    expect(seen).toEqual([true, true, true, true, true, false])
    expect(heard).toEqual([true, false])
  })

  // Bones turned on, or a renderer mounted, while a view is being taken: it reads the session the
  // moment it asks, because the sessions are counted from the moment core loads.
  test('a session that began before anyone listened is known to the first who asks', () => {
    session('view-early', true)
    const heard: boolean[] = []
    const stop = subscribeCaptureSessions(() => heard.push(isCaptureSessionOn()))
    expect(isCaptureSessionOn()).toBe(true)
    session('view-early', false)
    stop()
    expect(heard).toEqual([false])
    expect(isCaptureSessionOn()).toBe(false)
  })
})
