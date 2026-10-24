'use client'

import { ItemLightSystem, ItemSystem } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { NodeBatchSystem } from '../shared/node-batch/system'
import { registerWallObjectSceneCheck } from './wall-object-observations'

/**
 * Registry-driven item system bundle.
 *
 *  - **`ItemSystem`** — applies attachTo-driven transforms each frame
 *    (wall-side z-offset, slab elevation, ceiling mounting).
 *  - **`ItemLightSystem`** — manages light sources attached to items
 *    (lamps, ceiling lights, etc.).
 *  - **`NodeBatchSystem`** — once nodes stop changing, draws items, columns,
 *    ceilings, slabs and wall-hosted openings through per-material BatchedMeshes; lit or
 *    edited nodes draw themselves (see ../shared/node-batch/types.ts).
 *    Mounted from the item bundle because it must mount exactly once and
 *    every registered kind's system mounts scene-wide.
 */
const ItemSystems = () => {
  useEffect(() => {
    registerWallObjectSceneCheck()
  }, [])

  return (
    <>
      <ItemSystem />
      <ItemLightSystem />
      <NodeBatchSystem />
    </>
  )
}

export default ItemSystems
