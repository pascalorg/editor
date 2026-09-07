import type { Vector3 } from 'three'

export const THUMB_TOUCH_TRIGGER_SECONDS = 0.8
export const THUMB_TOUCH_DISTANCE = 0.045

type TrackedThumb = {
  position: Vector3
  visible: boolean
}

export type ThumbModeGestureState = {
  elapsed: number
  triggered: boolean
}

export function areThumbTipsTouching(
  left: TrackedThumb | null,
  right: TrackedThumb | null,
  maximumDistance = THUMB_TOUCH_DISTANCE,
) {
  return (
    Boolean(left?.visible && right?.visible) &&
    left!.position.distanceTo(right!.position) <= maximumDistance
  )
}

export function advanceThumbModeGesture(
  state: ThumbModeGestureState,
  touching: boolean,
  deltaSeconds: number,
) {
  if (!touching) {
    state.elapsed = 0
    state.triggered = false
    return false
  }
  if (state.triggered) return false
  state.elapsed += Math.max(0, deltaSeconds)
  if (state.elapsed < THUMB_TOUCH_TRIGGER_SECONDS) return false
  state.triggered = true
  return true
}
