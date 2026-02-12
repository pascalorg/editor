'use client'

import useEditor from '@/store/use-editor'
import { ItemHelper } from './item-helper'
import { WallHelper } from './wall-helper'

export function HelperManager() {
  const tool = useEditor((s) => s.tool)
  const movingNode = useEditor((state) => state.movingNode)

  if (movingNode) {
    return <ItemHelper />
  }
  
  // Show appropriate helper based on current tool
  switch (tool) {
    case 'wall':
      return <WallHelper />
    case 'item':
      return <ItemHelper />
    default:
      return null
  }
}
