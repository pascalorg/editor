import { create } from 'zustand'

export type RoofFootprintSourceChoice = 'draw' | 'room'

type RoofFootprintSourceState = {
  source: RoofFootprintSourceChoice
  setSource: (source: RoofFootprintSourceChoice) => void
}

/**
 * How the user wants the next roof footprint made — draw two corners, or pick
 * a detected room ('walls' is conical-only and forced by
 * `parseRoofFootprintSource`, so it never lives here). Ephemeral UI state
 * owned by the kind, like `roof-placement-mode`: deliberately OUTSIDE
 * `toolDefaults.roof`, which preset seeding nulls on every activation and the
 * tool clears on unmount — both used to wipe the user's choice.
 */
const useRoofFootprintSource = create<RoofFootprintSourceState>((set) => ({
  source: 'draw',
  setSource: (source) => set({ source }),
}))

export default useRoofFootprintSource
