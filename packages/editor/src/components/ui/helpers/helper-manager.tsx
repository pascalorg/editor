'use client'

import { nodeRegistry } from '@pascal-app/core'
import { useIsMobile } from '../../../hooks/use-mobile'
import useEditor from '../../../store/use-editor'
import { BuildingHelper } from './building-helper'
import { CeilingHelper } from './ceiling-helper'
import { ItemHelper } from './item-helper'
import { RegisteredToolHelper } from './registered-tool-helper'
import { RoofHelper } from './roof-helper'
import { SlabHelper } from './slab-helper'
import { WallHelper } from './wall-helper'

export function HelperManager() {
  const mode = useEditor((s) => s.mode)
  const tool = useEditor((s) => s.tool)
  const movingNode = useEditor((state) => state.movingNode)
  const isMobile = useIsMobile()

  // Helpers are keyboard-driven hints (Esc, R, etc.) — irrelevant on touch.
  if (isMobile) return null

  if (movingNode) {
    if (movingNode.type === 'building') return <BuildingHelper showRotate />
    return <ItemHelper showEsc />
  }

  if (mode === 'material-paint') {
    return null
  }

  // Registry-first: if the active tool matches a registered kind whose
  // definition supplies `toolHints`, render via the generic helper.
  // Otherwise fall through to the hand-written per-tool helpers below.
  // Legacy helpers get deleted as their kind migrates `toolHints` in.
  if (tool) {
    const def = nodeRegistry.get(tool)
    if (def?.toolHints && def.toolHints.length > 0) {
      return <RegisteredToolHelper hints={def.toolHints} />
    }
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
