'use client'

import useEditor from '@/store/use-editor'
import { CeilingHelper } from './ceiling-helper'
import { ItemHelper } from './item-helper'
import { RoofHelper } from './roof-helper'
import { SlabHelper } from './slab-helper'
import { WallHelper } from './wall-helper'

export function HelperManager() {
  const tool = useEditor((s) => s.tool)
  const movingNode = useEditor((state) => state.movingNode)

  if (movingNode) {
    return <ItemHelper showEsc />
  }

  // Show appropriate helper based on current tool
  switch (tool) {
    case 'wall':
      return <WallHelper />
    case 'item':
      return <ItemHelper />
    case 'slab':
      return <SlabHelper />
    case 'ceiling':
      return <CeilingHelper />
    case 'roof':
      return <RoofHelper />
    default:
      return null
  }
}
