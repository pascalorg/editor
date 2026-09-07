import { create } from 'zustand'

type GodModeViewState = {
  requestReset(): void
  resetRequest: number
}

export const useGodScaleView = create<GodModeViewState>((set) => ({
  resetRequest: 0,
  requestReset: () => set((state) => ({ resetRequest: state.resetRequest + 1 })),
}))

export function requestGodScaleReset() {
  useGodScaleView.getState().requestReset()
}
