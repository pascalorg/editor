// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { beforeEach, describe, expect, test } from 'bun:test'
import { toggleXRPlayerMode, useXRPlayerMode, XR_PLAYER_MODES } from './player-mode'

describe('XR player mode', () => {
  beforeEach(() => useXRPlayerMode.getState().setMode(XR_PLAYER_MODES.GOD))

  test('toggles between God and Human mode', () => {
    toggleXRPlayerMode()
    expect(useXRPlayerMode.getState().mode).toBe(XR_PLAYER_MODES.HUMAN)
    toggleXRPlayerMode()
    expect(useXRPlayerMode.getState().mode).toBe(XR_PLAYER_MODES.GOD)
  })
})
