'use client'

import useNavigation from '../../../store/use-navigation'
import useEditor from '../../../store/use-editor'
import { BuildingHelper } from './building-helper'
import { CeilingHelper } from './ceiling-helper'
import { ItemHelper } from './item-helper'
import { RoofHelper } from './roof-helper'
import { SlabHelper } from './slab-helper'
import { WallHelper } from './wall-helper'

export function HelperManager() {
  const tool = useEditor((s) => s.tool)
  const movingNode = useEditor((state) => state.movingNode)
  const navigationEnabled = useNavigation((state) => state.enabled)
  const moveItemsEnabled = useNavigation((state) => state.moveItemsEnabled)
  const itemMoveLocked = useNavigation((state) => state.itemMoveLocked)
  const robotMode = useNavigation((state) => state.robotMode)

  if (movingNode) {
    if (movingNode.type === 'building') {
      return <BuildingHelper showRotate />
    }

    const isRobotAssistedItemMove =
      movingNode.type === 'item' && navigationEnabled && moveItemsEnabled

    if (isRobotAssistedItemMove && itemMoveLocked) {
      return null
    }

    return (
      <ItemHelper
        dock={isRobotAssistedItemMove && robotMode === 'normal' ? 'left-of-navigation' : 'default'}
        showEsc
      />
    )
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
