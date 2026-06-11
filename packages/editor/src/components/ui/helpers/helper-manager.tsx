'use client'

import {
  type AnyNode,
  type AnyNodeId,
  isRegistryMovable,
  nodeRegistry,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useState } from 'react'
import { useIsMobile } from '../../../hooks/use-mobile'
import { resolveSelectModeHelpHints } from '../../../lib/contextual-help'
import { canDirectRotateNode } from '../../../lib/direct-manipulation'
import useEditor from '../../../store/use-editor'
import { BuildingHelper } from './building-helper'
import { ContextualHelperPanel } from './contextual-helper-panel'
import { ItemHelper } from './item-helper'
import { RegisteredToolHelper } from './registered-tool-helper'
import { RoofHelper } from './roof-helper'

type ActiveModifierKeys = {
  command: boolean
  shift: boolean
}

function useActiveModifierKeys(): ActiveModifierKeys {
  const [modifiers, setModifiers] = useState<ActiveModifierKeys>({
    command: false,
    shift: false,
  })

  useEffect(() => {
    const updateModifiers = (event: KeyboardEvent) => {
      const isKeyDown = event.type === 'keydown'
      setModifiers({
        command:
          event.metaKey ||
          event.ctrlKey ||
          (isKeyDown && (event.key === 'Meta' || event.key === 'Control')),
        shift: event.shiftKey || (isKeyDown && event.key === 'Shift'),
      })
    }
    const clearModifiers = () => {
      setModifiers({ command: false, shift: false })
    }

    window.addEventListener('keydown', updateModifiers)
    window.addEventListener('keyup', updateModifiers)
    window.addEventListener('blur', clearModifiers)
    return () => {
      window.removeEventListener('keydown', updateModifiers)
      window.removeEventListener('keyup', updateModifiers)
      window.removeEventListener('blur', clearModifiers)
    }
  }, [])

  return modifiers
}

export function HelperManager() {
  const mode = useEditor((s) => s.mode)
  const tool = useEditor((s) => s.tool)
  const movingNode = useEditor((state) => state.movingNode)
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const nodes = useScene((s) => s.nodes)
  const isMobile = useIsMobile()
  const modifiers = useActiveModifierKeys()
  const selectedNodes = useMemo<AnyNode[]>(
    () =>
      selectedIds
        .map((id) => nodes[id as AnyNodeId])
        .filter((node): node is AnyNode => node !== undefined),
    [nodes, selectedIds],
  )
  const selectModeHints = useMemo(
    () =>
      resolveSelectModeHelpHints({
        selectedCount: selectedNodes.length,
        hasMovableSelection: selectedNodes.some((node) => isRegistryMovable(node.type)),
        hasRotatableSelection: selectedNodes.some((node) => canDirectRotateNode(node)),
        commandPressed: modifiers.command,
        shiftPressed: modifiers.shift,
      }),
    [modifiers.command, modifiers.shift, selectedNodes],
  )

  // Helpers are keyboard-driven hints (Esc, R, etc.) — irrelevant on touch.
  if (isMobile) return null

  if (movingNode) {
    if (movingNode.type === 'building') return <BuildingHelper showRotate />
    return <ItemHelper shiftPressed={modifiers.shift} showEsc />
  }

  if (mode === 'material-paint') {
    return null
  }

  if (mode === 'select') {
    return <ContextualHelperPanel hints={selectModeHints} />
  }

  // Registry-first: kinds with `def.toolHints` render through the generic
  // `RegisteredToolHelper`. Today that covers ceiling / door / fence /
  // item / shelf / slab / spawn / wall / window.
  if (tool) {
    const def = nodeRegistry.get(tool)
    if (def?.toolHints && def.toolHints.length > 0) {
      return <RegisteredToolHelper hints={def.toolHints} shiftPressed={modifiers.shift} />
    }
  }

  // Legacy fallback — only `roof` remains because it hasn't migrated to
  // `def.tool` / `def.toolHints` yet (no Stage D port). When roof
  // migrates, this switch deletes outright.
  if (tool === 'roof') return <RoofHelper />
  return null
}
