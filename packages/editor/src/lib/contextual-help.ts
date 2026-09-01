export type ContextualShortcutHint = {
  // A combo of keys pressed together (rendered joined by "+"). An entry may
  // itself be an array of alternatives (rendered joined by "/"), e.g.
  // [['Cmd/Ctrl', 'Shift'], 'Left click'] → "⌘ / ⇧ + click".
  keys: Array<string | string[]>
  /**
   * Pre-resolved label (English by convention). The contextual helper prefers
   * `labelKey` when supplied and falls back to this verbatim — convenient for
   * embedder-provided hints that already come pre-localised.
   */
  label: string
  /**
   * Optional i18n key for `label`. When set, the contextual helper resolves
   * through the active locale at render time; otherwise `label` is used
   * verbatim. Supply one of these (or both, with `label` as the fallback).
   */
  labelKey?: string
  // Optional secondary line under the label for a terser qualifier
  // (e.g. "disable 15° snap"). The HUD wraps both lines rather than truncating.
  subtitle?: string
  subtitleKey?: string
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

// `activeHandleDrag.label`s for the multi-selection group drags: the body
// drag sessions (2D floorplan + 3D ground plane) and the rotate gizmo. Kept
// here (not in the session/gizmo modules) so `snapping-mode.ts` can resolve
// the group move to the 'item' snap context without importing component code.
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
      labelKey: shiftPressed ? 'contextualHelp.rotateHandle.active' : 'contextualHelp.rotateHandle.idle',
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
      labelKey: 'contextualHelp.select.addOrRemove',
      active: true,
    })
    return hints
  }

  // Multi-selection — advertise the group gestures: drag any member to slide
  // the whole selection (2D floor plan body drag + the 3D move gizmo), R / T
  // to step-rotate the group around its bounding-box center.
  if (selectedCount > 1) {
    hints.push({
      keys: [LEFT_CLICK],
      label: 'Click or drag the selection to move it as one',
      labelKey: 'contextualHelp.select.moveAsOne',
    })
    hints.push({ keys: [ROTATE_KEYS], label: 'Rotate the selection ±45°', labelKey: 'contextualHelp.select.rotateSelection' })
    hints.push({
      keys: [COMMAND_KEY, 'G'],
      label: 'Group selection (session only)',
      labelKey: 'contextualHelp.select.groupSelection',
    })
    hints.push({
      keys: [COMMAND_KEY, SHIFT_KEY, 'G'],
      label: 'Ungroup session selection',
      labelKey: 'contextualHelp.select.ungroupSelection',
    })
    hints.push({
      keys: [[COMMAND_KEY, SHIFT_KEY], LEFT_CLICK],
      label: 'Add or remove objects from the selection',
      labelKey: 'contextualHelp.select.addOrRemove',
      active: commandPressed || shiftPressed,
    })
    hints.push({ keys: [ESC_KEY], label: 'Clear the selection (or click outside)', labelKey: 'contextualHelp.select.clearSelection' })
    return hints
  }

  // MEP handle workflow — duct/pipe runs and fittings are edited through the
  // in-world arrow rig that a click on the handle dot reveals, so surface those
  // hints first. A run endpoint's side / up-down arrows swing the run and Alt
  // detaches the joint mid-drag; a fitting's cluster adds rotate arcs, with
  // R / T (and Alt to switch axis) for keyboard rotation.
  if (mepSelection === 'run') {
    hints.push({
      keys: [CLICK],
      label: 'Click a handle dot to show move arrows',
      labelKey: 'contextualHelp.mep.run.showArrows',
    })
    hints.push({
      keys: [ALT_KEY],
      label: 'Detach the joint while dragging an arrow',
      labelKey: 'contextualHelp.mep.run.detachJoint',
    })
  } else if (mepSelection === 'fitting') {
    hints.push({
      keys: [CLICK],
      label: 'Click the handle dot to show move + rotate handles',
      labelKey: 'contextualHelp.mep.fitting.showHandles',
    })
    hints.push({ keys: [ROTATE_KEYS], label: 'Rotate ±45°', labelKey: 'contextualHelp.mep.fitting.rotate45' })
    hints.push({
      keys: [ALT_KEY],
      label: 'Switch the rotation axis (Y → X → Z)',
      labelKey: 'contextualHelp.mep.fitting.switchAxis',
    })
  }

  // The rows are the same whatever modifier is held — guides/snapping are
  // governed by the snapping mode (Shift toggles it), not by the modifier of
  // this gesture, so there are no modifier-specific variants to advertise.
  // Holding Cmd/Ctrl or Shift just lights the selection row.
  if (hasMovableSelection) {
    hints.push({
      keys: [LEFT_CLICK],
      label: 'Drag selected movable object',
      labelKey: 'contextualHelp.single.movableDrag',
    })
  }

  if (hasRotatableSelection) {
    hints.push({
      keys: [COMMAND_KEY, RIGHT_CLICK],
      label: 'Drag left or right to rotate selected object',
      labelKey: 'contextualHelp.single.rotatableDrag',
    })
  }

  hints.push({
    keys: [[COMMAND_KEY, SHIFT_KEY], LEFT_CLICK],
    label: 'Add or remove objects from the selection',
    labelKey: 'contextualHelp.select.addOrRemove',
    active: commandPressed || shiftPressed,
  })

  return hints
}
