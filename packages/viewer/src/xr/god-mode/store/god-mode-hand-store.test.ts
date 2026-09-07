// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { beforeEach, describe, expect, test } from 'bun:test'
import { Vector3 } from 'three'
import {
  clearGodScaleHandState,
  getGodScaleHandState,
  updateGodScaleHandState,
} from './god-mode-hand-store'

describe('God-scale hand state', () => {
  beforeEach(() => clearGodScaleHandState('left'))

  test('publishes a palm gesture as the same grab used by controllers', () => {
    updateGodScaleHandState('left', true, true, new Vector3(1, 2, 3))

    expect(getGodScaleHandState('left')).toMatchObject({ grabbed: true, tracked: true })
    expect(getGodScaleHandState('left').position.toArray()).toEqual([1, 2, 3])
  })
})
