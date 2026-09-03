'use client'

import { ItemLightSystem, ItemSystem } from '@pascal-app/viewer'
import { ItemBatchSystem } from './item-batch-system'

/**
 * Registry-driven item system bundle.
 *
 *  - **`ItemSystem`** — applies attachTo-driven transforms each frame
 *    (wall-side z-offset, slab elevation, ceiling mounting).
 *  - **`ItemLightSystem`** — manages light sources attached to items
 *    (lamps, ceiling lights, etc.).
 *  - **`ItemBatchSystem`** — once items stop changing, draws level-parented
 *    furniture through per-material BatchedMeshes; lit or edited items draw
 *    themselves (see item-batch-types.ts).
 */
const ItemSystems = () => {
  return (
    <>
      <ItemSystem />
      <ItemLightSystem />
      <ItemBatchSystem />
    </>
  )
}

export default ItemSystems
