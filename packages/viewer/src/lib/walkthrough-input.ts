export type WalkthroughInput = {
  /** Camera-relative right/forward movement, each in -1..1. */
  setMove: (x: number, y: number) => void
  /** Mouse-equivalent pixel deltas. */
  addLook: (dx: number, dy: number) => void
  setCrouch: (held: boolean) => void
  requestJump: () => void
  requestInteract: () => void
  requestShutters: () => void
  /** Explicitly close the target on controllers that support it (live T). */
  requestClose: () => void
  clear: () => void
}

const frame = { joystick: { x: 0, y: 0 }, jump: false, crouch: false, dx: 0, dy: 0 }
let dx = 0
let dy = 0
let jumps = 0
let interactions = 0
let shutters = 0
let closes = 0
const clearListeners = new Set<() => void>()
const clamp = (value: number) => (Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0)

const input: WalkthroughInput = {
  setMove(x, y) {
    frame.joystick.x = clamp(x)
    frame.joystick.y = clamp(y)
  },
  addLook(x, y) {
    if (Number.isFinite(x)) dx += x
    if (Number.isFinite(y)) dy += y
  },
  setCrouch(held) {
    frame.crouch = held
  },
  requestJump() {
    jumps += 1
  },
  requestInteract() {
    interactions += 1
  },
  requestShutters() {
    shutters += 1
  },
  requestClose() {
    closes += 1
  },
  clear() {
    frame.joystick.x = 0
    frame.joystick.y = 0
    frame.jump = false
    frame.crouch = false
    frame.dx = 0
    frame.dy = 0
    dx = 0
    dy = 0
    jumps = 0
    interactions = 0
    shutters = 0
    closes = 0
    for (const listener of clearListeners) listener()
  },
}

/** The shared channel for the package's one active scene per page. */
export function createWalkthroughInput(): WalkthroughInput {
  return input
}

/** Reuses its result; controllers read it before the physics step, without store writes. */
export function consumeWalkthroughFrame() {
  frame.dx = dx
  frame.dy = dy
  dx = 0
  dy = 0
  frame.jump = jumps > 0
  if (jumps > 0) jumps -= 1
  return frame
}

// GlbScene owns baked activation, independently of the controller's movement frame.
export function consumeWalkthroughInteract() {
  if (interactions === 0) return false
  interactions -= 1
  return true
}

export function consumeWalkthroughShutters() {
  if (shutters === 0) return false
  shutters -= 1
  return true
}

export function consumeWalkthroughClose() {
  if (closes === 0) return false
  closes -= 1
  return true
}

export function onWalkthroughInputClear(listener: () => void) {
  clearListeners.add(listener)
  return () => {
    clearListeners.delete(listener)
  }
}
