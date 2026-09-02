'use client'

import { advance, useStore, useThree } from '@react-three/fiber'
import { XR, XROrigin } from '@react-three/xr'
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import FrameLimiter from '../components/viewer/frame-limiter'
import { applyViewerCameraClipping, viewerCameraClipping } from '../components/viewer/viewer-camera'
import {
  renderImmersiveXRFrame,
  shouldPauseFrameLimiterForXR,
  stopXRFrameLoop,
  takeOverXRFrameLoop,
  type XRFrameLoopRenderer,
} from './frame-loop'
import type { ViewerXRStore } from './store'

function XRFrameLimiter({
  fps,
  paused,
  session,
}: {
  fps: number
  paused: boolean
  session?: XRSession
}) {
  return <FrameLimiter fps={fps} paused={shouldPauseFrameLimiterForXR(paused, session)} />
}

function configureWebGLXRBaseLayer(manager: { [key: string]: unknown }) {
  // Three prefers XRProjectionLayer whenever a partial XRWebGLBinding exists.
  // IWER exposes that binding but drives input frames from XRWebGLLayer, so
  // projection-layer selection leaves the session without a base layer.
  if ('_supportsLayers' in manager) manager._supportsLayers = false
}

function XRSessionBinding({ session, store }: { session?: XRSession; store: ViewerXRStore }) {
  const renderer = useThree((state) => state.gl)
  const r3fXR = useThree((state) => state.xr)
  const rootStore = useStore()

  useEffect(() => {
    const manager = renderer.xr
    if (!session) return

    let cancelled = false
    let restoreFrameLoop: (() => void) | undefined
    const state = rootStore.getState()

    const attachSession = async () => {
      // Attach the session before starting the renderer-owned loop. IWER
      // publishes input sources on its first frame; starting the loop first
      // can race @react-three/xr's session synchronization and leave the
      // store with a session but no controllers or hands.
      r3fXR?.disconnect()
      configureWebGLXRBaseLayer(manager as unknown as { [key: string]: unknown })
      const restore = await takeOverXRFrameLoop(
        renderer as unknown as XRFrameLoopRenderer,
        r3fXR,
        (time, frame) => {
          if (!frame) return
          const frameState = rootStore.getState()
          advance(time, true, frameState, frame)

          renderImmersiveXRFrame(renderer, frameState.scene, frameState.camera)
        },
        {
          dpr: state.viewport.dpr,
          height: state.size.height,
          width: state.size.width,
        },
      )
      restoreFrameLoop = restore
      if (cancelled) {
        restore()
        return
      }

      if (manager.getSession() !== session) await manager.setSession(session)
      session.addEventListener(
        'end',
        () => stopXRFrameLoop(renderer as unknown as XRFrameLoopRenderer),
        { once: true },
      )
      applyViewerCameraClipping(manager.getCamera(), true)
      const clipping = viewerCameraClipping(true)
      session.updateRenderState({
        baseLayer: manager.getBaseLayer() as XRWebGLLayer | undefined,
        depthFar: clipping.far,
        depthNear: clipping.near,
      })

      // The WebGPU renderer's WebGL backend can omit Three's sessionstart event,
      // which leaves @react-three/xr unaware of controllers and hands.
      if (store.getState().session !== session) {
        manager.dispatchEvent({ type: 'sessionstart' })
      }

      if (cancelled) {
        restore()
        return
      }
    }

    void attachSession().catch((error: unknown) => {
      console.error('[viewer] Could not attach the WebXR session', error)
      void session.end().catch(() => undefined)
    })

    return () => {
      cancelled = true
      restoreFrameLoop?.()
    }
  }, [renderer, r3fXR, rootStore, session, store])

  return null
}

export function ViewerXRSessionRoot({
  children,
  fps,
  originPosition,
  paused,
  session,
  store,
}: {
  children: ReactNode
  fps: number
  originPosition?: [number, number, number]
  paused: boolean
  session?: XRSession
  store: ViewerXRStore
}) {
  return (
    <XR store={store}>
      <XROrigin position={originPosition} />
      <XRSessionBinding session={session} store={store} />
      <XRFrameLimiter fps={fps} paused={paused} session={session} />
      {children}
    </XR>
  )
}
