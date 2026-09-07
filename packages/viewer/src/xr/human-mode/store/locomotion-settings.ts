import { create } from 'zustand'

export const DEFAULT_LOCOMOTION_SETTINGS = { moveSpeed: 1.5, turnSensitivity: 1 }

export type LocomotionSettings = typeof DEFAULT_LOCOMOTION_SETTINGS & {
  setMoveSpeed(value: number): void
  setTurnSensitivity(value: number): void
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export const useLocomotionSettings = create<LocomotionSettings>((set) => ({
  ...DEFAULT_LOCOMOTION_SETTINGS,
  setMoveSpeed: (moveSpeed) => set({ moveSpeed: clamp(moveSpeed, 0.25, 4) }),
  setTurnSensitivity: (turnSensitivity) => set({ turnSensitivity: clamp(turnSensitivity, 0.5, 2) }),
}))
