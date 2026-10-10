import { usePointAsk } from '../../store/use-point-ask'

// What a host app (the hosted chat) tells Point and ask about itself, without importing the store.

/** The host's "Playful touches" setting: false turns the region flash, the ripples and the sounds off. */
export function setPointAskPlayful(playful: boolean) {
  usePointAsk.getState().setPlayful(playful)
}

/** Pascal is on a turn: the bubble's Send says Queue, and a new ask waits its turn. */
export function setPointAskBusy(busy: boolean) {
  usePointAsk.getState().setBusy(busy)
}
