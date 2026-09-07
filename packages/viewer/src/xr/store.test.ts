// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { describe, expect, test } from 'bun:test'
import { HAND_JOINTS, VisibleXRController, VisibleXRHand } from './input-visuals'
import { createViewerXRStore } from './store'

describe('createViewerXRStore', () => {
  test('uses local controller and hand visuals that do not depend on remote model assets', () => {
    const store = createViewerXRStore()
    expect(store.getState().controller).toBe(VisibleXRController)
    expect(store.getState().hand).toBe(VisibleXRHand)
    store.destroy()
  })

  test('covers every standard WebXR hand joint', () => {
    expect(HAND_JOINTS).toHaveLength(25)
    expect(new Set(HAND_JOINTS).size).toBe(HAND_JOINTS.length)
    expect(HAND_JOINTS).toContain('wrist')
    expect(HAND_JOINTS).toContain('index-finger-tip')
    expect(HAND_JOINTS).toContain('pinky-finger-tip')
  })
})
