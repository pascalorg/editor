'use client'

import { ItemLightSystem, ItemSystem } from '@pascal-app/viewer'

/**
 * Registry-driven item system bundle.
 *
 *  - **`ItemSystem`** — applies attachTo-driven transforms each frame
 *    (wall-side z-offset, slab elevation, ceiling mounting).
 *  - **`ItemLightSystem`** — manages light sources attached to items
 *    (lamps, ceiling lights, etc.).
 *
 * Both are wrapped in `<LegacySystem kind="item">` legacy mounts; with
 * item registered, those short-circuit and this bundle takes over.
 */
const ItemSystems = () => {
  return (
    <>
      <ItemSystem />
      <ItemLightSystem />
    </>
  )
}

export default ItemSystems
