// WASD navigation shared by the 3D camera and the 2D floor plan, so both views
// move the same way. Keys match by physical position (`event.code`): the
// cluster stays under the left hand on any layout (Z/Q/S/D on AZERTY).

export type KeyboardPanState = {
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
}

const KEYBOARD_PAN_VIEW_WIDTH_PER_SECOND = 0.65
const KEYBOARD_PAN_MIN_SPEED = 2
const KEYBOARD_PAN_MAX_SPEED = 55

export function isEditableKeyboardTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

export function setKeyboardPanKey(
  state: KeyboardPanState,
  code: string,
  pressed: boolean,
): boolean {
  if (code === 'KeyW') {
    const changed = state.forward !== pressed
    state.forward = pressed
    return changed
  }
  if (code === 'KeyS') {
    const changed = state.backward !== pressed
    state.backward = pressed
    return changed
  }
  if (code === 'KeyA') {
    const changed = state.left !== pressed
    state.left = pressed
    return changed
  }
  if (code === 'KeyD') {
    const changed = state.right !== pressed
    state.right = pressed
    return changed
  }
  return false
}

export function isKeyboardPanKey(code: string): boolean {
  return code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD'
}

export function hasKeyboardPanInput(state: KeyboardPanState): boolean {
  return state.forward || state.backward || state.left || state.right
}

export function clearKeyboardPanKeys(state: KeyboardPanState) {
  state.forward = false
  state.backward = false
  state.left = false
  state.right = false
}

/** Pan keys are ignored with a modifier held (shortcuts) or while typing. */
export function acceptsKeyboardPan(event: KeyboardEvent) {
  return !(event.metaKey || event.ctrlKey || event.altKey) && !isEditableKeyboardTarget(event.target)
}

/** Screen-space direction: `horizontal` +1 is right, `vertical` +1 is forward (up). */
export function keyboardPanDirection(state: KeyboardPanState) {
  return {
    horizontal: (state.right ? 1 : 0) - (state.left ? 1 : 0),
    vertical: (state.forward ? 1 : 0) - (state.backward ? 1 : 0),
  }
}

/** World units per second for a view `viewWidth` wide. */
export function keyboardPanSpeed(viewWidth: number) {
  return Math.min(
    Math.max(viewWidth * KEYBOARD_PAN_VIEW_WIDTH_PER_SECOND, KEYBOARD_PAN_MIN_SPEED),
    KEYBOARD_PAN_MAX_SPEED,
  )
}
