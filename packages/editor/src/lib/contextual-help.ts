export type ContextualShortcutHint = {
  keys: string[]
  label: string
  active?: boolean
}

export type SelectModeHelpContext = {
  selectedCount: number
  hasMovableSelection: boolean
  hasRotatableSelection: boolean
  commandPressed: boolean
  shiftPressed: boolean
  // When a single HVAC node is selected its in-world handle rig (click a dot to
  // reveal move arrows) is the real editing path, so the panel leads with the
  // handle-specific hints instead of just the generic Cmd-drag tips.
  hvacSelection?: 'duct' | 'fitting' | null
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
  hvacSelection = null,
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

  // HVAC handle workflow — duct runs and fittings are edited through the
  // in-world arrow rig that a click on the handle dot reveals, so surface those
  // hints first. A duct endpoint's side / up-down arrows swing the run and Alt
  // detaches the joint mid-drag; a fitting's cluster adds rotate arcs, with
  // R / T (and Alt to switch axis) for keyboard rotation.
  if (hvacSelection === 'duct') {
    hints.push({ keys: [CLICK], label: 'Click a handle dot to show move arrows' })
    hints.push({ keys: [ALT_KEY], label: 'Detach the joint while dragging an arrow' })
  } else if (hvacSelection === 'fitting') {
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

  hints.push({
    keys: [SHIFT_KEY],
    label: shiftPressed ? 'Guided constraints bypassed' : 'Hold to bypass snaps and angle steps',
    active: shiftPressed,
  })

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
