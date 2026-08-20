import { describe, expect, test } from 'bun:test'
import {
  hiddenWallPointerEventsHeld,
  holdHiddenWallPointerEvents,
} from './hidden-wall-pointer-hold'

describe('hidden-wall pointer hold', () => {
  test('idle by default; a hold flips it; release restores it', () => {
    expect(hiddenWallPointerEventsHeld()).toBe(false)
    const release = holdHiddenWallPointerEvents()
    expect(hiddenWallPointerEventsHeld()).toBe(true)
    release()
    expect(hiddenWallPointerEventsHeld()).toBe(false)
  })

  test('overlapping holds compose — held until the LAST release', () => {
    const releaseA = holdHiddenWallPointerEvents()
    const releaseB = holdHiddenWallPointerEvents()
    expect(hiddenWallPointerEventsHeld()).toBe(true)
    releaseA()
    // B (say a move tool mounted while a place tool unwinds) still holds.
    expect(hiddenWallPointerEventsHeld()).toBe(true)
    releaseB()
    expect(hiddenWallPointerEventsHeld()).toBe(false)
  })

  test('release is idempotent — a double effect-cleanup cannot underflow', () => {
    const releaseA = holdHiddenWallPointerEvents()
    releaseA()
    releaseA()
    releaseA()
    expect(hiddenWallPointerEventsHeld()).toBe(false)
    // A later hold must still register despite the extra releases above.
    const releaseB = holdHiddenWallPointerEvents()
    expect(hiddenWallPointerEventsHeld()).toBe(true)
    releaseB()
    expect(hiddenWallPointerEventsHeld()).toBe(false)
  })
})
