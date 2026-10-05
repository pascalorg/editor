// @ts-expect-error Bun provides this module only to the test runtime.
import { describe, expect, test } from 'bun:test'
import { Layers } from 'three'
import {
  enableImmersiveXRViewLayers,
  viewerCameraClipping,
  viewerUsesPerspectiveCamera,
} from './viewer-camera'

describe('immersive viewer camera', () => {
  test('uses XR clipping and perspective projection', () => {
    expect(viewerCameraClipping(true)).toEqual({ far: 10_000, near: 0.001 })
    expect(viewerUsesPerspectiveCamera('orthographic', true)).toBe(true)
  })

  test('enables and restores the XR presentation layers', () => {
    const cameraLayers = new Layers()
    const raycasterLayers = new Layers()
    const cameraMask = cameraLayers.mask
    const raycasterMask = raycasterLayers.mask
    const restore = enableImmersiveXRViewLayers(cameraLayers, raycasterLayers)
    expect(cameraLayers.mask).not.toBe(cameraMask)
    expect(raycasterLayers.mask).not.toBe(raycasterMask)
    restore()
    expect(cameraLayers.mask).toBe(cameraMask)
    expect(raycasterLayers.mask).toBe(raycasterMask)
  })
})
