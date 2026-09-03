// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { describe, expect, test } from 'bun:test'
import { Layers } from 'three'
import {
  applyViewerCameraClipping,
  enableImmersiveXRViewLayers,
  viewerCameraClipping,
  viewerUsesPerspectiveCamera,
} from './viewer-camera'

describe('viewerCameraClipping', () => {
  test('uses the WebXR Home clipping range for immersive presentation', () => {
    expect(viewerCameraClipping(true)).toEqual({ far: 10_000, near: 0.001 })
  })

  test('keeps the existing desktop clipping range', () => {
    expect(viewerCameraClipping(false)).toEqual({ far: 1000, near: 0.1 })
  })

  test('XR always uses a perspective camera', () => {
    expect(viewerUsesPerspectiveCamera('orthographic', true)).toBe(true)
    expect(viewerUsesPerspectiveCamera('perspective', true)).toBe(true)
    expect(viewerUsesPerspectiveCamera('orthographic', false)).toBe(false)
  })

  test('XR clipping can be applied to Three’s session camera', () => {
    let projectionUpdates = 0
    const camera = {
      far: 2000,
      near: 0.1,
      updateProjectionMatrix: () => {
        projectionUpdates += 1
      },
    }

    applyViewerCameraClipping(camera, true)

    expect(camera).toMatchObject({ far: 10_000, near: 0.001 })
    expect(projectionUpdates).toBe(1)
  })

  test('XR enables presentation layers and restores the prior masks', () => {
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
