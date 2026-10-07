// @ts-expect-error Bun provides this module only to the test runtime.
import { describe, expect, test } from 'bun:test'
import { Frustum, Layers, Matrix4, PerspectiveCamera, Vector3 } from 'three'
import {
  applyWalkthroughCameraClipping,
  enableImmersiveXRViewLayers,
  viewerCameraClipping,
  viewerUsesPerspectiveCamera,
} from './viewer-camera'

describe('immersive viewer camera', () => {
  test('orbit clips at 0.3 m, while walkthrough keeps a wall at the capsule radius visible', () => {
    const clipping = viewerCameraClipping(false)
    expect(clipping).toEqual({ far: 1000, near: 0.3 })
    const camera = new PerspectiveCamera(50, 1, clipping.near, clipping.far)
    const wall = new Vector3(0, 0, -0.25)
    const visible = () =>
      new Frustum()
        .setFromProjectionMatrix(
          new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
        )
        .containsPoint(wall)
    expect(visible()).toBe(false)
    const restore = applyWalkthroughCameraClipping(camera)
    expect(visible()).toBe(true)
    restore()
    expect(camera.near).toBe(0.3)
    expect(visible()).toBe(false)
  })

  test('walkthrough keeps XR clipping unchanged', () => {
    const camera = new PerspectiveCamera(50, 1, viewerCameraClipping(true).near, 10_000)
    const restore = applyWalkthroughCameraClipping(camera)
    expect(camera.near).toBe(0.001)
    restore()
    expect(camera.near).toBe(0.001)
  })
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
