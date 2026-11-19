'use client'

import { usePascalWebXR } from '@webxr/plugin/pascal-editor'
import { useEffect, useMemo } from 'react'
import { webXRWandBindings } from './webxr-wand-bindings'

export type PascalWebXRFeature = ReturnType<typeof usePascalWebXR>

export default function EnabledWebXRFeature({
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
