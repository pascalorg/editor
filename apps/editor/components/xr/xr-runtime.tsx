'use client'

import { createViewerXRStore, type ViewerXRConfig, type ViewerXRStore } from '@pascal-app/viewer'
import { useEffect, useState } from 'react'
import { prepareXRPlatform, type XRRuntimeSource } from '@/lib/xr/emulator'

type XRRuntimeState =
  | { status: 'idle' | 'loading' }
  | { message: string; status: 'error' }
  | { source: XRRuntimeSource; status: 'ready'; store: ViewerXRStore }
  | { status: 'unsupported' }

export function useEditorXRRuntime(enabled: boolean): XRRuntimeState {
  const [runtime, setRuntime] = useState<XRRuntimeState>({ status: 'idle' })

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    setRuntime({ status: 'loading' })
    prepareXRPlatform()
      .then((source) => {
        if (cancelled) return
        if (source === 'unsupported') {
          setRuntime({ status: 'unsupported' })
          return
        }
        setRuntime({
          source,
          status: 'ready',
          // The editor uses ordinary spatial meshes for its wand and scene;
          // disabling Layers avoids an unnecessary WebGL emulator framebuffer.
          store: createViewerXRStore({ layers: false }),
        })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setRuntime({
          message: error instanceof Error ? error.message : 'Could not initialize WebXR',
          status: 'error',
        })
      })

    return () => {
      cancelled = true
    }
  }, [enabled])

  return runtime
}

export async function requestEditorVRSession(store: ViewerXRStore): Promise<XRSession> {
  if (!navigator.xr) throw new Error('Immersive VR is unavailable')

  const domOverlayRoot = store.getState().domOverlayRoot
  return navigator.xr.requestSession('immersive-vr', {
    requiredFeatures: ['local-floor'],
    optionalFeatures: [
      'anchors',
      'dom-overlay',
      'hand-tracking',
      'hit-test',
      'mesh-detection',
      'plane-detection',
    ],
    ...(domOverlayRoot ? { domOverlay: { root: domOverlayRoot } } : {}),
  })
}

export function xrConfigForRuntime(
  runtime: XRRuntimeState,
  session?: XRSession,
): ViewerXRConfig | undefined {
  return runtime.status === 'ready'
    ? { multiview: false, playerModes: true, session, store: runtime.store }
    : undefined
}

export type { XRRuntimeState }
