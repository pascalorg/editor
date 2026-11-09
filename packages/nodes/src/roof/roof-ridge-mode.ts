import { create } from 'zustand'

/**
 * Which way a placed roof's ridge runs over the drawn footprint: along its
 * long side (the default, as a wing's roof usually does) or across it. The
 * roof tool's R key and HUD chip flip it while placing.
 */
export type RoofRidgeMode = 'long' | 'short'

type RoofRidgeModeState = {
  mode: RoofRidgeMode
  toggle: () => void
  reset: () => void
}

const useRoofRidgeMode = create<RoofRidgeModeState>((set, get) => ({
  mode: 'long',
  toggle: () => set({ mode: get().mode === 'long' ? 'short' : 'long' }),
  reset: () => set({ mode: 'long' }),
}))

/**
 * Whether the segment turns a quarter so its ridge runs along z. A segment's
 * ridge runs along its own x (its width), so a footprint deeper than it is
 * wide turns for a long-side ridge; a square one keeps x.
 */
export function ridgeQuarterTurn(
  footprintWidth: number,
  footprintDepth: number,
  mode: RoofRidgeMode,
): boolean {
  const alongDepth = footprintDepth > footprintWidth + 1e-6
  return mode === 'long' ? alongDepth : !alongDepth
}

export default useRoofRidgeMode
