'use client'

import {
  type AnyNode,
  type AnyNodeId,
  floorPlacedCollides,
  nodeRegistry,
  type TerrainVerb,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
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
import { getContextualHelpNodeExtension } from '../../../lib/contextual-help-extension'
import { continuationContextOf, keyCyclableContinuationContext } from '../../../lib/continuation'
import { canDirectMoveNode, canDirectRotateNode } from '../../../lib/direct-manipulation'
import {
  DIVIDE_ROOM_HUD_TITLE,
  MEZZANINE_HUD_TITLE,
  OPENING_HUD_TITLE,
  TERRACE_HUD_TITLE,
  MOVE_ROOM_HUD_TITLE,
  MOVE_SELECTION_HUD_TITLE,
  nodeKindHudTitle,
  ERASE_HUD_TITLE,
  PAINT_HUD_TITLE,
  PICK_MATERIAL_HUD_TITLE,
  paintRegionHudTitle,
  RESIZE_HUD_TITLE,
  ROTATE_HUD_TITLE,
  SELECT_HUD_TITLE,
  SMART_MEASURE_HUD_TITLE,
  terrainHudTitle,
  toolHudTitle,
} from '../../../lib/hud-title'
import type { ReshapeKind } from '../../../lib/interaction/scope'
import {
  type MezzanineShape,
  useMezzanineDraft,
} from '../../../lib/mezzanine-draft'
import {
  TERRACE_SHAPE_HINT,
  type TerraceShape,
  useTerraceDraft,
} from '../../../lib/terrace-draft'
import {
  type OpeningShape,
  useOpeningDraft,
} from '../../../lib/floor-opening-draft'
import { isFreshPlacementMetadata } from '../../../lib/placement-metadata'
import { MEZZANINE_EDGE_DRAG_LABEL, ROOM_ELEVATION_DRAG_LABEL } from '../../../lib/room-handle-drag'
import { ROOM_MOVE_DRAG_LABEL } from '../../../lib/room-transform-session'
import { usePaintRegionHovering } from '../../../lib/paint-region-hover'
import {
  type PaintMode,
  paintRegionHoverHint,
  usePaintRegionMode,
} from '../../../lib/paint-region-mode'
import { snapContextOf } from '../../../lib/snapping-mode'
import useEditor, { getActiveContinuationContext } from '../../../store/use-editor'
import useInteractionScope, {
  useActiveHandleDrag,
  useMovingNode,
  useReshapingNode,
} from '../../../store/use-interaction-scope'
import { BuildingHelper } from './building-helper'
import { ContextualHelperPanel } from './contextual-helper-panel'
import { placingItemId, useFloorItemWarning } from '../../../hooks/use-floor-item-warning'
import { ItemHelper } from './item-helper'
import { RegisteredToolHelper } from './registered-tool-helper'

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

// Sculpt mode's HUD. The verb is named rather than described because it is the one
// piece of state a user loses track of between strokes. This stays even though the
// brush ring now carries the verb in colour (`brushRingColor`): the ring says
// *which* verb only to someone who already knows the mapping, and the HUD is what
// teaches it.
function terrainSculptHints(verb: TerrainVerb, sampling: boolean): ContextualShortcutHint[] {
  if (sampling) {
    return [
      { keys: ['Click'], label: 'Pick target height' },
      { keys: ['Esc'], label: 'Cancel picking' },
    ]
  }
  const action =
    verb === 'raise'
      ? 'Raise ground'
      : verb === 'lower'
        ? 'Lower ground'
        : verb === 'flatten'
          ? 'Level ground'
          : 'Smooth ground'
  return [
    { keys: ['Drag'], label: action },
    // Nested, so the two render as alternatives ("[ / ]") rather than a chord —
    // a flat `['[', ']']` joins with "+" and would read as "press both".
    { keys: [['[', ']']], label: 'Brush size' },
    { keys: ['Esc'], label: 'Cancel stroke' },
  ]
}

type ActiveModifierKeys = {
  alt: boolean
  command: boolean
  shift: boolean
}

const EMPTY_CONTEXTUAL_HINTS: ContextualShortcutHint[] = []

// The paint tool's region sub-modes: what one gesture draws, then Esc. A
// refused gesture (the per-face cap) shows as the first row.
/** What a click does in each whole-surface sub-mode; only painting teaches the held eyedropper. */
export function paintHints(mode: PaintMode): ContextualShortcutHint[] {
  if (mode === 'pick')
    return [
      { keys: ['Left click'], label: 'Paint with this material' },
      { keys: ['Esc'], label: 'Cancel' },
    ]
  if (mode === 'erase')
    return [{ keys: ['Left click'], label: 'Remove a painted part, or reset a surface' }]
  if (mode === 'surface') return [{ keys: [['Alt', 'Option']], label: 'Hold to pick a material' }]
  return []
}

export function paintRegionHints(
  mode: 'rectangle' | 'polygon',
  notice: string | null,
  hovering = true,
): ContextualShortcutHint[] {
  const gesture: Record<typeof mode, ContextualShortcutHint> = {
    rectangle: { keys: ['Drag'], label: 'Press anywhere, drag to the opposite corner' },
    polygon: { keys: ['Left click'], label: 'Add point · click the first to close' },
  }
  // Off anything the sub-mode draws on, the HUD says where to go instead.
  if (!hovering)
    return [
      ...(notice ? [{ keys: ['!'], label: notice, active: true }] : []),
      { keys: ['Hover'], label: paintRegionHoverHint(mode), active: true },
      { keys: ['Esc'], label: 'Cancel' },
    ]
  return [
    ...(notice ? [{ keys: ['!'], label: notice, active: true }] : []),
    gesture[mode],
    ...(mode === 'polygon' ? [{ keys: ['Backspace'], label: 'Remove last point' }] : []),
    { keys: ['Esc'], label: 'Cancel' },
  ]
}
// "Add mezzanine": the outline gesture for the shape picked in the room panel,
// then Esc; the snapping chip sits below.
export function mezzanineHints(shape: MezzanineShape): ContextualShortcutHint[] {
  return shape === 'rectangle'
    ? [
        { keys: ['Left click'], label: 'Set one corner, then the opposite' },
        { keys: ['Drag'], label: 'Draw the mezzanine' },
        { keys: ['Esc'], label: 'Cancel' },
      ]
    : [
        { keys: ['Left click'], label: 'Add point · click the first to close' },
        { keys: ['Backspace'], label: 'Remove last point' },
        { keys: ['Enter'], label: 'Finish' },
        { keys: ['Esc'], label: 'Cancel' },
      ]
}
/** "Cut opening": the outline gesture for the chosen shape, then Esc. */
export function openingHints(shape: OpeningShape): ContextualShortcutHint[] {
  return mezzanineHints(shape).map((hint) =>
    hint.label === 'Draw the mezzanine' ? { ...hint, label: 'Draw the opening' } : hint,
  )
}
const TERRACE_CHIP_HINTS = [TERRACE_SHAPE_HINT]
// The terrace tool: the outline gesture for the chosen shape, then Esc.
export function terraceHints(shape: TerraceShape): ContextualShortcutHint[] {
  return shape === 'rectangle'
    ? [
        { keys: ['Left click'], label: 'Set one corner, then the opposite' },
        { keys: ['Drag'], label: 'Draw the terrace' },
        { keys: ['Esc'], label: 'Done' },
      ]
    : [
        { keys: ['Left click'], label: 'Add point · click the first to close' },
        { keys: ['Backspace'], label: 'Remove last point' },
        { keys: ['Enter'], label: 'Finish' },
        { keys: ['Esc'], label: 'Done' },
      ]
}
export const ROOM_DIVIDE_HINTS: ContextualShortcutHint[] = [
  { keys: ['Left click'], label: 'Add point' },
  { keys: ['Backspace'], label: 'Remove last point' },
  { keys: ['Enter'], label: 'Finish at the edge' },
  { keys: ['Esc'], label: 'Cancel' },
]
const NO_CONTEXTUAL_HELP_SUBSCRIPTION = () => () => {}

function useActiveModifierKeys(): ActiveModifierKeys {
  const [modifiers, setModifiers] = useState<ActiveModifierKeys>({
    alt: false,
    command: false,
    shift: false,
  })

  useEffect(() => {
    const updateModifiers = (event: KeyboardEvent) => {
      const isKeyDown = event.type === 'keydown'
      setModifiers({
        alt: event.altKey || (isKeyDown && event.key === 'Alt'),
        command:
          event.metaKey ||
          event.ctrlKey ||
          (isKeyDown && (event.key === 'Meta' || event.key === 'Control')),
        shift: event.shiftKey || (isKeyDown && event.key === 'Shift'),
      })
    }
    const clearModifiers = () => {
      setModifiers({ alt: false, command: false, shift: false })
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

export type MezzanineGesture = 'raise' | 'resize' | 'move'

/**
 * A handle drag on a mezzanine — its floor handle, an edge arrow, or its pick-up
 * (Move / Duplicate) — or null. Its HUD names the mezzanine, not "Resize" or
 * "Move room".
 */
export function mezzanineGesture(
  drag: { nodeId: string; label: string } | null,
  nodes: Readonly<Record<string, AnyNode>>,
): MezzanineGesture | null {
  if (!drag) return null
  const zone = nodes[drag.nodeId]
  if (zone?.type !== 'zone' || zone.floor?.support !== 'open') return null
  if (drag.label === ROOM_ELEVATION_DRAG_LABEL) return 'raise'
  if (drag.label === MEZZANINE_EDGE_DRAG_LABEL) return 'resize'
  if (drag.label === ROOM_MOVE_DRAG_LABEL) return 'move'
  return null
}

export const MEZZANINE_GESTURE_HINTS: Record<MezzanineGesture, ContextualShortcutHint[]> = {
  raise: [
    { keys: ['Drag'], label: 'Raise or lower' },
    { keys: ['Esc'], label: 'Cancel' },
  ],
  resize: [
    { keys: ['Drag'], label: 'Resize' },
    { keys: ['Esc'], label: 'Cancel' },
  ],
  move: [
    { keys: ['Left click'], label: 'Place inside the room' },
    { keys: [['R', 'T']], label: 'Rotate ±45°' },
    { keys: ['Alt'], label: 'Free move' },
    { keys: ['Esc'], label: 'Cancel' },
  ],
}

export function HelperManager() {
  const mode = useEditor((s) => s.mode)
  const tool = useEditor((s) => s.tool)
  const terrainVerb = useEditor((s) => s.terrainVerb)
  const terrainSampling = useEditor((s) => s.terrainSampling)
  const isFirstPersonMode = useEditor((s) => s.isFirstPersonMode)
  const measurementToolKind = useEditor((s) => s.toolDefaults.measurement?.kind)
  const wallMode = useEditor((s) => s.continuationByContext.wall)
  const workspaceMode = useEditor((s) => s.workspaceMode)
  const scope = useInteractionScope((s) => s.scope)
  const paintRegionMode = usePaintRegionMode((s) => s.mode)
  const paintRegionDrawing = paintRegionMode === 'rectangle' || paintRegionMode === 'polygon'
  const paintRegionNotice = usePaintRegionMode((s) => s.notice)
  const paintRegionHovering = usePaintRegionHovering()
  const mezzanineShape = useMezzanineDraft((s) => (s.host ? s.shape : null))
  const openingShape = useOpeningDraft((s) => (s.host ? s.shape : null))
  const terraceShape = useTerraceDraft((s) => (s.host ? s.shape : null))
  const movingNode = useMovingNode()
  const placingItem = useScene((s) => (tool === 'item' ? placingItemId(s.nodes) : null))
  const fitWarning = useFloorItemWarning(movingNode?.type === 'item' ? movingNode.id : placingItem)
  const reshapingNode = useReshapingNode()
  const activeHandleDrag = useActiveHandleDrag()
  const mezzanineHandle = useScene((s) => mezzanineGesture(activeHandleDrag, s.nodes))
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
  const contextualHelpNode =
    scope.kind === 'mesh-editing'
      ? selectedNodes.find((node) => node.id === scope.nodeId) ?? null
      : null
  const contextualHelpExtension = contextualHelpNode
    ? getContextualHelpNodeExtension(nodeRegistry.get(contextualHelpNode.type))
    : undefined
  const contextualEditHints = useSyncExternalStore(
    contextualHelpExtension?.subscribe ?? NO_CONTEXTUAL_HELP_SUBSCRIPTION,
    () =>
      contextualHelpNode
        ? (contextualHelpExtension?.getHints(contextualHelpNode.id) ?? EMPTY_CONTEXTUAL_HINTS)
        : EMPTY_CONTEXTUAL_HINTS,
    () => EMPTY_CONTEXTUAL_HINTS,
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
        profileOfNode: (nodeId) => {
          const node = useScene.getState().nodes[nodeId as AnyNodeId]
          return node ? nodeRegistry.get(node.type)?.snapProfile : undefined
        },
        draftDirectionalOf: (typeOrTool) => nodeRegistry.get(typeOrTool)?.snapDraftDirectional ?? true,
        paintRegion: mode === 'material-paint' && paintRegionDrawing,
      }),
    [scope, mode, tool, paintRegionDrawing],
  )
  // Contexts whose mode is picked in the Build panel (the wall's Rooms variant)
  // get no HUD chip: the header names the variant instead.
  const continuationContext = useMemo(
    () => keyCyclableContinuationContext(getActiveContinuationContext()),
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
    const hasOpeningRadiusSelection = single?.type === 'door' || single?.type === 'window'
    return resolveSelectModeHelpHints({
      selectedCount: selectedNodes.length,
      hasMovableSelection: selectedNodes.some((node) => canDirectMoveNode(node)),
      hasRotatableSelection: selectedNodes.some((node) => canDirectRotateNode(node)),
      hasOpeningRadiusSelection,
      commandPressed: modifiers.command,
      shiftPressed: modifiers.shift,
      mepSelection,
    })
  }, [modifiers.command, modifiers.shift, selectedNodes])

  // Helpers are keyboard-driven hints (Esc, R, etc.) — irrelevant on touch.
  if (isMobile) return null

  // First-person walkthrough has its own HUD; editor shortcut hints (e.g. the
  // Ctrl multi-select hint — Ctrl is crouch there) don't apply while walking.
  if (isFirstPersonMode) return null

  // The studio workspace (compose panel / gallery) has no scene selection or
  // tools — editor shortcut hints would only mislead there.
  if (workspaceMode === 'studio') return null

  if (
    activeHandleDrag?.label === ROTATE_HANDLE_DRAG_LABEL ||
    activeHandleDrag?.label === GROUP_ROTATE_DRAG_LABEL
  ) {
    return (
      <ContextualHelperPanel
        hints={resolveRotateHandleHelpHints(modifiers.alt)}
        snapContext={snapContext}
        title={ROTATE_HUD_TITLE}
      />
    )
  }

  // Group-move drag / pick-up: the drag resolves to the 'item' snap context
  // (see `snapContextOf`), so surface the snapping chips — mode + grid step,
  // with their Shift / Ctrl cycle shortcuts — plus the mid-move R/T rotate.
  if (activeHandleDrag?.label === GROUP_MOVE_DRAG_LABEL) {
    return (
      <ContextualHelperPanel
        hints={[{ keys: ['R / T'], label: 'Rotate the selection ±45°' }]}
        snapContext={snapContext}
        title={MOVE_SELECTION_HUD_TITLE}
      />
    )
  }

  if (mezzanineHandle) {
    return (
      <ContextualHelperPanel
        hints={MEZZANINE_GESTURE_HINTS[mezzanineHandle]}
        snapContext={snapContext}
        title={MEZZANINE_HUD_TITLE}
      />
    )
  }

  // A picked-up room (Move / Duplicate / Rotate from its pill): the same keys
  // as a group pick-up.
  if (activeHandleDrag?.label === ROOM_MOVE_DRAG_LABEL) {
    return (
      <ContextualHelperPanel
        hints={[
          { keys: ['Left click'], label: 'Place' },
          { keys: [['R', 'T']], label: 'Rotate ±45°' },
          { keys: ['Alt'], label: 'Free move · slide doors and windows' },
          { keys: ['Esc'], label: 'Cancel' },
        ]}
        snapContext={snapContext}
        title={MOVE_ROOM_HUD_TITLE}
      />
    )
  }
  // A paint region gesture holds a handle-drag scope while it draws; its HUD
  // stays the region one (Backspace / close hints for a polygon mid-draft).
  if (mode === 'material-paint' && paintRegionDrawing) {
    return (
      <ContextualHelperPanel
        hints={paintRegionHints(paintRegionMode, paintRegionNotice, paintRegionHovering)}
        snapContext={snapContext}
        title={paintRegionHudTitle(paintRegionMode)}
      />
    )
  }

  // The terrace tool draws like "Add mezzanine": same outline gestures and chip.
  if (terraceShape) {
    return (
      <ContextualHelperPanel
        chipHints={TERRACE_CHIP_HINTS}
        hints={terraceHints(terraceShape)}
        snapContext={snapContext}
        title={TERRACE_HUD_TITLE}
      />
    )
  }

  if (openingShape) {
    return (
      <ContextualHelperPanel
        hints={openingHints(openingShape)}
        snapContext={snapContext}
        title={OPENING_HUD_TITLE}
      />
    )
  }

  // "Add mezzanine" holds a handle-drag scope on its host room for the whole
  // tool, so it must win over the generic resize HUD below.
  if (mezzanineShape) {
    return (
      <ContextualHelperPanel
        hints={mezzanineHints(mezzanineShape)}
        snapContext={snapContext}
        title={MEZZANINE_HUD_TITLE}
      />
    )
  }

  // A single-node resize arrow is still an active snapping interaction. Roof
  // width/depth handles opt into grid snapping, so keep the mode and grid-step
  // controls visible for the whole drag instead of falling through to idle
  // selection hints.
  if (activeHandleDrag) {
    return (
      <ContextualHelperPanel
        hints={[
          { keys: ['Drag'], label: 'Resize' },
          { keys: ['Esc'], label: 'Cancel' },
        ]}
        snapContext={snapContext}
        title={RESIZE_HUD_TITLE}
      />
    )
  }

  // Reshaping a node's geometry (endpoint / curve / polygon corner). Checked
  // before the select branch so the idle "drag selected / add objects" hints
  // never leak over an in-progress reshape — and it gets its own snapping chip.
  if (scope.kind === 'reshaping') {
    // A kind's own reshape brings its hints (`def.affordanceHints[reshape]`).
    const hints = reshapingNode
      ? nodeRegistry.get(reshapingNode.type)?.affordanceHints?.[scope.reshape]
      : undefined
    const title = reshapingNode
      ? nodeKindHudTitle(reshapingNode.type, scope.reshape === 'split' ? 'Split' : 'Edit')
      : null
    if (hints) {
      return (
        <RegisteredToolHelper
          hints={hints}
          shiftPressed={modifiers.shift}
          snapContext={snapContext}
          title={title}
        />
      )
    }
    return (
      <ContextualHelperPanel
        hints={reshapingHints(scope.reshape)}
        snapContext={snapContext}
        title={title}
      />
    )
  }

  if (movingNode) {
    // A fresh placement (e.g. a positioned preset like a shelf) advertises its
    // once/repeat continuation, exactly like the GLB item tool — but an existing
    // node being *moved* is not a placement, so it gets no continuation chip.
    const isFreshPlacement = isFreshPlacementMetadata(movingNode.metadata)
    const movingTitle = nodeKindHudTitle(movingNode.type, isFreshPlacement ? undefined : 'Move')
    if (movingNode.type === 'building') return <BuildingHelper showRotate title={movingTitle} />
    const movingContinuationContext = isFreshPlacement
      ? keyCyclableContinuationContext(continuationContextOf(movingNode.type))
      : null
    const collisionValidatesDrop = floorPlacedCollides(
      nodeRegistry.get(movingNode.type)?.capabilities.floorPlaced,
      movingNode,
    )
    return (
      <ItemHelper
        continuationContext={movingContinuationContext}
        notice={fitWarning?.line}
        showEsc
        showForce={collisionValidatesDrop}
        snapContext={snapContext}
        title={movingTitle}
      />
    )
  }

  // Paint mode advertises (and cycles, via Shift) the application scope — the
  // only contextual control here. The chip hides itself for targets that only
  // paint one surface, so this renders nothing until a scoped target is active.
  if (mode === 'material-paint') {
    return (
      <ContextualHelperPanel
        hints={paintHints(paintRegionMode)}
        showPaintScope
        title={
          paintRegionMode === 'pick'
            ? PICK_MATERIAL_HUD_TITLE
            : paintRegionMode === 'erase'
              ? ERASE_HUD_TITLE
              : PAINT_HUD_TITLE
        }
      />
    )
  }

  // Sculpt mode. The HUD is what makes a sustained brush mode legible: it names
  // the active verb (the same word the panel's segmented control shows, so the
  // two never disagree), and it advertises the two keys whose behaviour is
  // mode-specific — bracket resize, and an Esc that abandons the stroke rather
  // than exiting the mode.
  if (mode === 'terrain-sculpt') {
    return (
      <ContextualHelperPanel
        hints={terrainSculptHints(terrainVerb, terrainSampling)}
        title={terrainHudTitle(terrainVerb)}
      />
    )
  }

  if (scope.kind === 'mesh-editing') {
    return (
      <ContextualHelperPanel
        hints={contextualEditHints}
        snapContext={snapContext}
        title={contextualHelpNode ? nodeKindHudTitle(contextualHelpNode.type, 'Edit') : null}
      />
    )
  }


  // Divide draws a separator path across the selected room — it reads as a
  // wall draft: the wall's snapping chips (Shift / Ctrl) plus the path keys.
  if (scope.kind === 'room-divide') {
    return (
      <ContextualHelperPanel
        hints={ROOM_DIVIDE_HINTS}
        snapContext={snapContext}
        title={DIVIDE_ROOM_HUD_TITLE}
      />
    )
  }

  // Idle select only — an active scope (handle-drag, box-select, …) must not show
  // the idle selection hints.
  if (mode === 'select' && scope.kind === 'idle') {
    return <ContextualHelperPanel hints={selectModeHints} title={SELECT_HUD_TITLE} />
  }

  if (tool === 'measurement' && measurementToolKind === 'smart') {
    return (
      <ContextualHelperPanel
        hints={[
          { keys: ['Hover'], label: 'Inspect surface dimensions' },
          { keys: ['Click'], label: 'Pin measurement lens' },
          { keys: ['Esc'], label: 'Exit smart measure' },
        ]}
        title={SMART_MEASURE_HUD_TITLE}
      />
    )
  }

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
          notice={tool === 'item' ? fitWarning?.line : null}
          shiftPressed={modifiers.shift}
          snapContext={snapContext}
          title={toolHudTitle(tool, wallMode)}
        />
      )
    }
  }

  return null
}
