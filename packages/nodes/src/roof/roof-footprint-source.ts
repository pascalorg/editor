import { create } from 'zustand'

export type RoofFootprintSourceChoice = 'draw' | 'room'

/**
 * What a Room pick finds under the cursor: a room it can roof, a room that is
 * not a rectangle (Room roofs only rectangles), or no closed room at all.
 */
export type RoofRoomPick = 'room' | 'irregular' | 'none'

type RoofFootprintSourceState = {
  source: RoofFootprintSourceChoice
  setSource: (source: RoofFootprintSourceChoice) => void
  /** The hovered Room pick, for the HUD to say why a click would do nothing; null off Room. */
  roomPick: RoofRoomPick | null
  setRoomPick: (roomPick: RoofRoomPick | null) => void
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
  roomPick: null,
  setRoomPick: (roomPick) => set({ roomPick }),
}))

const subscribeToRoomPick = (onChange: () => void) =>
  useRoofFootprintSource.subscribe((state, previous) => {
    if (state.roomPick !== previous.roomPick) onChange()
  })

export const irregularRoomHintVisibility = {
  subscribe: subscribeToRoomPick,
  value: () => useRoofFootprintSource.getState().roomPick === 'irregular',
}

export const noRoomHintVisibility = {
  subscribe: subscribeToRoomPick,
  value: () => useRoofFootprintSource.getState().roomPick === 'none',
}

export default useRoofFootprintSource
