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
  type ContextualShortcutHint,
  GROUP_MOVE_DRAG_LABEL,
  GROUP_ROTATE_DRAG_LABEL,
  ROTATE_HANDLE_DRAG_LABEL,
  resolveRotateHandleHelpHints,
  resolveSelectModeHelpHints,
} from '../../../lib/contextual-help'
import { continuationContextOf } from '../../../lib/continuation'
import { canDirectMoveNode, canDirectRotateNode } from '../../../lib/direct-manipulation'
import type { ReshapeKind } from '../../../lib/interaction/scope'
import { isFreshPlacementMetadata } from '../../../lib/placement-metadata'
import { snapContextOf } from '../../../lib/snapping-mode'
import useEditor, { getActiveContinuationContext } from '../../../store/use-editor'
import useInteractionScope, {
  useActiveHandleDrag,
  useMovingNode,
} from '../../../store/use-interaction-scope'
import { BuildingHelper } from './building-helper'
import { ContextualHelperPanel } from './contextual-helper-panel'
import { ItemHelper } from './item-helper'
import { RegisteredToolHelper } from './registered-tool-helper'
import { RoofHelper } from './roof-helper'

// Reshaping a selected node's geometry (endpoint / curve / polygon corner). The
// snapping chip is the main control; these just name the gesture + Esc.
function reshapingHints(reshape: ReshapeKind): ContextualShortcutHint[] {
  const action =
    reshape === 'curve'
      ? 'Curve'
      : reshape === 'control-point'
        ? 'Move control point'
        : reshape === 'tangent'
          ? 'Move tangent'
      : reshape === 'endpoint'
        ? 'Move endpoint'
        : 'Move corner'
  return [
    { keys: ['Drag'], label: action },
    { keys: ['Esc'], label: 'Cancel' },
  ]
}

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
  const workspaceMode = useEditor((s) => s.workspaceMode)
  const scope = useInteractionScope((s) => s.scope)
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
  // The snapping context for whatever's active (wall / item / polygon) — drives
  // which snapping chips the HUD shows, derived once and shared by every branch.
  const snapContext = useMemo(
    () =>
      snapContextOf({
        scope,
        mode,
        tool,
        profileOf: (typeOrTool) => nodeRegistry.get(typeOrTool)?.snapProfile,
        draftDirectionalOf: (typeOrTool) => nodeRegistry.get(typeOrTool)?.snapDraftDirectional ?? true,
      }),
    [scope, mode, tool],
  )
  const continuationContext = useMemo(
    () => getActiveContinuationContext(),
    [scope, mode, tool],
  )
  const selectModeHints = useMemo(() => {
    const single = selectedNodes.length === 1 ? selectedNodes[0] : null
    const mepSelection =
      single?.type === 'duct-segment' || single?.type === 'pipe-segment'
        ? 'run'
        : single?.type === 'duct-fitting' || single?.type === 'pipe-fitting'
          ? 'fitting'
          : null
    return resolveSelectModeHelpHints({
      selectedCount: selectedNodes.length,
      hasMovableSelection: selectedNodes.some((node) => canDirectMoveNode(node)),
      hasRotatableSelection: selectedNodes.some((node) => canDirectRotateNode(node)),
      commandPressed: modifiers.command,
      shiftPressed: modifiers.shift,
      mepSelection,
    })
  }, [modifiers.command, modifiers.shift, selectedNodes])

  // Helpers are keyboard-driven hints (Esc, R, etc.) — irrelevant on touch.
  if (isMobile) return null

  // The studio workspace (compose panel / gallery) has no scene selection or
  // tools — editor shortcut hints would only mislead there.
  if (workspaceMode === 'studio') return null

  // Rotating a node (or a multi-selection group) via its in-world gizmo:
  // advertise Shift = free rotation, the same angle-step bypass wall drafting
  // exposes. Takes priority over the idle select-mode hints since a handle
  // drag is the active interaction.
  if (
    activeHandleDrag?.label === ROTATE_HANDLE_DRAG_LABEL ||
    activeHandleDrag?.label === GROUP_ROTATE_DRAG_LABEL
  ) {
    return <ContextualHelperPanel hints={resolveRotateHandleHelpHints(modifiers.shift)} />
  }

  // Group-move drag / pick-up: the drag resolves to the 'item' snap context
  // (see `snapContextOf`), so surface the snapping chips — mode + grid step,
  // with their Shift / Ctrl cycle shortcuts — plus the mid-move R/T rotate.
  if (activeHandleDrag?.label === GROUP_MOVE_DRAG_LABEL) {
    return (
      <ContextualHelperPanel
        hints={[{ keys: ['R / T'], label: 'Rotate the selection ±45°' }]}
        snapContext={snapContext}
      />
    )
  }

  // Reshaping a node's geometry (endpoint / curve / polygon corner). Checked
  // before the select branch so the idle "drag selected / add objects" hints
  // never leak over an in-progress reshape — and it gets its own snapping chip.
  if (scope.kind === 'reshaping') {
    return <ContextualHelperPanel hints={reshapingHints(scope.reshape)} snapContext={snapContext} />
  }

  if (movingNode) {
    if (movingNode.type === 'building') return <BuildingHelper showRotate />
    // A fresh placement (e.g. a positioned preset like a shelf) advertises its
    // once/repeat continuation, exactly like the GLB item tool — but an existing
    // node being *moved* is not a placement, so it gets no continuation chip.
    const movingContinuationContext = isFreshPlacementMetadata(movingNode.metadata)
      ? continuationContextOf(movingNode.type)
      : null
    // Force-place only makes sense for kinds that collision-validate their drop;
    // structural kinds (wall/slab/…) never reject, so don't advertise Alt.
    return (
      <ItemHelper
        continuationContext={movingContinuationContext}
        showEsc
        showForce={nodeRegistry.get(movingNode.type)?.snapProfile !== 'structural'}
        snapContext={snapContext}
      />
    )
  }

  // Paint mode advertises (and cycles, via Shift) the application scope — the
  // only contextual control here. The chip hides itself for targets that only
  // paint one surface, so this renders nothing until a scoped target is active.
  if (mode === 'material-paint') {
    return <ContextualHelperPanel hints={[]} showPaintScope />
  }

  // Idle select only — an active scope (handle-drag, box-select, …) must not show
  // the idle selection hints.
  if (mode === 'select' && scope.kind === 'idle') {
    return <ContextualHelperPanel hints={selectModeHints} />
  }

  // Legacy fallback — only `roof` remains because it hasn't migrated to
  // `def.tool` / `def.toolHints` yet (no Stage D port). Checked before the
  // generic tool branch so the snap-context fallback below doesn't capture it
  // and drop its bespoke `RoofHelper` hints. When roof migrates, this deletes.
  if (tool === 'roof') return <RoofHelper snapContext={snapContext} />

  // Registry-first: a kind renders the generic `RegisteredToolHelper` when it
  // declares `def.toolHints`, OR whenever its draft resolves to a snap /
  // continuation context — so a snappable tool with NO hand-written hints (e.g.
  // `zone`) still advertises the snapping chip it already honors (Shift = cycle).
  // `RegisteredToolHelper` self-hides when there's genuinely nothing to show.
  if (tool) {
    const def = nodeRegistry.get(tool)
    const hints = def?.toolHints ?? []
    if (hints.length > 0 || snapContext || continuationContext) {
      return (
        <RegisteredToolHelper
          continuationContext={continuationContext}
          hints={hints}
          shiftPressed={modifiers.shift}
          snapContext={snapContext}
        />
      )
    }
  }

  return null
}
