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
}

const COMMAND_KEY = 'Cmd/Ctrl'
const LEFT_CLICK = 'Left click'
const RIGHT_CLICK = 'Right click'
const SHIFT_KEY = 'Shift'

export function resolveSelectModeHelpHints({
  selectedCount,
  hasMovableSelection,
  hasRotatableSelection,
  commandPressed,
  shiftPressed,
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
        label: shiftPressed ? 'Drag left or right to rotate freely' : 'Drag left or right to rotate',
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
