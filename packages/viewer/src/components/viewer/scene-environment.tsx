'use client'

import { Environment } from '@react-three/drei'
import { Suspense } from 'react'

/**
 * Scene IBL — drei's prefiltered environment map, exported as an opt-in
 * <Viewer> *child* rather than baked into the Viewer component, so embed /
 * thumbnail surfaces that don't want the HDRI fetch simply don't mount it.
 * This is what gives PBR metals their reflections and lifts the lighting on
 * vertical surfaces (walls), which flat directional + hemisphere lights can't
 * do alone. Intensity is dialled below the preset default so it complements
 * the scene lights rather than washing them out. Only visible in `rendered`
 * shading.
 */
export function SceneEnvironment() {
  return (
    <Suspense fallback={null}>
      <Environment preset="sunset" environmentIntensity={0.6} />
    </Suspense>
  )
}
