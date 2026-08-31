import { create } from 'zustand'

/**
 * Shared draw-time options for the liquid-line tool. Lives in the nodes
 * package so both the tool (which reads + key-toggles it) and the app's MEP
 * panel (which renders the toggle button) can bind to the same state.
 *
 * `follow` arms "trace a lineset": while on, clicking an existing lineset
 * lays a liquid line beside it along the same path instead of free-drawing.
 */
type LiquidLineToolOptions = {
  follow: boolean
  setFollow: (value: boolean) => void
  toggleFollow: () => void
}

export const useLiquidLineToolOptions = create<LiquidLineToolOptions>((set) => ({
  follow: false,
  setFollow: (value) => set({ follow: value }),
  toggleFollow: () => set((s) => ({ follow: !s.follow })),
}))
