'use client'

import { WEBXR_PLUGIN_ID } from '@webxr/plugin'
import { usePascalWebXR } from '@webxr/plugin/pascal-editor'
import { useScene } from '@pascal-app/editor'
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { webXRWandBindings } from './build-tab'

export type PascalWebXRFeature = ReturnType<typeof usePascalWebXR>

const WebXRFeatureContext = createContext<PascalWebXRFeature | null>(null)

interface WebXRFeatureRuntimeProps {
  enabled: boolean
  children: ReactNode
}

interface WebXRFeatureConsumerProps {
  children: (feature: PascalWebXRFeature | null) => ReactNode
}

function EnabledWebXRFeature({
  onFeature,
}: {
  onFeature: (feature: PascalWebXRFeature | null) => void
}) {
  const feature = usePascalWebXR(webXRWandBindings)
  // The hook returns a fresh aggregate object; only these fields affect the
  // feature consumers, so keep the context value stable between state changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the aggregate is intentionally stabilized by its public fields
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

export function WebXRFeatureRuntime({ enabled, children }: WebXRFeatureRuntimeProps) {
  const [feature, setFeature] = useState<PascalWebXRFeature | null>(null)
  const activeFeature = enabled ? feature : null

  return (
    <WebXRFeatureContext.Provider value={activeFeature}>
      {children}
      {enabled ? <EnabledWebXRFeature onFeature={setFeature} /> : null}
    </WebXRFeatureContext.Provider>
  )
}

export function WebXRFeatureConsumer({ children }: WebXRFeatureConsumerProps) {
  return children(useContext(WebXRFeatureContext))
}

export function useWebXRInstalled() {
  return useScene((state) => state.installedPlugins.includes(WEBXR_PLUGIN_ID))
}
