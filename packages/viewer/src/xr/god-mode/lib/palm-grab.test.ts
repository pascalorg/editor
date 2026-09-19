// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { describe, expect, test } from 'bun:test'
import { advancePalmGrab, PALM_GRAB_HOLD_SECONDS } from './palm-grab'

const wrist = { x: 0, y: 0, z: 0 }
const closedPose = {
  wrist,
  middle: { metacarpal: { x: 1, y: 0, z: 0 }, tip: { x: 1.4, y: 0, z: 0 } },
  ring: { metacarpal: { x: 0, y: 1, z: 0 }, tip: { x: 0, y: 1.4, z: 0 } },
  pinky: { metacarpal: { x: -1, y: 0, z: 0 }, tip: { x: -1.4, y: 0, z: 0 } },
}

describe('palm grab', () => {
  test('activates only after all three fingers remain curled for the hold time', () => {
    const state = { grabbed: false, elapsed: 0 }

    expect(advancePalmGrab(state, closedPose, PALM_GRAB_HOLD_SECONDS - 0.01)).toBe(false)
    expect(advancePalmGrab(state, closedPose, 0.01)).toBe(true)
  })

  test('stays grabbed through tracking noise and releases when a finger opens', () => {
    const state = { grabbed: true, elapsed: PALM_GRAB_HOLD_SECONDS }
    const partlyOpenPose = {
      ...closedPose,
      middle: { ...closedPose.middle, tip: { x: 2.8, y: 0, z: 0 } },
    }
    const openPose = {
      ...closedPose,
      middle: { ...closedPose.middle, tip: { x: 3.4, y: 0, z: 0 } },
    }

    expect(advancePalmGrab(state, partlyOpenPose, 0.016)).toBe(true)
    expect(advancePalmGrab(state, openPose, 0.016)).toBe(false)
  })
})
