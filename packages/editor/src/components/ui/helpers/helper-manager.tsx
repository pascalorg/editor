'use client'

import {
  type AnyNode,
  type AnyNodeId,
  nodeRegistry,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useIsMobile } from '../../../hooks/use-mobile'
import {
  ROTATE_HANDLE_DRAG_LABEL,
  resolveRotateHandleHelpHints,
  resolveSelectModeHelpHints,
} from '../../../lib/contextual-help'
import { canDirectMoveNode, canDirectRotateNode } from '../../../lib/direct-manipulation'
import useEditor from '../../../store/use-editor'
import { useActiveHandleDrag, useMovingNode } from '../../../store/use-interaction-scope'
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
  const movingNode = useMovingNode()
  const activeHandleDrag = useActiveHandleDrag()
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const isMobile = useIsMobile()
  const modifiers = useActiveModifierKeys()
  const selectedNodes = useScene(
    useShallow((s) =>
      selectedIds
        .map((id) => s.nodes[id as AnyNodeId])
        .filter((node): node is AnyNode => node !== undefined),
    ),
  )
  const selectModeHints = useMemo(
    () =>
      resolveSelectModeHelpHints({
        selectedCount: selectedNodes.length,
        hasMovableSelection: selectedNodes.some((node) => canDirectMoveNode(node)),
        hasRotatableSelection: selectedNodes.some((node) => canDirectRotateNode(node)),
        commandPressed: modifiers.command,
        shiftPressed: modifiers.shift,
      }),
    [modifiers.command, modifiers.shift, selectedNodes],
  )

  // Helpers are keyboard-driven hints (Esc, R, etc.) — irrelevant on touch.
  if (isMobile) return null

  // Rotating a node via its in-world gizmo: advertise Shift = free rotation,
  // the same angle-step bypass wall drafting exposes. Takes priority over the
  // idle select-mode hints since a handle drag is the active interaction.
  if (activeHandleDrag?.label === ROTATE_HANDLE_DRAG_LABEL) {
    return <ContextualHelperPanel hints={resolveRotateHandleHelpHints(modifiers.shift)} />
  }

  if (movingNode) {
    if (movingNode.type === 'building') return <BuildingHelper showRotate />
    return <ItemHelper showEsc />
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
  if (tool === 'roof') return <RoofHelper shiftPressed={modifiers.shift} />
  return null
}
