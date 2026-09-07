import type { Vector3 } from 'three'
import { createStore } from 'zustand/vanilla'

type HandStateName = 'idle' | 'ready' | 'active'
type Handedness = 'left' | 'right'
type HandJoystickState = {
  active: boolean
  state: HandStateName
  position: [number, number, number]
}

export const handLocomotionJoystickStore = createStore<Record<Handedness, HandJoystickState>>(
  () => ({
    left: { active: false, state: 'idle', position: [0, 0, 0] },
    right: { active: false, state: 'idle', position: [0, 0, 0] },
  }),
)

export function showHandLocomotionJoystick(position: Vector3, handedness: Handedness) {
  handLocomotionJoystickStore.setState((state) => ({
    ...state,
    [handedness]: {
      active: true,
      state: 'active',
      position: [position.x, position.y, position.z],
    },
  }))
}

export function hideHandLocomotionJoystick(handedness?: Handedness) {
  if (!handedness) {
    handLocomotionJoystickStore.setState({
      left: { active: false, state: 'idle', position: [0, 0, 0] },
      right: { active: false, state: 'idle', position: [0, 0, 0] },
    })
    return
  }
  handLocomotionJoystickStore.setState((state) => ({
    ...state,
    [handedness]: { ...state[handedness], active: false, state: 'idle' },
  }))
}

export function setHandLocomotionState(
  handedness: Handedness,
  stateName: HandStateName,
  position?: Vector3,
) {
  handLocomotionJoystickStore.setState((state) => ({
    ...state,
    [handedness]: {
      ...state[handedness],
      active: stateName === 'active',
      state: stateName,
      ...(position
        ? { position: [position.x, position.y, position.z] as [number, number, number] }
        : {}),
    },
  }))
}
