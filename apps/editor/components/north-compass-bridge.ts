/**
 * Lightweight bridge so the R3F frame loop (inside Canvas) can push the
 * current north bearing to a React component outside the Canvas without
 * adding it to the Zustand viewer store.
 */
import { create } from 'zustand'

type NorthBridgeState = {
  bearingDeg: number
  setBearingDeg: (deg: number) => void
}

export const useNorthBridge = create<NorthBridgeState>()((set) => ({
  bearingDeg: 0,
  setBearingDeg: (bearingDeg) => set({ bearingDeg }),
}))
