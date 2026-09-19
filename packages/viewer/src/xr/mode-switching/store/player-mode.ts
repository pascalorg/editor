import { create } from 'zustand'

export const XR_PLAYER_MODES = {
  GOD: 'god',
  HUMAN: 'human',
} as const

export type XRPlayerMode = (typeof XR_PLAYER_MODES)[keyof typeof XR_PLAYER_MODES]

type XRPlayerModeState = {
  mode: XRPlayerMode
  setMode(mode: XRPlayerMode): void
  toggle(): void
}

export const useXRPlayerMode = create<XRPlayerModeState>((set) => ({
  mode: XR_PLAYER_MODES.GOD,
  setMode: (mode) => set({ mode }),
  toggle: () =>
    set((state) => ({
      mode: state.mode === XR_PLAYER_MODES.GOD ? XR_PLAYER_MODES.HUMAN : XR_PLAYER_MODES.GOD,
    })),
}))

export function toggleXRPlayerMode() {
  useXRPlayerMode.getState().toggle()
}
