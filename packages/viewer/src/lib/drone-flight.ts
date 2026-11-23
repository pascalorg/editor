import { Euler, type Object3D, type Quaternion, Vector3 } from 'three'

// The drone camera: a free flight with no gravity, floor or collision, shared by
// the viewer's `DroneController` and the editor's first-person capture camera.

/** Cruise speed, metres per second. */
export const DRONE_SPEED = 7
export const DRONE_RUN_MULTIPLIER = 3
/** Alt: a slower flight and a finer look, for framing. */
export const DRONE_SLOW_MULTIPLIER = 0.2
/** Exponential approach rate toward the wanted velocity (1/s), not a linear acceleration. */
export const DRONE_SMOOTHING = 12
/** Radians of turn per pixel of pointer-locked mouse movement. */
export const FIRST_PERSON_LOOK_SENSITIVITY = 0.002

const PITCH_LIMIT = Math.PI / 2 - 0.05
// A long frame (tab switch, GC pause) must not teleport the camera.
const MAX_STEP = 0.1

export type DroneLook = { yaw: number; pitch: number }

export type DroneInput = {
  forward: boolean
  backward: boolean
  leftward: boolean
  rightward: boolean
  up: boolean
  down: boolean
  boost: boolean
  slow: boolean
}

const DRONE_KEY_BINDINGS: Readonly<Record<string, keyof DroneInput>> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'backward',
  ArrowDown: 'backward',
  KeyA: 'leftward',
  ArrowLeft: 'leftward',
  KeyD: 'rightward',
  ArrowRight: 'rightward',
  Space: 'up',
  KeyE: 'up',
  KeyQ: 'down',
  ControlLeft: 'down',
  ControlRight: 'down',
  ShiftLeft: 'boost',
  ShiftRight: 'boost',
  AltLeft: 'slow',
  AltRight: 'slow',
}

/** The drone control a `KeyboardEvent.code` drives, if any. */
export function droneInputForKey(code: string): keyof DroneInput | null {
  return DRONE_KEY_BINDINGS[code] ?? null
}

export function createDroneInput(): DroneInput {
  return {
    forward: false,
    backward: false,
    leftward: false,
    rightward: false,
    up: false,
    down: false,
    boost: false,
    slow: false,
  }
}

/**
 * Writes the controls the held keys drive into `out`. Reading from the set of
 * held codes (rather than toggling a flag per key) keeps a control held while
 * either of its keys is — releasing E does not cancel a held Space.
 */
export function readDroneInput(heldCodes: ReadonlySet<string>, out: DroneInput): DroneInput {
  out.forward = false
  out.backward = false
  out.leftward = false
  out.rightward = false
  out.up = false
  out.down = false
  out.boost = false
  out.slow = false
  for (const code of heldCodes) {
    const control = DRONE_KEY_BINDINGS[code]
    if (control) out[control] = true
  }
  return out
}

const lookEuler = new Euler(0, 0, 0, 'YXZ')

/** Picks up the look angles from wherever the camera currently points. */
export function seedDroneLook(look: DroneLook, quaternion: Quaternion) {
  lookEuler.setFromQuaternion(quaternion, 'YXZ')
  look.yaw = lookEuler.y
  look.pitch = lookEuler.x
}

/** Turns a first-person look by a pointer-locked mouse movement; pitch stops short of straight up/down. */
export function turnFirstPersonLook(
  look: DroneLook,
  movementX: number,
  movementY: number,
  sensitivityScale = 1,
) {
  const sensitivity = FIRST_PERSON_LOOK_SENSITIVITY * sensitivityScale
  look.yaw -= movementX * sensitivity
  look.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, look.pitch - movementY * sensitivity))
}

const flightEuler = new Euler(0, 0, 0, 'YXZ')
const flightForward = new Vector3()
const flightRight = new Vector3()
const flightDesired = new Vector3()

/**
 * Advances the drone one frame: orients the camera from the look angles, eases
 * `velocity` toward the wanted one (WASD along the view axes, pitch included;
 * up/down along world Y) and moves the camera by it.
 */
export function stepDroneFlight(
  camera: Object3D,
  look: DroneLook,
  input: DroneInput,
  velocity: Vector3,
  delta: number,
) {
  const step = Math.min(delta, MAX_STEP)

  flightEuler.set(look.pitch, look.yaw, 0, 'YXZ')
  camera.quaternion.setFromEuler(flightEuler)
  flightForward.set(0, 0, -1).applyEuler(flightEuler)
  flightRight.set(1, 0, 0).applyEuler(flightEuler)

  flightDesired.set(0, 0, 0)
  if (input.forward) flightDesired.add(flightForward)
  if (input.backward) flightDesired.sub(flightForward)
  if (input.rightward) flightDesired.add(flightRight)
  if (input.leftward) flightDesired.sub(flightRight)
  if (input.up) flightDesired.y += 1
  if (input.down) flightDesired.y -= 1
  if (flightDesired.lengthSq() > 0) {
    flightDesired
      .normalize()
      .multiplyScalar(
        DRONE_SPEED * (input.slow ? DRONE_SLOW_MULTIPLIER : input.boost ? DRONE_RUN_MULTIPLIER : 1),
      )
  }

  velocity.lerp(flightDesired, 1 - Math.exp(-step * DRONE_SMOOTHING))
  camera.position.addScaledVector(velocity, step)
  camera.updateMatrixWorld(true)
}
