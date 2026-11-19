'use client'

import { useScene } from '@pascal-app/editor'
import {
  createContext,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useState,
} from 'react'
import type { PascalWebXRFeature } from './webxr-enabled-runtime'

export type { PascalWebXRFeature }

// Kept inline instead of importing from `@webxr/plugin` so the WebXR bundle
// (`@react-three/xr`, `iwer`, `@iwer/devui`) is never loaded unless the plugin
// is actually installed in the active scene.
const WEBXR_PLUGIN_ID = 'webxr:core'

const LazyEnabledWebXRFeature = lazy(() => import('./webxr-enabled-runtime'))

const WebXRFeatureContext = createContext<PascalWebXRFeature | null>(null)

export function WebXRFeatureRuntime({
  enabled,
  children,
}: {
  enabled: boolean
  children: ReactNode
}) {
  const [feature, setFeature] = useState<PascalWebXRFeature | null>(null)
  const setFeatureStable = useCallback((next: PascalWebXRFeature | null) => setFeature(next), [])

  return (
    <WebXRFeatureContext.Provider value={enabled ? feature : null}>
      {children}
      {enabled ? (
        <Suspense fallback={null}>
          <LazyEnabledWebXRFeature onFeature={setFeatureStable} />
        </Suspense>
      ) : null}
    </WebXRFeatureContext.Provider>
  )
}

/** The running WebXR feature, or null when the plugin is not installed in this scene. */
export function useWebXRFeature() {
  return useContext(WebXRFeatureContext)
}

export function useWebXRInstalled() {
  return useScene((state) => state.installedPlugins.includes(WEBXR_PLUGIN_ID))
}
