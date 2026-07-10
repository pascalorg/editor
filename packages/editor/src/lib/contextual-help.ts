export type ContextualShortcutHint = {
  // A combo of keys pressed together (rendered joined by "+"). An entry may
  // itself be an array of alternatives (rendered joined by "/"), e.g.
  // [['Cmd/Ctrl', 'Shift'], 'Left click'] → "⌘ / ⇧ + click".
  keys: Array<string | string[]>
  label: string
  // Optional secondary line under the label for a terser qualifier
  // (e.g. "disable 15° snap"). The HUD wraps both lines rather than truncating.
  subtitle?: string
  active?: boolean
}

// `activeHandleDrag.label` value a rotate gizmo sets while dragging, so the
// contextual HUD can surface the Shift = free-rotation toggle for the duration
// (mirrors how wall drafting advertises Shift). Distinct from resize handles,
// which route their own measurement label here.
export const ROTATE_HANDLE_DRAG_LABEL = 'rotate-handle'

// `activeHandleDrag.label` a plain resize / radial-resize arrow sets while
// dragging (when it carries no dimension `measureLabel`). It exists only so the
// interaction scope is non-idle during a resize, which keeps the idle
// select-mode hints off-screen — a resize is its own action, not a selection.
export const RESIZE_HANDLE_DRAG_LABEL = 'resize-handle'

// `activeHandleDrag.label`s for the multi-selection group gizmos' drags. Kept
// here (not in the gizmo components) so `snapping-mode.ts` can resolve the
// group move to the 'item' snap context without importing component code.
export const GROUP_MOVE_DRAG_LABEL = 'group-move-handle'
export const GROUP_ROTATE_DRAG_LABEL = 'group-rotate-handle'

// Hints shown while a rotate gizmo is mid-drag: Shift bypasses the angle step
// (free rotation), the same toggle wall drafting exposes. `active` lights the
// pill while Shift is held.
export function resolveRotateHandleHelpHints(shiftPressed: boolean): ContextualShortcutHint[] {
  return [
    {
      keys: [SHIFT_KEY],
      label: shiftPressed ? 'Rotating freely (no angle step)' : 'Hold to rotate freely',
      active: shiftPressed,
    },
  ]
}

export type SelectModeHelpContext = {
  selectedCount: number
  hasMovableSelection: boolean
  hasRotatableSelection: boolean
  commandPressed: boolean
  shiftPressed: boolean
  // When a single MEP node is selected its in-world handle rig (click a dot to
  // reveal move arrows) is the real editing path, so the panel leads with the
  // handle-specific hints instead of just the generic Cmd-drag tips.
  mepSelection?: 'run' | 'fitting' | null
}

export type MeasurementHelpContext = {
  angleDraftActive: boolean
  draftActive: boolean
  mode: 'distance' | 'area' | 'perimeter' | 'angle'
  modifierPressed: boolean
  polygonDraftActive?: boolean
  shiftPressed: boolean
}

const COMMAND_KEY = 'Cmd/Ctrl'
const LEFT_CLICK = 'Left click'
const RIGHT_CLICK = 'Right click'
const SHIFT_KEY = 'Shift'
const CLICK = 'Click'
const ALT_KEY = 'Alt'
const ROTATE_KEYS = 'R / T'
const ESC_KEY = 'Esc'

export function resolveSelectModeHelpHints({
  selectedCount,
  hasMovableSelection,
  hasRotatableSelection,
  commandPressed,
  shiftPressed,
  mepSelection = null,
}: SelectModeHelpContext): ContextualShortcutHint[] {
  const hints: ContextualShortcutHint[] = []

  if (selectedCount === 0) {
    if (!commandPressed && !shiftPressed) return hints

    hints.push({
      keys: [[COMMAND_KEY, SHIFT_KEY], LEFT_CLICK],
      label: 'Add or remove objects from the selection',
      active: true,
    })
    return hints
  }

  // MEP handle workflow — duct/pipe runs and fittings are edited through the
  // in-world arrow rig that a click on the handle dot reveals, so surface those
  // hints first. A run endpoint's side / up-down arrows swing the run and Alt
  // detaches the joint mid-drag; a fitting's cluster adds rotate arcs, with
  // R / T (and Alt to switch axis) for keyboard rotation.
  if (mepSelection === 'run') {
    hints.push({ keys: [CLICK], label: 'Click a handle dot to show move arrows' })
    hints.push({ keys: [ALT_KEY], label: 'Detach the joint while dragging an arrow' })
  } else if (mepSelection === 'fitting') {
    hints.push({ keys: [CLICK], label: 'Click the handle dot to show move + rotate handles' })
    hints.push({ keys: [ROTATE_KEYS], label: 'Rotate ±45°' })
    hints.push({ keys: [ALT_KEY], label: 'Switch the rotation axis (Y → X → Z)' })
  }

  // The rows are the same whatever modifier is held — guides/snapping are
  // governed by the snapping mode (Shift toggles it), not by the modifier of
  // this gesture, so there are no modifier-specific variants to advertise.
  // Holding Cmd/Ctrl or Shift just lights the selection row.
  if (hasMovableSelection) {
    hints.push({
      keys: [LEFT_CLICK],
      label: 'Drag selected movable object',
    })
  }

  if (hasRotatableSelection) {
    hints.push({
      keys: [COMMAND_KEY, RIGHT_CLICK],
      label: 'Drag left or right to rotate selected object',
    })
  }

  hints.push({
    keys: [[COMMAND_KEY, SHIFT_KEY], LEFT_CLICK],
    label: 'Add or remove objects from the selection',
    active: commandPressed || shiftPressed,
  })

  return hints
}

export function resolveMeasurementHelpHints({
  angleDraftActive,
  draftActive,
  mode,
  modifierPressed,
  polygonDraftActive,
  shiftPressed,
}: MeasurementHelpContext): ContextualShortcutHint[] {
  const hints: ContextualShortcutHint[] = []

  if (mode === 'area') {
    hints.push({ keys: [CLICK], label: polygonDraftActive ? 'Place area point' : 'Measure area' })
  } else if (mode === 'perimeter') {
    hints.push({
      keys: [CLICK],
      label: polygonDraftActive ? 'Place perimeter point' : 'Measure perimeter',
    })
  } else if (mode === 'angle' || angleDraftActive) {
    hints.push({
      keys: [CLICK],
      label: angleDraftActive ? 'Place next angle point' : 'Start angle',
    })
  } else {
    hints.push({
      keys: [CLICK],
      label: draftActive ? 'Finish length' : 'Start length',
    })
    hints.push({
      keys: [SHIFT_KEY, CLICK],
      label: draftActive ? 'Lock to axis and finish' : 'Start angle',
      active: shiftPressed,
    })
    hints.push({
      keys: [[ALT_KEY, COMMAND_KEY], CLICK],
      label: 'Quick measure object',
      active: modifierPressed,
    })
  }

  hints.push({ keys: [ESC_KEY], label: 'Cancel measurement action' })
  return hints
}
