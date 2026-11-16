import { create } from 'zustand'

export type WalkthroughInteract = { label: string; verb: string } | null

/** A visible target beyond activation reach. Distance is camera-to-hit metres. */
export type WalkthroughSeenInteract = {
  kind: string
  label: string
  verb: string
  distance: number
} | null

export type FirstPersonHudState = {
  floorLabel: string | null
  zoneLabel: string | null
  interact: WalkthroughInteract
  seenInteract: WalkthroughSeenInteract
  setHud: (
    hud: Partial<
      Pick<FirstPersonHudState, 'floorLabel' | 'zoneLabel' | 'interact' | 'seenInteract'>
    >,
  ) => void
  reset: () => void
}

export const useFirstPersonHud = create<FirstPersonHudState>((set) => ({
  floorLabel: null,
  zoneLabel: null,
  interact: null,
  seenInteract: null,
  setHud: (hud) =>
    set((state) => {
      const floorLabel = hud.floorLabel === undefined ? state.floorLabel : hud.floorLabel
      const zoneLabel = hud.zoneLabel === undefined ? state.zoneLabel : hud.zoneLabel
      const interact = hud.interact === undefined ? state.interact : hud.interact

      const seenInteract = hud.seenInteract === undefined ? state.seenInteract : hud.seenInteract

      if (
        floorLabel === state.floorLabel &&
        zoneLabel === state.zoneLabel &&
        interact?.label === state.interact?.label &&
        interact?.verb === state.interact?.verb &&
        seenInteract?.kind === state.seenInteract?.kind &&
        seenInteract?.label === state.seenInteract?.label &&
        seenInteract?.verb === state.seenInteract?.verb &&
        seenInteract?.distance === state.seenInteract?.distance
      ) {
        return state
      }

      return { floorLabel, zoneLabel, interact, seenInteract }
    }),
  reset: () =>
    set((state) =>
      state.floorLabel === null &&
      state.zoneLabel === null &&
      state.interact === null &&
      state.seenInteract === null
        ? state
        : { floorLabel: null, zoneLabel: null, interact: null, seenInteract: null },
    ),
}))
