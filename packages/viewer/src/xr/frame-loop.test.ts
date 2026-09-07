// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { describe, expect, mock, test } from 'bun:test'
import {
  advanceXRFrameWithoutDesktopRender,
  ownsXRFrameLoopBinding,
  renderImmersiveXRFrame,
  shouldMountPostProcessingRenderDriver,
  shouldPauseFrameLimiterForXR,
  stopXRFrameLoop,
  takeOverXRFrameLoop,
  unifyXRStereoCameraLayers,
} from './frame-loop'

describe('takeOverXRFrameLoop', () => {
  test('a superseded binding cannot restore over the current XR frame loop', () => {
    const staleBinding = Symbol('stale')
    const currentBinding = Symbol('current')

    expect(ownsXRFrameLoopBinding(currentBinding, staleBinding)).toBe(false)
    expect(ownsXRFrameLoopBinding(currentBinding, currentBinding)).toBe(true)
  })

  test('advances R3F effects without issuing its desktop-camera render', () => {
    const state = { internal: { priority: 0 } }
    let priorityDuringAdvance = 0

    advanceXRFrameWithoutDesktopRender(state, () => {
      priorityDuringAdvance = state.internal.priority
    })

    expect(priorityDuringAdvance).toBe(1)
    expect(state.internal.priority).toBe(0)
  })

  test('restores R3F render priority when frame advancement fails', () => {
    const state = { internal: { priority: 2 } }

    expect(() =>
      advanceXRFrameWithoutDesktopRender(state, () => {
        throw new Error('advance failed')
      }),
    ).toThrow('advance failed')
    expect(state.internal.priority).toBe(2)
  })

  test('pauses the desktop frame loop as soon as an XR session is supplied', () => {
    expect(shouldPauseFrameLimiterForXR(false, {} as XRSession)).toBe(true)
    expect(shouldPauseFrameLimiterForXR(false, undefined)).toBe(false)
    expect(shouldPauseFrameLimiterForXR(true, undefined)).toBe(true)
  })

  test('leaves XR rendering exclusively to Three’s XR animation loop', () => {
    expect(shouldMountPostProcessingRenderDriver(true)).toBe(false)
    expect(shouldMountPostProcessingRenderDriver(false)).toBe(true)
  })

  test('updates the stereo camera before drawing the immersive scene', () => {
    const calls: string[] = []
    const xrOrigin = { type: 'xr-origin' }
    const xrCamera = { parent: xrOrigin, type: 'xr-camera' }
    const appCamera = { parent: null, type: 'app-camera' }
    const renderer = {
      render: mock((_scene: unknown, camera: unknown) => {
        expect(camera).toBe(appCamera)
        expect(appCamera.parent).toBeNull()
        calls.push('render')
      }),
      xr: {
        cameraAutoUpdate: true,
        getCamera: mock(() => {
          calls.push('get-camera')
          return xrCamera
        }),
        updateCamera: mock(() => {
          expect(appCamera.parent).toBe(xrOrigin)
          calls.push('update-camera')
        }),
      },
    }

    renderImmersiveXRFrame(renderer, { type: 'scene' }, appCamera)

    expect(calls).toEqual(['get-camera', 'update-camera', 'render'])
    expect(renderer.xr.cameraAutoUpdate).toBe(true)
  })

  test('restores the application camera parent when stereo updating fails', () => {
    const appParent = { type: 'app-parent' }
    const appCamera = { parent: appParent }
    const renderer = {
      render: mock(() => undefined),
      xr: {
        cameraAutoUpdate: true,
        getCamera: mock(() => ({ parent: { type: 'xr-origin' } })),
        updateCamera: mock(() => {
          throw new Error('update failed')
        }),
      },
    }

    expect(() => renderImmersiveXRFrame(renderer, {}, appCamera)).toThrow('update failed')
    expect(appCamera.parent).toBe(appParent)
  })

  test('restores automatic camera updates when an XR draw fails', () => {
    const renderer = {
      render: mock(() => {
        throw new Error('draw failed')
      }),
      xr: {
        cameraAutoUpdate: true,
        getCamera: mock(() => ({ type: 'xr-camera' })),
        updateCamera: mock(() => undefined),
      },
    }

    expect(() => renderImmersiveXRFrame(renderer, {}, {})).toThrow('draw failed')
    expect(renderer.xr.cameraAutoUpdate).toBe(true)
  })

  test('renders overlay and zone layers in both stereo eyes', () => {
    const left = { layers: { mask: 0b1011 } }
    const right = { layers: { mask: 0b1101 } }
    const camera = { cameras: [left, right], layers: { mask: 0b1111 } }

    unifyXRStereoCameraLayers(camera)

    expect(left.layers.mask).toBe(0b1111)
    expect(right.layers.mask).toBe(0b1111)
  })

  test('disconnects R3F and installs the renderer-owned XR frame loop', async () => {
    const calls: string[] = []
    const setAnimationLoop = mock(async (callback: XRFrameRequestCallback | null) => {
      calls.push(callback ? 'set-loop' : 'clear-loop')
    })
    const renderer = {
      setAnimationLoop,
      setPixelRatio: mock((dpr: number) => calls.push(`dpr:${dpr}`)),
      setSize: mock((width: number, height: number) => calls.push(`size:${width}x${height}`)),
      xr: { enabled: false, isPresenting: false },
    }
    const r3fXR = {
      disconnect: mock(() => calls.push('disconnect')),
    }
    const renderFrame = (() => undefined) as XRFrameRequestCallback

    const restore = await takeOverXRFrameLoop(renderer, r3fXR, renderFrame, {
      dpr: 1.5,
      height: 800,
      width: 936,
    })

    expect(calls).toEqual(['disconnect', 'dpr:1.5', 'size:936x800', 'set-loop'])
    expect(renderer.xr.enabled).toBe(true)
    expect(setAnimationLoop).toHaveBeenCalledWith(renderFrame)

    restore()

    expect(calls).toEqual(['disconnect', 'dpr:1.5', 'size:936x800', 'set-loop', 'clear-loop'])
    expect(renderer.xr.enabled).toBe(false)
  })

  test('keeps Three’s XR wrapper alive until the presenting session ends', async () => {
    const setAnimationLoop = mock(async () => undefined)
    const renderer = {
      setAnimationLoop,
      setPixelRatio: mock(() => undefined),
      setSize: mock(() => undefined),
      xr: { enabled: false, isPresenting: false },
    }

    const restore = await takeOverXRFrameLoop(
      renderer,
      null,
      (() => undefined) as XRFrameRequestCallback,
      { dpr: 1, height: 800, width: 1280 },
    )
    renderer.xr.isPresenting = true
    restore()

    expect(setAnimationLoop).toHaveBeenCalledTimes(1)
    expect(renderer.xr.enabled).toBe(true)

    renderer.xr.isPresenting = false
    stopXRFrameLoop(renderer)

    expect(setAnimationLoop).toHaveBeenLastCalledWith(null)
    expect(renderer.xr.enabled).toBe(false)
  })
})
