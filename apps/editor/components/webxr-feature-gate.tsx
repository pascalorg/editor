'use client'

import { useScene } from '@pascal-app/editor'
import { WEBXR_PLUGIN_ID } from '@webxr/plugin'
import { usePascalWebXR } from '@webxr/plugin/pascal-editor'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { webXRWandBindings } from './build-tab'

export type PascalWebXRFeature = ReturnType<typeof usePascalWebXR>

const WebXRFeatureContext = createContext<PascalWebXRFeature | null>(null)

function EnabledWebXRFeature({
  onFeature,
}: {
  onFeature: (feature: PascalWebXRFeature | null) => void
}) {
  const feature = usePascalWebXR(webXRWandBindings)
  // Keep the context stable when the plugin returns a new aggregate object.
  // biome-ignore lint/correctness/useExhaustiveDependencies: stabilize on public feature fields
  const stableFeature = useMemo(
    () => feature,
    [
      feature.enter,
      feature.entering,
      feature.error,
      feature.exit,
      feature.fail,
      feature.immersive,
      feature.ready,
      feature.runtime,
      feature.session,
    ],
  )

  useEffect(() => {
    onFeature(stableFeature)
    return () => onFeature(null)
  }, [onFeature, stableFeature])

  return null
}

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
      {enabled ? <EnabledWebXRFeature onFeature={setFeatureStable} /> : null}
    </WebXRFeatureContext.Provider>
  )
}

export function WebXRFeatureConsumer({
  children,
}: {
  children: (feature: PascalWebXRFeature | null) => ReactNode
}) {
  return children(useContext(WebXRFeatureContext))
}

export function useWebXRInstalled() {
  return useScene((state) => state.installedPlugins.includes(WEBXR_PLUGIN_ID))
}
