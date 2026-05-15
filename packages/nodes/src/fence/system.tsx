'use client'

import { FenceSystem } from '@pascal-app/viewer'
import { useEffect } from 'react'

/**
 * Registry-driven fence system bundle.
 *
 * Wraps the legacy `FenceSystem` (re-exported from viewer) so it mounts
 * via `RegisteredSystems` when fence is registry-driven. The legacy
 * `<LegacySystem kind="fence">` wrapper around `<FenceSystem />` in
 * `viewer/components/viewer/index.tsx` short-circuits whenever
 * `nodeRegistry.has('fence')` is true — same pattern wall used in
 * milestone B.
 *
 * Phase 6 deletes the legacy mount point; until then this bundle is the
 * single mount surface for fence's per-frame work when registry-driven.
 *
 * Future Phase 5+ work: extract fence geometry out of `FenceSystem`'s
 * useFrame body into a pure `buildFenceGeometry(node, ctx)` and migrate
 * to `def.geometry`. The generic `<GeometrySystem>` will then handle
 * the rebuild loop and this bundle can be deleted.
 */
const FenceSystems = () => {
  useEffect(() => {
    console.info('[fence:registry] system bundle mounted — registry path active')
    return () => {
      console.info('[fence:registry] system bundle unmounted')
    }
  }, [])

  return <FenceSystem />
}

export default FenceSystems
