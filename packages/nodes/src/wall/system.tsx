'use client'

import { WallCutout, WallSystem } from '@pascal-app/viewer'
import { useEffect } from 'react'

/**
 * Registry-driven wall system bundle.
 *
 * Wall has two per-frame concerns that need to mount when the kind is
 * registry-driven:
 *
 *  - **`WallSystem`** — reads `dirtyNodes`, batches by level, runs
 *    `calculateLevelMiters(levelWalls)`, rebuilds geometry via
 *    `generateExtrudedWall(node, children, miterData, slabElevation)`,
 *    and cascades to adjacent walls that share a junction. This is the
 *    bulk of the wall runtime (~820 lines in viewer).
 *  - **`WallCutout`** — cutaway-mode hide/show logic based on camera
 *    direction and `frontSide` / `backSide` interior/exterior tags.
 *
 * Both already live in `@pascal-app/viewer` and are wrapped in
 * `<LegacySystem kind="wall">` at the legacy mount point. When the
 * `wall` kind appears in `nodeRegistry`, those wrappers short-circuit and
 * this bundle takes over the mount via `RegisteredSystems`. The
 * components themselves are unchanged — no logic duplication during
 * Phase 3.
 *
 * Phase 6 deletes the legacy `<LegacySystem kind="wall">` wrappers; until
 * then this file is the single mount surface for wall's per-frame work.
 */
const WallSystems = () => {
  // Phase 3 verification log — confirms the registry took over the wall
  // dispatch. Fires once when RegisteredSystems lazy-loads this bundle (so
  // exactly once per viewer mount when NEXT_PUBLIC_USE_REGISTRY_FOR_WALL=true).
  // Drop alongside the feature flag at Phase 3 sign-off.
  useEffect(() => {
    console.info('[wall:registry] system bundle mounted — registry path active')
    return () => {
      console.info('[wall:registry] system bundle unmounted')
    }
  }, [])

  return (
    <>
      <WallSystem />
      <WallCutout />
    </>
  )
}

export default WallSystems
