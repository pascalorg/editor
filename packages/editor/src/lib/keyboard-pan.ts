// WASD navigation shared by the 3D camera and the 2D floor plan, so both views
// move the same way. Keys match by physical position (`event.code`): the
// cluster stays under the left hand on any layout (Z/Q/S/D on AZERTY).

export type KeyboardPanState = {
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
}

// Tuning. Speeds are in visible view widths per second, so a pan feels the
// same at any zoom; the world-unit clamps only bite on tiny or huge views.
/** Cruise speed once a key is held, in view widths per second. */
export const KEYBOARD_PAN_CRUISE_VIEW_WIDTHS_PER_SECOND = 0.3
/** Share of cruise speed a fresh press starts at. */
export const KEYBOARD_PAN_START_FRACTION = 0.55
/** Seconds of holding to reach cruise speed. */
export const KEYBOARD_PAN_RAMP_SECONDS = 0.22
/** Seconds to come to rest after the last key is released. */
export const KEYBOARD_PAN_STOP_SECONDS = 0.09
const KEYBOARD_PAN_MIN_SPEED = 0.5
const KEYBOARD_PAN_MAX_SPEED = 30
// A stalled frame (tab switch, long task) must not turn into one big jump.
const KEYBOARD_PAN_MAX_STEP_SECONDS = 0.25
// Release decays exponentially; three time constants leave 5%, then it snaps to rest.
const KEYBOARD_PAN_STOP_TIME_CONSTANT = KEYBOARD_PAN_STOP_SECONDS / 3
const KEYBOARD_PAN_REST_FRACTION = 0.05

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
  return (
    !(event.metaKey || event.ctrlKey || event.altKey) && !isEditableKeyboardTarget(event.target)
  )
}

/** Cruise speed, in world units per second, for a view `viewWidth` wide. */
export function keyboardPanSpeed(viewWidth: number) {
  return Math.min(
    Math.max(viewWidth * KEYBOARD_PAN_CRUISE_VIEW_WIDTHS_PER_SECOND, KEYBOARD_PAN_MIN_SPEED),
    KEYBOARD_PAN_MAX_SPEED,
  )
}

/**
 * Per-view motion carried between frames. Velocity and step are screen space
 * (+x right, +y forward) in shares of cruise speed; multiply the step by
 * `keyboardPanSpeed` for world units.
 */
export type KeyboardPanMotion = {
  holding: boolean
  /** Time on the ramp's clock, so a press during the glide resumes its speed. */
  heldSeconds: number
  velocityX: number
  velocityY: number
  /** This frame's travel, in cruise-seconds. */
  stepX: number
  stepY: number
  // Travel integrated at key edges since the last frame.
  pendingX: number
  pendingY: number
  /** `performance.now()` the motion was last advanced to; null before the first press. */
  time: number | null
}

export function createKeyboardPanMotion(): KeyboardPanMotion {
  return {
    holding: false,
    heldSeconds: 0,
    velocityX: 0,
    velocityY: 0,
    stepX: 0,
    stepY: 0,
    pendingX: 0,
    pendingY: 0,
    time: null,
  }
}

export function resetKeyboardPanMotion(motion: KeyboardPanMotion) {
  motion.holding = false
  motion.heldSeconds = 0
  motion.velocityX = 0
  motion.velocityY = 0
  motion.stepX = 0
  motion.stepY = 0
  motion.pendingX = 0
  motion.pendingY = 0
  motion.time = null
}

// Speed eases out of the start fraction into cruise: s(u) = S + (1 - S)(2u - u²), u = t / ramp.
const rampSpeed = (seconds: number) => {
  const u = Math.min(seconds / KEYBOARD_PAN_RAMP_SECONDS, 1)
  return KEYBOARD_PAN_START_FRACTION + (1 - KEYBOARD_PAN_START_FRACTION) * (2 * u - u * u)
}

// ∫₀ᵗ s, exact, so the distance does not depend on the frame rate.
const rampDistance = (seconds: number) => {
  const u = seconds / KEYBOARD_PAN_RAMP_SECONDS
  const eased = u < 1 ? u * u - (u * u * u) / 3 : u - 1 / 3
  return (
    KEYBOARD_PAN_START_FRACTION * seconds +
    (1 - KEYBOARD_PAN_START_FRACTION) * KEYBOARD_PAN_RAMP_SECONDS * eased
  )
}

const rampSecondsForSpeed = (speed: number) => {
  const eased = (speed - KEYBOARD_PAN_START_FRACTION) / (1 - KEYBOARD_PAN_START_FRACTION)
  if (eased <= 0) return 0
  if (eased >= 1) return KEYBOARD_PAN_RAMP_SECONDS
  return KEYBOARD_PAN_RAMP_SECONDS * (1 - Math.sqrt(1 - eased))
}

/**
 * Integrates `motion` up to `now` (`performance.now()`) under `keys`. Call it
 * with the keys as they were just before one changes, so a press or release
 * counts from the moment it happened rather than from the next frame.
 */
export function syncKeyboardPanMotion(
  motion: KeyboardPanMotion,
  keys: KeyboardPanState,
  now: number,
) {
  const elapsed = motion.time === null ? 0 : (now - motion.time) / 1000
  motion.time = motion.time === null ? now : Math.max(motion.time, now)
  const dt = Math.min(Math.max(elapsed, 0), KEYBOARD_PAN_MAX_STEP_SECONDS)
  const horizontal = (keys.right ? 1 : 0) - (keys.left ? 1 : 0)
  const vertical = (keys.forward ? 1 : 0) - (keys.backward ? 1 : 0)

  if (horizontal !== 0 || vertical !== 0) {
    if (!motion.holding) {
      motion.holding = true
      motion.heldSeconds = rampSecondsForSpeed(Math.hypot(motion.velocityX, motion.velocityY))
    }
    const from = motion.heldSeconds
    motion.heldSeconds = from + dt
    // Diagonals travel at the same speed as straight moves.
    const length = Math.hypot(horizontal, vertical)
    const distance = rampDistance(motion.heldSeconds) - rampDistance(from)
    const speed = rampSpeed(motion.heldSeconds)
    motion.pendingX += (horizontal / length) * distance
    motion.pendingY += (vertical / length) * distance
    motion.velocityX = (horizontal / length) * speed
    motion.velocityY = (vertical / length) * speed
    return
  }

  motion.holding = false
  motion.heldSeconds = 0
  if (motion.velocityX === 0 && motion.velocityY === 0) return
  const decay = Math.exp(-dt / KEYBOARD_PAN_STOP_TIME_CONSTANT)
  const glide = KEYBOARD_PAN_STOP_TIME_CONSTANT * (1 - decay)
  motion.pendingX += motion.velocityX * glide
  motion.pendingY += motion.velocityY * glide
  motion.velocityX *= decay
  motion.velocityY *= decay
  if (Math.hypot(motion.velocityX, motion.velocityY) < KEYBOARD_PAN_REST_FRACTION) {
    motion.velocityX = 0
    motion.velocityY = 0
  }
}

/**
 * Once per frame: syncs `motion` to `now` and leaves the travel since the
 * last frame in `stepX`/`stepY`. Returns false once the
 * view is at rest with nothing left to apply.
 */
export function advanceKeyboardPanMotion(
  motion: KeyboardPanMotion,
  keys: KeyboardPanState,
  now: number,
): boolean {
  syncKeyboardPanMotion(motion, keys, now)
  motion.stepX = motion.pendingX
  motion.stepY = motion.pendingY
  motion.pendingX = 0
  motion.pendingY = 0
  return (
    motion.holding ||
    motion.velocityX !== 0 ||
    motion.velocityY !== 0 ||
    motion.stepX !== 0 ||
    motion.stepY !== 0
  )
}
