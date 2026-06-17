'use client'

import { Environment } from '@react-three/drei'
import { Suspense } from 'react'

/**
 * Scene IBL for the editor — drei's prefiltered environment map. Injected as a
 * <Viewer> *child* (not baked into the Viewer component) so read-only / embed
 * viewers don't pull the HDRI. This is what gives PBR metals their reflections
 * and lifts the lighting on vertical surfaces (walls), which flat directional +
 * hemisphere lights can't do alone. Intensity is dialled below the preset
 * default so it complements the scene lights rather than washing them out.
 */
export function EditorEnvironment() {
  return (
    <Suspense fallback={null}>
      <Environment preset="sunset" environmentIntensity={0.6} />
    </Suspense>
  )
}
