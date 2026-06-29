export type ContextualShortcutHint = {
  keys: string[]
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

const COMMAND_KEY = 'Cmd/Ctrl'
const LEFT_CLICK = 'Left click'
const RIGHT_CLICK = 'Right click'
const SHIFT_KEY = 'Shift'
const CLICK = 'Click'
const ALT_KEY = 'Alt'
const ROTATE_KEYS = 'R / T'

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
      keys: [commandPressed ? COMMAND_KEY : SHIFT_KEY, LEFT_CLICK],
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

  if (commandPressed) {
    if (hasMovableSelection) {
      hints.push({
        keys: [COMMAND_KEY, LEFT_CLICK],
        label: shiftPressed
          ? 'Drag selected movable object freely'
          : 'Drag selected movable object with guides',
        active: true,
      })
    }

    if (hasRotatableSelection) {
      hints.push({
        keys: [COMMAND_KEY, RIGHT_CLICK],
        label: shiftPressed
          ? 'Drag left or right to rotate freely'
          : 'Drag left or right to rotate',
        active: true,
      })
    }

    hints.push({
      keys: [COMMAND_KEY, LEFT_CLICK],
      label: 'Click without dragging to add or remove objects',
      active: commandPressed && !shiftPressed,
    })
  } else {
    if (hasMovableSelection) {
      hints.push({
        keys: [COMMAND_KEY, LEFT_CLICK],
        label: 'Drag selected movable object',
      })
    }

    if (hasRotatableSelection) {
      hints.push({
        keys: [COMMAND_KEY, RIGHT_CLICK],
        label: 'Drag left or right to rotate selected object',
      })
    }
  }

  // The Shift bypass only applies to an in-progress direct move/rotate
  // (the Cmd/Ctrl-drag gesture), so only surface it while that modifier is
  // engaged — not on an idle selection, where Shift means multi-select.
  if (commandPressed && (hasMovableSelection || hasRotatableSelection)) {
    hints.push({
      keys: [SHIFT_KEY],
      label: shiftPressed ? 'Guided constraints bypassed' : 'Hold to bypass snaps and angle steps',
      active: shiftPressed,
    })
  }

  if (!commandPressed) {
    hints.push({
      keys: [COMMAND_KEY, LEFT_CLICK],
      label: 'Add or remove objects from the selection',
    })
    hints.push({
      keys: [SHIFT_KEY, LEFT_CLICK],
      label: 'Add or remove objects on the canvas',
      active: shiftPressed,
    })
  }

  return hints
}
