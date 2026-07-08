'use client'

import { Environment } from '@react-three/drei'
import { Suspense } from 'react'
import { ErrorBoundary } from '../error-boundary'

/**
 * Scene IBL — drei's prefiltered environment map, exported as an opt-in
 * <Viewer> *child* rather than baked into the Viewer component, so embed /
 * thumbnail surfaces that don't want the HDRI fetch simply don't mount it.
 * This is what gives PBR metals their reflections and lifts the lighting on
 * vertical surfaces (walls), which flat directional + hemisphere lights can't
 * do alone. Intensity is dialled below the preset default so it complements
 * the scene lights rather than washing them out. Only visible in `rendered`
 * shading.
 *
 * The `sunset` preset resolves to an HDR (venice_sunset_1k.hdr) hosted on the
 * free githack CDN, which is flaky and periodically rate-limits/500s. A failed
 * fetch throws *asynchronously* from Suspense — the surrounding <Suspense> only
 * handles the pending/loading state, not the thrown error — so the rejection
 * propagated uncaught and was reported to Sentry daily (MONOREPO-EDITOR-99).
 * We wrap the <Environment> in the viewer ErrorBoundary so a failed HDR fetch
 * degrades gracefully: the scene simply renders without IBL reflections
 * (acceptable — matches the "surfaces that don't want the HDRI simply don't
 * mount it" behaviour above) instead of crashing.
 *
 * TODO(MONOREPO-EDITOR-99): self-host venice_sunset_1k.hdr under our own assets
 * CDN and point drei's Environment at it (via `files`) to remove the external
 * githack dependency entirely, rather than only tolerating its failures.
 */
export function SceneEnvironment() {
  return (
    <Suspense fallback={null}>
      <ErrorBoundary fallback={null} scope="scene-environment-hdri">
        <Environment preset="sunset" environmentIntensity={0.6} />
      </ErrorBoundary>
    </Suspense>
  )
}
