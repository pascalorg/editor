import { Vector3 } from 'three'

type GodModeHandedness = 'left' | 'right'

export type GodModeHandState = {
  grabbed: boolean
  position: Vector3
  tracked: boolean
}

function createHandState(): GodModeHandState {
  return { grabbed: false, position: new Vector3(), tracked: false }
}

const hands: Record<GodModeHandedness, GodModeHandState> = {
  left: createHandState(),
  right: createHandState(),
}

function isGodModeHandedness(handedness: XRHandedness): handedness is GodModeHandedness {
  return handedness === 'left' || handedness === 'right'
}

export function updateGodScaleHandState(
  handedness: XRHandedness,
  grabbed: boolean,
  tracked: boolean,
  position?: Vector3,
) {
  if (!isGodModeHandedness(handedness)) return
  const hand = hands[handedness]
  hand.grabbed = grabbed
  hand.tracked = tracked
  if (tracked && position) hand.position.copy(position)
}

export function getGodScaleHandState(handedness: GodModeHandedness) {
  return hands[handedness]
}

export function clearGodScaleHandState(handedness: XRHandedness) {
  updateGodScaleHandState(handedness, false, false)
}

export function clearGodScaleHandStates() {
  clearGodScaleHandState('left')
  clearGodScaleHandState('right')
}
