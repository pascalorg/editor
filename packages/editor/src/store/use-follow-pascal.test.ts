import { beforeEach, describe, expect, test } from 'bun:test'
import { FOLLOW_PASCAL_STORAGE_KEY, useFollowPascal } from './use-follow-pascal'

// Follow Pascal's switch and its pause: touching the camera pauses it and offers "Resume following";
// a new build starts it again; the switch itself is the person's, kept across sessions.
beforeEach(() => {
  useFollowPascal.setState({ on: true, paused: false, building: false })
})

describe('Follow Pascal', () => {
  test('is on until the person turns it off, and turning it off clears a pause', () => {
    expect(useFollowPascal.getState().on).toBe(true)
    useFollowPascal.getState().pause()
    expect(useFollowPascal.getState().paused).toBe(true)
    useFollowPascal.getState().setOn(false)
    expect(useFollowPascal.getState()).toMatchObject({ on: false, paused: false })
  })

  test('a pause waits for the person, and only matters while it is on', () => {
    useFollowPascal.setState({ on: false })
    useFollowPascal.getState().pause()
    expect(useFollowPascal.getState().paused).toBe(false)
    useFollowPascal.setState({ on: true })
    useFollowPascal.getState().pause()
    expect(useFollowPascal.getState().paused).toBe(true)
    useFollowPascal.getState().resume()
    expect(useFollowPascal.getState().paused).toBe(false)
  })

  test('a build that begins takes the camera again, even after a pause', () => {
    useFollowPascal.getState().pause()
    useFollowPascal.getState().beginBuild()
    expect(useFollowPascal.getState()).toMatchObject({ paused: false, building: true })
    useFollowPascal.getState().endBuild()
    expect(useFollowPascal.getState().building).toBe(false)
  })

  test('only the switch is kept across sessions', () => {
    const persisted = (
      useFollowPascal as unknown as {
        persist: { getOptions(): { partialize?: (state: unknown) => unknown; name?: string } }
      }
    ).persist.getOptions()
    expect(persisted.name).toBe(FOLLOW_PASCAL_STORAGE_KEY)
    expect(persisted.partialize?.({ on: false, paused: true, building: true })).toEqual({
      on: false,
    })
  })

  test('the pill offers itself only to a paused follower during a build', () => {
    const shows = () => {
      const { on, paused, building } = useFollowPascal.getState()
      return on && paused && building
    }
    useFollowPascal.getState().beginBuild()
    expect(shows()).toBe(false)
    useFollowPascal.getState().pause()
    expect(shows()).toBe(true)
    useFollowPascal.getState().endBuild()
    expect(shows()).toBe(false)
  })
})
