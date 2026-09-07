export const PALM_GRAB_HOLD_SECONDS = 0.12
export const PALM_GRAB_TRIGGER_EXTENSION = 2.55
export const PALM_GRAB_RELEASE_EXTENSION = 3.2

type Point = { x: number; y: number; z: number }

type FingerPose = {
  metacarpal: Point
  tip: Point
}

export type PalmGrabPose = {
  middle: FingerPose
  pinky: FingerPose
  ring: FingerPose
  wrist: Point
}

export type PalmGrabState = {
  elapsed: number
  grabbed: boolean
}

const FINGERS = ['middle', 'ring', 'pinky'] as const

function distance(first: Point, second: Point) {
  return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z)
}

function resolveFingerExtension(wrist: Point, finger: FingerPose) {
  const palmLength = distance(wrist, finger.metacarpal)
  if (!Number.isFinite(palmLength) || palmLength <= 1e-6) return Number.POSITIVE_INFINITY
  return distance(wrist, finger.tip) / palmLength
}

export function advancePalmGrab(
  state: PalmGrabState,
  pose: PalmGrabPose | null,
  deltaSeconds: number,
  enabled = true,
) {
  const extensions =
    pose && FINGERS.map((finger) => resolveFingerExtension(pose.wrist, pose[finger]))
  if (state.grabbed) {
    const held =
      enabled &&
      extensions?.every(
        (extension) => Number.isFinite(extension) && extension < PALM_GRAB_RELEASE_EXTENSION,
      )
    if (held) return true

    state.grabbed = false
    state.elapsed = 0
    return false
  }

  const curled =
    enabled &&
    extensions?.every(
      (extension) => Number.isFinite(extension) && extension <= PALM_GRAB_TRIGGER_EXTENSION,
    )

  if (!curled) {
    state.grabbed = false
    state.elapsed = 0
    return false
  }

  state.elapsed += Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0)
  if (state.elapsed < PALM_GRAB_HOLD_SECONDS) return false

  state.grabbed = true
  return true
}
