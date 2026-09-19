// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { describe, expect, test } from 'bun:test'
import { DefaultXRController, DefaultXRHand } from '@react-three/xr'
import { createViewerXRStore } from './store'

describe('createViewerXRStore', () => {
  test('uses the same default controller and hand models as WebXR Home', () => {
    const store = createViewerXRStore()
    expect(store.getState().controller).toBe(DefaultXRController)
    expect(store.getState().hand).toBe(DefaultXRHand)
    store.destroy()
  })
})
