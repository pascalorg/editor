'use client'

import { DoorAnimationSystem, DoorSystem } from '@pascal-app/viewer'

/**
 * Registry-driven door system bundle. Door has TWO per-frame systems:
 *
 *  - **`DoorSystem`** — rebuilds frame / leaf / glass / hardware
 *    geometry from `dirtyNodes`. Cascades dirty to the parent wall so
 *    the wall cutout reflects the new door footprint.
 *  - **`DoorAnimationSystem`** — advances `operationState` (open/close
 *    angle for hinged, slide offset for sliding/pocket, fold angle for
 *    folding) at frame priority 2, then marks the door dirty so the
 *    geometry system rebuilds at priority 3.
 *
 * Both are wrapped in `<LegacySystem kind="door">` at the legacy mount
 * point; with door registered, those wrappers short-circuit and this
 * bundle takes over.
 *
 * Future Phase 5 Stage B: extract the geometry into a pure
 * `buildDoorGeometry(node, ctx)` and migrate to `def.geometry`. The
 * animation system stays as `def.system` (it's a real per-frame
 * concern, not a geometry build).
 */
const DoorSystems = () => {
  return (
    <>
      <DoorAnimationSystem />
      <DoorSystem />
    </>
  )
}

export default DoorSystems
