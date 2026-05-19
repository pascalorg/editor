'use client'

import { nodeRegistry } from '@pascal-app/core'
import { useIsMobile } from '../../../hooks/use-mobile'
import useEditor from '../../../store/use-editor'
import { BuildingHelper } from './building-helper'
import { ItemHelper } from './item-helper'
import { RegisteredToolHelper } from './registered-tool-helper'
import { RoofHelper } from './roof-helper'

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

  // Registry-first: kinds with `def.toolHints` render through the generic
  // `RegisteredToolHelper`. Today that covers ceiling / door / fence /
  // item / shelf / slab / spawn / wall / window.
  if (tool) {
    const def = nodeRegistry.get(tool)
    if (def?.toolHints && def.toolHints.length > 0) {
      return <RegisteredToolHelper hints={def.toolHints} />
    }
  }

  // Legacy fallback — only `roof` remains because it hasn't migrated to
  // `def.tool` / `def.toolHints` yet (no Stage D port). When roof
  // migrates, this switch deletes outright.
  if (tool === 'roof') return <RoofHelper />
  return null
}
