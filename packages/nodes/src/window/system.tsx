'use client'

import { WindowAnimationSystem, WindowSystem } from '@pascal-app/viewer'

/**
 * Registry-driven window system bundle. Same shape as door — two
 * per-frame systems wrapped together:
 *
 *  - **`WindowSystem`** — rebuilds frame / sash / divider / sill /
 *    muntin geometry. Cascades dirty to parent wall for the cutout.
 *  - **`WindowAnimationSystem`** — advances sash/panel open state at
 *    frame priority 2, then marks the window dirty for the geometry
 *    rebuild at priority 3.
 *
 * Both wrapped in `<LegacySystem kind="window">` legacy mounts; with
 * window registered, those short-circuit and this bundle takes over.
 */
const WindowSystems = () => {
  return (
    <>
      <WindowAnimationSystem />
      <WindowSystem />
    </>
  )
}

export default WindowSystems
